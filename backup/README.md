# Backups

Nightly PostgreSQL backups with optional offsite copies to **Cloudflare R2**
(free tier: 10 GB storage, no egress fees).

## How it works

The `backup` service in `docker-compose.yml` runs a small container that:

1. Takes a `pg_dump` (custom format, gzip-compressed) **immediately on start**,
   so a fresh deploy is protected right away.
2. Repeats **daily at `BACKUP_HOUR`** (default 03:00, server time).
3. Keeps dumps in the `backup_data` Docker volume (`/backups`).
4. Uploads each dump to R2 when the `R2_*` variables are set.
5. Prunes local **and** remote dumps older than `BACKUP_RETENTION_DAYS` (default 14).

A dump of this app is tiny — roughly **0.5 MB** — so even years of history stays
far inside R2's free tier.

## Configuration

Add these to `.env` on the droplet (see `.env.example`):

```ini
BACKUP_RETENTION_DAYS=14
BACKUP_HOUR=3

# Optional but recommended — offsite copies
R2_ACCOUNT_ID=
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_BUCKET=
```

### Setting up Cloudflare R2 (free)

1. Cloudflare dashboard → **R2** → **Create bucket** (e.g. `surau-backups`).
2. **R2 → Manage API Tokens → Create API Token** with **Object Read & Write**.
3. Copy the **Account ID**, **Access Key ID**, and **Secret Access Key** into `.env`.
4. Restart the service:
   ```bash
   docker compose up -d backup
   docker compose logs backup --tail 20
   ```
   You should see `offsite target: r2:surau-backups`.

> Leave the `R2_*` values blank to keep backups on the droplet only. That still
> protects against accidental data loss, but **not** against losing the droplet.

## Managing backups

From your local machine (uses `deploy/config.bat`):

```bat
deploy\backup.bat              REM take a backup now (runs on the droplet)
deploy\backup.bat --list       REM list local + remote backups
deploy\backup.bat --logs       REM show recent backup logs
deploy\backup.bat --restore    REM restore the latest backup (DESTRUCTIVE)
```

### Downloading a dump to your machine

`--pull` (alias `--latest`) streams the newest dump over SSH and saves it locally:

```bat
deploy\backup.bat --latest                                   REM newest dump
deploy\backup.bat --pull pemuda_surau_2026-10-18_030000.dump REM a specific dump
```

Files land in `LOCAL_BACKUP_DIR` (default `%USERPROFILE%\pemuda-surau-backups`,
settable in `deploy\config.bat`). If `pg_restore` is installed locally the
download is verified by reading the dump's table of contents, so a truncated
transfer is detected. The dump is piped through SSH rather than copied with
`scp`, so only the SSH key is needed.

#### Optional encryption

Set `BACKUP_ENCRYPT_PASSPHRASE` in `deploy\config.bat` and dumps land as
`.dump.enc`, encrypted with AES-256-CBC (PBKDF2, 200 000 iterations). The
plaintext never touches your local disk, and the passphrase is passed to
`openssl` through a temporary file rather than the command line, so it does not
appear in the process list. Store it in a password manager — **an encrypted dump
is unrecoverable without it**. Requires `openssl` on your `PATH`.

To decrypt before restoring:

```bat
REM Put the passphrase alone in a file, with no trailing newline
openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass file:pass.txt ^
  -in "%USERPROFILE%\pemuda-surau-backups\pemuda_surau_2026-10-18_030000.dump.enc" ^
  -out restore.dump
pg_restore -d <db> restore.dump
```

### On the droplet directly

```bash
cd /opt/pemuda_surau
docker compose exec -T backup backup.sh --once      # backup now
docker compose exec -T backup restore.sh --list     # list backups
docker compose exec -T backup restore.sh --latest   # restore newest local
docker compose exec -T backup restore.sh --remote pemuda_surau_2026-09-27_030000.dump
```

## Restoring

> ⚠️ **Restoring is destructive** — it drops and recreates the database.

```bash
# 1. Stop the API so nothing writes during the restore.
docker compose stop api

# 2. Restore (prompts for confirmation).
docker compose exec -T backup restore.sh --latest

# 3. Start the API again.
docker compose start api
```

To restore from an offsite copy (e.g. after losing the droplet):

```bash
docker compose exec -T backup restore.sh --remote <filename>.dump
```

### Verify a restore without touching production

Restore into a scratch database and compare row counts:

```bash
docker compose exec -T backup sh -c "PGDATABASE=restore_test FORCE=1 restore.sh --latest"
docker compose exec -T db psql -U surau -d restore_test -c \
  "SELECT (SELECT COUNT(*) FROM users) users, (SELECT COUNT(*) FROM attendance) att;"
docker compose exec -T db psql -U surau -d postgres -c "DROP DATABASE restore_test;"
```

**Do this once before go-live.** An untested backup is a hope, not a backup.

## Disaster recovery (droplet lost)

1. Recreate the droplet: `deploy\deploy.bat`
2. Add the `R2_*` values to `.env` on the new droplet.
3. Restore the newest offsite dump:
   ```bash
   docker compose exec -T backup restore.sh --list
   docker compose exec -T backup restore.sh --remote <newest>.dump
   ```

## Notes

- The backup container needs no inbound ports and only talks to `db` and R2.
- `pg_dump` runs against a live database and is safe to run while the app is up.
- If an upload fails, the local copy is kept and the failure is logged — the
  next run will retry.
