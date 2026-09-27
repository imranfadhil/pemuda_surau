# Surau Al-Abqori — Youth Prayer Attendance Tracker

Aplikasi untuk program orang muda surau — track youth attendance at the 5 daily prayers
with phone-based face verification.

A mobile-first web app for tracking youth attendance at the 5 daily prayers at
**Surau Al-Abqori**, Jalan Cerdik, Taman Universiti, 43000 Kajang, Selangor, Malaysia
(2.93276° N, 101.8047° E).
Members check in from their phone using **face verification**; admins get a dashboard with
statistics, rankings, and program management.

## Features

- 📱 **Phone + OTP login** — no passwords to remember
- ✈️ **Free Telegram login codes** — no SMS charges, with admin-assisted fallback
- 🧑 **Face enrollment & verification** — runs in the browser (face-api.js); only a 128-value
  descriptor is stored, never a photo
- 🕌 **Prayer check-in** — Subuh, Zuhur, Asar, Maghrib, Isyak
- 🏆 **Dashboard & leaderboard** — stats, 7-day chart, per-prayer breakdown, rankings
- 📅 **Programs** — upcoming activities with join/leave
- ⚙️ **Admin panel** — manage members, view daily attendance, manual check-in
- 🔒 **HTTPS via Cloudflare Tunnel** — no open inbound ports, no certificate management
- 🐳 **Docker Compose** — one command deploy to a DigitalOcean Droplet with persistent Postgres

## Architecture

```
                    ┌──────────────────┐
   HTTPS            │  Cloudflare edge │
┌────────────┐      └────────┬─────────┘
│  Browser   │               │ outbound-only tunnel
│ face-api.js│               ▼
└────────────┘      ┌──────────────────┐
                    │   cloudflared    │
                    └────────┬─────────┘
                             ▼
┌──────────────┐     ┌──────────────┐     ┌──────────────┐
│  Nginx (web) │────▶│  Express API │────▶│  PostgreSQL  │
│  React SPA   │     │  /api/*      │     │  (volume)    │
└──────────────┘     └──────────────┘     └──────────────┘
```

- `web/` — React + Vite SPA, served by Nginx (also proxies `/api` to the API)
- `server/` — Express REST API, JWT auth, face matching, PostgreSQL via `pg`
- `cloudflared` — optional tunnel service (Compose profile `tunnel`) for public HTTPS
- `docker-compose.yml` — db + api + web (+ tunnel), with a named volume for data persistence

## Local development

### 1. Prerequisites
- Node.js 20+
- PostgreSQL 16 (or run just the DB with Docker: `docker compose up -d db`)

### 2. API

```bash
cd server
cp ../.env.example .env      # then edit DATABASE_URL, JWT_SECRET, etc.
npm install
npm run migrate              # creates tables
npm run dev                  # http://localhost:4000
```

### 3. Web

```bash
cd web
npm install
node scripts/download-models.mjs   # downloads face-api.js model weights
npm run dev                        # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`.

> **Dev tip:** with `SMS_PROVIDER=console`, OTP codes are printed to the API console *and*
> returned in the response, so you can log in without a real SMS provider.

## Environment variables

See `.env.example`. Key ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Long random string for signing tokens |
| `FACE_MATCH_THRESHOLD` | Lower = stricter. `0.5–0.6` recommended |
| `OTP_CHANNEL` | `telegram` (free), `sms` (paid), or `console` (dev) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username (without `@`) |
| `TELEGRAM_WEBHOOK_SECRET` | Optional secret for webhook verification |
| `TELEGRAM_MODE` | `webhook` (production) or `polling` (local dev) |
| `PUBLIC_URL` | Public base URL, used to register the Telegram webhook |
| `SMS_PROVIDER` | `console`, `twilio`, or `vonage` (only when `OTP_CHANNEL=sms`) |
| `SMS_API_KEY` | Twilio: `accountSid:authToken`; Vonage: `api_key` |
| `SMS_SENDER_ID` | Sender number/ID (Twilio `From`, Vonage `from`) |
| `ADMIN_PHONES` | Comma-separated phones that become admins on first login |

## Login codes (OTP delivery)

Login codes can be delivered three ways. The app picks the best available channel per user:

1. **Telegram** — free, unlimited. Used when the member has linked their account.
2. **SMS** — paid (Twilio/Vonage). Used when `OTP_CHANNEL=sms` and a provider is configured.
3. **Console** — logs the code to the server. Dev only.

If none of the above can reach a member, the login screen tells them to ask an admin, who can
generate a code from the admin panel and read it out in person.

### Setting up Telegram (recommended — free)

1. Open Telegram and message **@BotFather** → send `/newbot` → follow the prompts.
2. Copy the **token** and the **username** into `.env`:
   ```
   OTP_CHANNEL=telegram
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_BOT_USERNAME=your_bot_name
   PUBLIC_URL=https://surau.yourdomain.com
   ```
3. Restart the API, then register the webhook (once):
   ```bash
   curl -X POST https://surau.yourdomain.com/api/telegram/set-webhook \
     -H "Authorization: Bearer <admin-token>"
   ```
   Or use the admin panel. The webhook must be reachable over **HTTPS**.
4. Members open **Profile → Link Telegram**, tap the link, and press **Start**.

Once linked, codes arrive as Telegram messages — no SMS costs.

#### Testing Telegram locally (polling mode)

Telegram webhooks require a public HTTPS URL, so they can't reach `localhost`. For local
development, switch to **polling** — the server pulls updates instead:

```
TELEGRAM_MODE=polling
```

Then restart the API. You'll see:

```
[telegram:polling] started (long-polling for updates)
```

No tunnel or public URL needed. Polling automatically clears any registered webhook, since
Telegram allows only one delivery method at a time.

| Mode | Use for | Needs public HTTPS |
| --- | --- | --- |
| `webhook` (default) | Production | Yes |
| `polling` | Local development | No |

> **Note:** polling is fine for development but less efficient in production (it holds an
> open long-poll connection). Keep `webhook` for your deployed server.

### Admin-assisted login

In **Admin → Members**, each member has a **Code** button. It generates a one-time login code
and displays it large on screen so the admin can read it to the member. Useful for anyone
without Telegram or a working phone.

### SMS (optional, paid)

Set `OTP_CHANNEL=sms` and configure `SMS_PROVIDER` with your Twilio or Vonage credentials.
SMS to Malaysia is billed per message, so Telegram is recommended for regular use.

## Deploying to DigitalOcean (Droplet + Docker Compose)

### 1. Create a Droplet
- Ubuntu 24.04, at least **2 GB RAM / 1 vCPU** (face models are served statically, so CPU is light)
- Add your SSH key

### 2. Install Docker

```bash
ssh root@YOUR_DROPLET_IP
curl -fsSL https://get.docker.com | sh
```

### 3. Get the code onto the server

```bash
git clone <your-repo-url> /opt/pemuda_surau
cd /opt/pemuda_surau
cp .env.example .env
nano .env      # set strong POSTGRES_PASSWORD, JWT_SECRET, ADMIN_PHONES, SMS_*
```

> **Windows users:** the `deploy/` folder has batch scripts that automate the whole
> droplet lifecycle with `doctl` — create, deploy, sync, and destroy — so you never have to
> look up an IP. See [`deploy/README.md`](deploy/README.md).

### 4. Build and start

```bash
docker compose up -d --build
docker compose logs -f api     # watch migrations run
```

The app is now reachable locally at `http://127.0.0.1:8080` (the web port is bound to
localhost by default — see step 5 for public HTTPS access).

### 5. HTTPS via Cloudflare Tunnel (recommended)

Cloudflare Tunnel gives you HTTPS with a valid certificate **without opening any inbound
ports** and without managing certificates. It is ideal here because browsers only allow
camera access (`getUserMedia`) over **HTTPS** or `localhost` — so face check-in needs HTTPS
in production.

This setup uses a **named tunnel** with a stable domain that survives restarts.

**a. Create the tunnel**

1. Add your domain to Cloudflare (free plan is fine) and let it manage DNS.
2. Go to **Zero Trust → Networks → Tunnels → Create a tunnel** (Cloudflare dashboard).
3. Choose **Cloudflared**, name it e.g. `pemuda-surau`, and copy the **token**.
4. Under **Public Hostnames**, add one:
   - **Subdomain/Domain:** `surau.yourdomain.com`
   - **Service Type:** `HTTP`
   - **URL:** `web:80`  ← the Docker service name, not `localhost`

**b. Configure and start**

```bash
nano .env      # set CLOUDFLARE_TUNNEL_TOKEN=<your token>
docker compose --profile tunnel up -d
docker compose logs -f cloudflared
```

Your app is now live at `https://surau.yourdomain.com` with automatic TLS.

**c. Lock down CORS**

Once you know your domain, set it in `.env` and restart the API:

```bash
CORS_ORIGIN=https://surau.yourdomain.com
```

```bash
docker compose up -d api
```

> **Note:** the `cloudflared` service uses a Compose profile, so a plain
> `docker compose up -d` runs the app *without* the tunnel (handy for local development).
> Always include `--profile tunnel` on the server.

> **Security:** because the web port is bound to `127.0.0.1`, the app is not reachable
> directly from the internet — only through Cloudflare. Keep it that way. If you must expose
> it directly, set `WEB_BIND=0.0.0.0` and configure a firewall, but the tunnel is safer.

#### Alternative: Caddy (if you prefer not to use Cloudflare)

Point a domain at the Droplet, then:

```bash
apt install -y caddy
```

`/etc/caddy/Caddyfile`:
```
your-domain.com {
    reverse_proxy localhost:8080
}
```

```bash
systemctl reload caddy
```

> **Important:** browsers only allow camera access (`getUserMedia`) over **HTTPS** or
> `localhost`. Face check-in will not work on plain `http://` from a phone, so HTTPS is
> required in production.

### 6. Data persistence

PostgreSQL data lives in the `db_data` Docker volume and survives restarts and rebuilds.
Back it up with:

```bash
docker compose exec db pg_dump -U surau pemuda_surau > backup_$(date +%F).sql
```

Restore:

```bash
cat backup_2026-01-01.sql | docker compose exec -T db psql -U surau -d pemuda_surau
```

### Updating

```bash
git pull
docker compose up -d --build
```

## API overview

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| POST | `/api/auth/request-otp` | – | Send OTP to a phone |
| POST | `/api/auth/verify-otp` | – | Verify OTP, returns JWT |
| GET | `/api/auth/me` | user | Current profile |
| PUT | `/api/users/me` | user | Update profile |
| POST | `/api/users/me/face` | user | Enroll face descriptor |
| GET | `/api/users` | admin | List members |
| PATCH | `/api/users/:id/active` | admin | Activate/deactivate |
| POST | `/api/users/:id/login-code` | admin | Generate an admin-assisted login code |
| POST | `/api/telegram/link-token` | user | Create a Telegram link token |
| DELETE | `/api/telegram/link` | user | Unlink Telegram |
| GET | `/api/telegram/status` | admin | Telegram integration status |
| POST | `/api/telegram/set-webhook` | admin | Register the Telegram webhook |
| POST | `/api/telegram/webhook` | – | Telegram update receiver |
| POST | `/api/attendance/check-in` | user | Face-verified check-in |
| GET | `/api/attendance/me` | user | My history |
| GET | `/api/attendance/me/today` | user | Today's prayers |
| POST | `/api/attendance/manual` | admin | Manual check-in |
| GET | `/api/attendance/date/:date` | admin | Attendance for a date |
| GET | `/api/dashboard/stats` | user | Overall stats |
| GET | `/api/dashboard/leaderboard` | user | Rankings (`?days=7`) |
| GET | `/api/dashboard/me/breakdown` | user | My per-prayer counts |
| GET | `/api/programs` | user | List programs |
| POST/PUT/DELETE | `/api/programs[/:id]` | admin | Manage programs |
| POST/DELETE | `/api/programs/:id/join` | user | Join/leave |

## Privacy notes

- Only the **face descriptor** (128 floats) is stored — it cannot be reversed into a photo.
- Face matching happens server-side against enrolled descriptors; the live descriptor is
  never persisted.
- Consider adding a short privacy notice and obtaining consent during registration, and
  check local data-protection requirements.

## Roadmap ideas

- Streaks and badges
- Push notifications / reminders before each prayer
- QR fallback for members without a camera
- Export reports to CSV/PDF
- Multi-surau support
