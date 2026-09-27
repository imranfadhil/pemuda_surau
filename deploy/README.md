# Deploying to DigitalOcean (doctl)

Batch scripts that provision and manage the Pemuda Surau Al-Abqori droplet entirely through
**`doctl`** — no need to look up or paste an IP address. The scripts create the droplet,
resolve its public IP automatically, push the code, and can destroy everything when done.

## Prerequisites

- `doctl` installed and authenticated: `doctl auth init`
  (install: https://docs.digitalocean.com/reference/doctl/how-to/install/)
- OpenSSH `ssh`, `scp`, `ssh-keygen` on PATH (built into Windows 10/11)
- `tar` (built into Windows 10/11)

## Setup

1. Create `config.bat` — either let the scripts seed it from your `.env`, or copy the
   template manually:
   ```bat
   seed-config.bat          REM generate config.bat, pre-filled from ..\.env
   ```
   `deploy.bat` and `sync.bat` also run this automatically if `config.bat` is missing.
2. Review `config.bat` and set the infrastructure values that can't come from `.env`
   (at minimum `ADMIN_PHONES`, and `DOMAIN` if you have one).

`config.bat` is gitignored, so your secrets stay local.

### Seeding from `.env`

`seed-config.bat` reads the project `.env` and pre-fills the matching app-level settings,
so you don't type them twice:

| `config.bat` | from `.env` |
| --- | --- |
| `ADMIN_PHONES` | `ADMIN_PHONES` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | same names |
| `OTP_CHANNEL` | `OTP_CHANNEL` |
| `SMS_PROVIDER` / `SMS_API_KEY` / `SMS_SENDER_ID` | same names |
| `DOMAIN` | derived from `PUBLIC_URL` |

Infrastructure settings (`PROJECT_NAME`, `REGION`, `SIZE`, `IMAGE`, SSH key) keep the
template defaults. Regenerate at any time with `seed-config.bat -Force`.

## Scripts

| Script | What it does |
| --- | --- |
| `deploy.bat` | Create droplet (if needed) → push code → start stack |
| `sync.bat` | Push code changes and restart (keeps server `.env`) |
| `sync.bat --restart` | Push code and force a Docker rebuild |
| `seed-config.bat` | Generate `config.bat` from `.env` (`-Force` to regenerate) |
| `backup.bat` | Manage database backups (`--list`, `--restore`, `--logs`) |
| `simulate.bat` | Seed / clear demo data (`--clear`, `--status`, `--total`, `--teachers`, `--ajk`, `--days`) |
| `destroy.bat` | Delete the droplet and the DO SSH key |

## Typical workflow

```bat
REM First time (creates the droplet)
deploy.bat

REM After changing code
sync.bat

REM Force a full rebuild
sync.bat --restart

REM Tear everything down
destroy.bat
```

## Backups

The stack runs a `backup` service that takes a nightly `pg_dump` and can upload
it to Cloudflare R2 (free tier). See **[../backup/README.md](../backup/README.md)**
for setup and restore instructions.

```bat
backup.bat              REM take a backup now
backup.bat --list       REM list local + remote backups
backup.bat --restore    REM restore the latest backup (DESTRUCTIVE)
```

## Demo data

`simulate.bat` seeds realistic dummy members (with backdated attendance, Quran logs and
merits) so the dashboard and leaderboards can be demoed before go-live. Every account is
tagged `is_dummy = TRUE`, so clearing only ever removes demo data — real accounts are
untouched.

```bat
simulate.bat                       REM seed 60 members over 90 days
simulate.bat --status              REM show dummy vs real counts
simulate.bat --clear               REM remove all demo data
simulate.bat --total 70 --teachers 6 --ajk 10 --days 90
```

| Option | Default | Meaning |
| --- | --- | --- |
| `--total` | `60` | Total dummy members |
| `--teachers` | `5` | How many are teachers |
| `--ajk` | `10` | How many are AJK / committee |
| `--days` | `90` | How many days to backdate |

> Demo accounts use fake phone numbers (`+6019000xxxx`), so they cannot log in — they exist
> only to populate the dashboard and leaderboards.

## What `deploy.bat` does

1. Verifies `doctl` is installed and authenticated
2. Creates a local SSH key (if needed) and registers it with DigitalOcean
3. Creates the droplet (skips if it already exists) with cloud-init user-data
4. Resolves the public IP via `doctl` and caches it in `%TEMP%`
5. Waits for boot, then calls `sync.bat` to push code and start the stack

## What `sync.bat` does

1. Resolves the droplet IP (cached file, else `doctl`)
2. Packages the repo (excludes `node_modules`, `.git`, `dist`, `.env`, `deploy`)
3. Uploads over SSH and extracts to `/opt/pemuda_surau`
4. Creates `.env` on first deploy and **auto-generates** strong `JWT_SECRET` and
   `POSTGRES_PASSWORD` values (generated whenever the line is missing or still a
   placeholder, so `.env.example` ships without them)
5. Applies `CORS_ORIGIN`, `ADMIN_PHONES`, and SMS settings from `config.bat` by piping
   `configure-env.sh` over SSH (values passed as positional args, so tokens with `:` or `+`
   are never re-parsed by `cmd.exe`). The whole edit runs in one SSH call with `set -e`, so a
   dropped connection aborts the sync instead of silently leaving `.env.example` defaults.
6. Runs `docker compose up -d [--build]`, then reads the quick-tunnel URL from the
   `quicktunnel` logs and prints it

> Secrets are generated on the server and never overwritten on later syncs, so your data
> and sessions stay intact across deploys.

> **Transient SSH failures.** Connections to the droplet occasionally time out (network
> blips, not droplet load). Every SSH call is retried up to 4 times with a short backoff,
> so a single blip no longer aborts the sync. If all retries fail, the script stops with a
> clear error instead of continuing with a half-applied state.

### Admin bootstrap

On every API start the container runs `migrate` → `seedAdmins` → `index`. `seedAdmins`
creates an active **admin** for each phone in `ADMIN_PHONES` (and promotes an existing
account if it isn't an admin yet). This means a fresh deploy always has an admin who can
sign in and reach the admin panel — no need to register first. It is idempotent and never
overwrites a name or other profile fields.

## HTTPS via Cloudflare Quick Tunnel

The stack always runs a **Cloudflare Quick Tunnel** (`quicktunnel` service in
`docker-compose.yml`). It runs `cloudflared tunnel --url http://web:80`, which prints a
random `https://<words>.trycloudflare.com` URL. No Cloudflare account, domain, or token is
needed, and `sync.bat` reads the URL from the container logs and prints it when the deploy
finishes.

Caveats: the URL is **random and changes every time the tunnel container restarts**, and it
is intended for testing/demos rather than production. A normal `sync.bat` does **not**
recreate the `quicktunnel` container, so the URL is **retained across ordinary syncs** — it
only changes on `docker compose down`/`up`, a droplet reboot, or a compose-file change.
Telegram uses **long-polling**, so OTP delivery keeps working regardless of the URL — no
webhook re-registration needed.

> Want a stable URL later? Add a named Cloudflare Tunnel (token + domain) as a separate
> service and point its public hostname at `HTTP` / `web:80`.

## Configuration reference

| Setting | Purpose |
| --- | --- |
| `PROJECT_NAME` | Prefix for the droplet and SSH key names |
| `REMOTE_DIR` | App directory on the droplet (`/opt/pemuda_surau`) |
| `REGION` | `sgp1` (Singapore) by default |
| `SIZE` | `s-1vcpu-2gb` default; `s-1vcpu-1gb` to save cost |
| `IMAGE` | `docker-20-04` (Docker + Compose preinstalled) |
| `DOMAIN` | Public domain (used for CORS + shown after deploy) |
| `ADMIN_PHONES` | Phones seeded as admins on startup |
| `OTP_CHANNEL` | `telegram` (free), `sms` (paid), or `console` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | Telegram bot credentials |
| `SMS_PROVIDER` / `SMS_API_KEY` / `SMS_SENDER_ID` | SMS settings (only when `OTP_CHANNEL=sms`) |

## Troubleshooting

**`doctl not found` / `doctl not authenticated`**
- Install doctl, then run `doctl auth init`

**`Could not resolve droplet public IP`**
- The droplet may still be provisioning. Check: `doctl compute droplet list`

**`Upload failed. Droplet may still be booting`**
- Wait a minute and run `sync.bat --restart`

**Tunnel not starting**
- Check logs: `ssh -i %KEY_FILE% root@<ip> "cd /opt/pemuda_surau && docker compose logs quicktunnel"`
- The quick tunnel needs outbound internet access; no inbound ports are opened.

**Camera / face check-in not working**
- The site must be served over HTTPS. Use the Cloudflare Tunnel or a domain with TLS.

## Notes

- The `docker-20-04` marketplace image ships with Docker + Compose, so first boot is quick;
  deploy waits ~45s before the first code push.
- Droplet user is `root`; the app lives in `/opt/pemuda_surau`.
- Data persists on the droplet's disk across restarts; `destroy.bat` deletes it.
- The local SSH key file is kept when destroying, so re-deploying is fast.
