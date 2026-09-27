# Deploying to DigitalOcean (doctl)

Batch scripts that provision and manage the Pemuda Surau droplet entirely through
**`doctl`** — no need to look up or paste an IP address. The scripts create the droplet,
resolve its public IP automatically, push the code, and can destroy everything when done.

## Prerequisites

- `doctl` installed and authenticated: `doctl auth init`
  (install: https://docs.digitalocean.com/reference/doctl/how-to/install/)
- OpenSSH `ssh`, `scp`, `ssh-keygen` on PATH (built into Windows 10/11)
- `tar` (built into Windows 10/11)

## Setup

1. Copy the config template and fill it in:
   ```bat
   copy config.example.bat config.bat
   notepad config.bat
   ```
2. Set at minimum `CLOUDFLARE_TUNNEL_TOKEN` (for HTTPS) and `DOMAIN` if you have one.

`config.bat` is gitignored, so your secrets stay local.

## Scripts

| Script | What it does |
| --- | --- |
| `deploy.bat` | Create droplet (if needed) → push code → start stack |
| `sync.bat` | Push code changes and restart (keeps server `.env`) |
| `sync.bat --restart` | Push code and force a Docker rebuild |
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
   `POSTGRES_PASSWORD` values
5. Applies `CLOUDFLARE_TUNNEL_TOKEN`, `CORS_ORIGIN`, `ADMIN_PHONES`, and SMS settings
   from `config.bat`
6. Runs `docker compose --profile tunnel up -d [--build]` and prints status

> Secrets are generated on the server and never overwritten on later syncs, so your data
> and sessions stay intact across deploys.

## HTTPS via Cloudflare Tunnel

Set `CLOUDFLARE_TUNNEL_TOKEN` in `config.bat` (create a named tunnel at
**Zero Trust → Networks → Tunnels → Create a tunnel**, with a public hostname pointing to
service `HTTP` / `web:80`). `sync.bat` writes the token into the server `.env`, so the
tunnel starts automatically and gives you a stable HTTPS URL.

Set `COMPOSE_PROFILE=` (blank) to deploy without the tunnel.

## Configuration reference

| Setting | Purpose |
| --- | --- |
| `PROJECT_NAME` | Prefix for the droplet and SSH key names |
| `REMOTE_DIR` | App directory on the droplet (`/opt/pemuda_surau`) |
| `REGION` | `sgp1` (Singapore) by default |
| `SIZE` | `s-1vcpu-2gb` default; `s-1vcpu-1gb` to save cost |
| `IMAGE` | `docker-20-04` (Docker + Compose preinstalled) |
| `DOMAIN` | Public domain (used for CORS + shown after deploy) |
| `CLOUDFLARE_TUNNEL_TOKEN` | Token for the named Cloudflare Tunnel |
| `ADMIN_PHONES` | Phones that become admins on first login |
| `OTP_CHANNEL` | `telegram` (free), `sms` (paid), or `console` |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_BOT_USERNAME` | Telegram bot credentials |
| `TELEGRAM_WEBHOOK_SECRET` | Optional webhook secret |
| `SMS_PROVIDER` / `SMS_API_KEY` / `SMS_SENDER_ID` | SMS settings (only when `OTP_CHANNEL=sms`) |
| `COMPOSE_PROFILE` | `tunnel` to start the tunnel, blank to skip |

## Troubleshooting

**`doctl not found` / `doctl not authenticated`**
- Install doctl, then run `doctl auth init`

**`Could not resolve droplet public IP`**
- The droplet may still be provisioning. Check: `doctl compute droplet list`

**`Upload failed. Droplet may still be booting`**
- Wait a minute and run `sync.bat --restart`

**Tunnel not starting**
- Confirm `CLOUDFLARE_TUNNEL_TOKEN` is set in `config.bat`
- Check logs: `ssh -i %KEY_FILE% root@<ip> "cd /opt/pemuda_surau && docker compose logs cloudflared"`

**Camera / face check-in not working**
- The site must be served over HTTPS. Use the Cloudflare Tunnel or a domain with TLS.

## Notes

- The `docker-20-04` marketplace image ships with Docker + Compose, so first boot is quick;
  deploy waits ~45s before the first code push.
- Droplet user is `root`; the app lives in `/opt/pemuda_surau`.
- Data persists on the droplet's disk across restarts; `destroy.bat` deletes it.
- The local SSH key file is kept when destroying, so re-deploying is fast.
