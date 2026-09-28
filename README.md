# Pemuda Surau Al-Abqori — Prayer, Quran & Good Deeds Tracker

Aplikasi untuk program orang muda surau — track youth attendance at the 5 daily prayers
with phone-based face verification.

A mobile-first web app for tracking youth attendance at the 5 daily prayers at
**Surau Al-Abqori**, Jalan Cerdik, Taman Universiti, 43000 Kajang, Selangor, Malaysia
(2.93276° N, 101.8047° E).
Members check in from their phone using **face verification**; admins get a dashboard with
statistics, rankings, and program management.

## Features

- 📱 **Phone + OTP login** — no passwords to remember
- ✈️ **Free Telegram login codes** — the primary sign-in method, no SMS charges, with admin-assisted fallback as a last resort
- 👨‍👩‍👧 **Family accounts** — parents can add children (dependents) who have no phone of
  their own, enroll their faces, and check them in for prayers
- 🧑 **Face enrollment & verification** — runs in the browser (face-api.js); only a 128-value
  descriptor is stored, never a photo
- 🕌 **Prayer check-in** — Subuh, Zuhur, Asar, Maghrib, Isyak. The prayer is detected
  automatically from the current time; each prayer has a check-in window (15 min before the
  adhan to 60 min after) fetched from the Aladhan API.
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
- `quicktunnel` — Cloudflare Quick Tunnel for public HTTPS (free, no account needed)
- `docker-compose.yml` — db + api + web + quicktunnel, with a named volume for data persistence

## Local development

### 1. Prerequisites
- Node.js 20+
- PostgreSQL 16 (or run just the DB with Docker: `docker compose up -d db`)

### 2. API

```bash
cd server
cp ../.env.example .env      # then edit DATABASE_URL, ADMIN_PHONES, etc.
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

## Simulating data (demo / pre-launch)

To preview the dashboard and leaderboards with realistic data before go-live, seed a set of
dummy members with three months of backdated activity:

```bash
docker compose exec -T api node scripts/simulate.mjs
```

> Deploying to a droplet? Use `deploy\simulate.bat` instead — it resolves the droplet IP and
> runs the same script over SSH (`simulate.bat --status`, `--clear`, `--total`, `--days`).

This creates **60 members** (5 teachers, 10 AJK, 45 youths) with backdated attendance, Quran
recitation/memorization logs, and merits. Every account is tagged `is_dummy = TRUE`.

Remove all simulated data at any time (safe — real accounts are untouched):

```bash
docker compose exec -T api node scripts/simulate.mjs --clear
```

Tune the size with environment variables:

```bash
docker compose exec -T -e SIM_TOTAL=70 -e SIM_TEACHERS=6 -e SIM_AJK=10 -e SIM_DAYS=90 \
  api node scripts/simulate.mjs
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `SIM_TOTAL` | `60` | Total dummy members |
| `SIM_TEACHERS` | `5` | How many are teachers |
| `SIM_AJK` | `10` | How many are AJK / committee |
| `SIM_DAYS` | `90` | Days of history to backdate |

> Re-running the seed replaces the previous dummy data (it clears first), so it's safe to run
> repeatedly. Dummy phones use the `+6019000xxxx` range so they never collide with real numbers.

## Backups

The stack includes a `backup` service that takes a **nightly `pg_dump`** and can upload it to
**Cloudflare R2** (free tier — 10 GB, no egress fees). A dump of this app is ~0.5 MB, so it
stays well inside the free allowance.

```bash
docker compose exec -T backup backup.sh --once    # back up now
docker compose exec -T backup restore.sh --list   # list backups
docker compose exec -T backup restore.sh --latest # restore newest (DESTRUCTIVE)
```

Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and `R2_BUCKET` in `.env` to
enable offsite copies. Full setup, restore, and disaster-recovery steps are in
**[backup/README.md](backup/README.md)**.

> **Before go-live:** run one test restore into a scratch database. An untested backup is a
> hope, not a backup.

## Environment variables

See `.env.example`. Key ones:

| Variable | Purpose |
| --- | --- |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | Signing key for tokens. Auto-generated on the server by `deploy/sync.bat`; set any value for local dev |
| `FACE_MATCH_THRESHOLD` | Lower = stricter. `0.5–0.6` recommended |
| `OTP_CHANNEL` | `telegram` (free), `sms` (paid), or `console` (dev) |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather |
| `TELEGRAM_BOT_USERNAME` | Bot username (without `@`) |
| `TELEGRAM_POLL_TIMEOUT` | Long-poll duration in seconds (default 30) |
| `PUBLIC_URL` | Public base URL (optional; shown in links) |
| `SMS_PROVIDER` | `console`, `twilio`, or `vonage` (only when `OTP_CHANNEL=sms`) |
| `SMS_API_KEY` | Twilio: `accountSid:authToken`; Vonage: `api_key` |
| `SMS_SENDER_ID` | Sender number/ID (Twilio `From`, Vonage `from`) |
| `ADMIN_PHONES` | Comma-separated phones seeded as admins on startup |

## Login codes (OTP delivery)

**Telegram is the primary login method.** The login screen leads with a **Sign in with Telegram**
button. The user opens the bot, taps **Share my phone number**, and the bot links their account
and sends a login code straight away — free, instant, and no admin involvement.

**New members self-register through the bot.** Because Telegram verifies the shared number, an
unknown number is not rejected: the bot creates the account on the spot (role `youth`, or
`admin` if the number is in `ADMIN_PHONES`), links the chat, and sends a login code. The user
then completes their profile and enrolls their face in the app.

If a member hasn't linked Telegram yet, the app falls back through these channels:

1. **Telegram** — free, unlimited. Primary channel.
2. **SMS** — paid (Twilio/Vonage). Used when `OTP_CHANNEL=sms` and a provider is configured.
3. **Console** — logs the code to the server. Dev only.

**Admin-assisted login is the last resort.** Only when none of the above can reach a member
does the login screen suggest asking an admin, who can generate a code from the admin panel and
read it out in person.

> **Admin bootstrap:** every phone in `ADMIN_PHONES` is seeded as an active admin when the API
> starts (see `server/src/seedAdmins.js`). A fresh deploy therefore always has an admin who can
> sign in and reach the admin panel without registering first.

### Setting up Telegram (recommended — free)

1. Open Telegram and message **@BotFather** → send `/newbot` → follow the prompts.
2. Copy the **token** and the **username** into `.env`:
   ```
   OTP_CHANNEL=telegram
   TELEGRAM_BOT_TOKEN=123456:ABC...
   TELEGRAM_BOT_USERNAME=your_bot_name
   ```
3. Restart the API. The server **long-polls** Telegram for updates, so no public URL or
   webhook registration is needed — it works behind the quick tunnel and on `localhost` alike.
4. Members tap **Sign in with Telegram** on the login screen (or **Profile → Link Telegram**),
   then press **Start** and **Share my phone number**.

Once linked, codes arrive as Telegram messages — no SMS costs. Because the phone number is
shared through Telegram's verified contact button, a brand-new member can link and log in
without ever needing an admin — the account is created automatically on first contact.

> **Phone formats.** Telegram's mobile app shares a contact's number **without** the leading
> `+` (`60123456789`) while Desktop includes it (`+60123456789`). Numbers are stored
> canonically as `+60…` and matched against every equivalent spelling (`60…`, `0…`, with or
> without `+`), so linking works the same on both clients. See `server/src/utils/phone.js`.

#### How updates are received (long-polling)

The server pulls updates with `getUpdates` instead of receiving webhooks. On startup you'll see:

```
[telegram:polling] started (long-polling for updates)
```

This is the **only** delivery mode, chosen because the quick-tunnel URL changes on every
restart — polling needs no public URL, so OTP keeps working unattended. Polling automatically
clears any registered webhook, since Telegram allows only one delivery method at a time.

> **Note:** Telegram allows only **one** `getUpdates` consumer per bot token. Run a single
> `api` instance, and don't run a local stack and the deployed server with the same bot token
> at the same time — they'll fight over updates (`Conflict: terminated by other getUpdates`).

### Admin-assisted login (last resort)

In **Admin → Members**, each member has a **Code** button. It generates a one-time login code
and displays it large on screen so the admin can read it to the member. This is a **last
resort** for anyone who cannot use Telegram or a working phone — prefer helping them link
Telegram instead.

## Family accounts (children without phones)

Many youths don't have their own phone. A parent/guardian can register their children as
**dependents** under their own account:

1. Log in with your own phone number.
2. Go to **Profile → Family → Manage** (or `/family`).
3. **Add a dependent** — name, age, gender. No phone number is needed.
4. **Enroll their face** — the guardian captures the child's face once.
5. On the **Check-in** page, pick who is checking in (you or a child), then verify that
   person's face. The server only accepts a face that belongs to the selected member.

Dependents:

- have **no phone and cannot log in** on their own (they are managed entirely by the guardian);
- appear in the guardian's **attendance history**, the **leaderboard** (labelled as a child of
  their guardian), and the admin's member/attendance lists;
- are removed together with their attendance records when deleted.

### Sharing a child with a second parent

Parents often bring the same child to the surau separately. A dependent can have a
**second guardian** (co-guardian) so either parent can check the child in:

1. On **Family**, tap **Share with parent** next to the child.
2. Enter the other parent's phone number (they must already have an account).
3. Both parents now see the child in their family view and can check them in.

Tap **Stop sharing** to remove the second guardian. A child can have at most two
guardians (the primary guardian plus one co-guardian).

> **Note:** a dependent's face is matched against the selected member only, so a guardian
> cannot accidentally check in as their child (or vice versa).

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
nano .env      # set strong POSTGRES_PASSWORD, ADMIN_PHONES, SMS_*
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

### 5. HTTPS via Cloudflare Quick Tunnel

Cloudflare Tunnel gives you HTTPS with a valid certificate **without opening any inbound
ports** and without managing certificates. It is ideal here because browsers only allow
camera access (`getUserMedia`) over **HTTPS** or `localhost` — so face check-in needs HTTPS
in production.

The stack runs a **Cloudflare Quick Tunnel** by default (`quicktunnel` service). The URL is
random but **retained across normal syncs** (the container is not recreated by a plain
`docker compose up -d`); it only changes when the tunnel container restarts. It needs
**no Cloudflare account, domain, or token** — just start the stack and read the URL:

```bash
cd /opt/pemuda_surau
docker compose up -d
docker compose logs quicktunnel | grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' | tail -1
```

Your app is live at that `https://<words>.trycloudflare.com` URL with automatic TLS.

> **Note:** the quick-tunnel URL is **random and changes every time the tunnel container
> restarts** (e.g. `docker compose down`/`up`, a droplet reboot, or a compose change). A
> plain `docker compose up -d` leaves the container running, so the URL is **retained across
> normal syncs**. Use `tail -1` (not `head -1`) to read the current URL — logs accumulate
> across restarts, so the first match may be a dead URL.
> For a stable domain, add a named Cloudflare Tunnel (token + domain) as a separate service
> and point its public hostname at `HTTP` / `web:80`.

**Lock down CORS** once you know the URL (optional):

```bash
CORS_ORIGIN=https://<your-url>.trycloudflare.com
docker compose up -d api
```

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

> **Full reference:** an OpenAPI 3.0 spec lives at `web/public/openapi.yaml` and is rendered
> as an interactive Swagger UI page at **`/api-docs`** (admin-only — log in as an admin, then
> open it from the Admin page). That spec is the source of truth; the table below is a
> quick orientation only.

Auth column: **–** = public, **user** = any logged-in member, **cap** = requires a capability
(admins implicitly hold all of them).

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/api/health` | – | Health check (verifies DB connectivity) |
| GET | `/api/auth/login-options` | – | Available login channels (Telegram-first) |
| POST | `/api/auth/request-otp` | – | Send OTP to a phone (rate limited) |
| POST | `/api/auth/verify-otp` | – | Verify OTP, returns JWT (new accounts must be near the surau) |
| GET | `/api/auth/me` | user | Current profile |
| PUT | `/api/users/me` | user | Update profile |
| POST | `/api/users/me/face` | user | Enroll face descriptor |
| GET/POST | `/api/users/me/dependents` | user | List / add dependents (children) |
| PUT/DELETE | `/api/users/me/dependents/:id` | user | Update / remove a dependent |
| POST | `/api/users/me/dependents/:id/face` | user | Enroll a dependent's face |
| POST | `/api/users/me/dependents/:id/phone` | user | Give a dependent their own login |
| POST | `/api/users/me/dependents/:id/co-guardian` | user | Share a dependent with a second parent |
| GET | `/api/users` | cap `viewMembers` | List members |
| PATCH | `/api/users/:id/role` | admin | Change a member's role |
| PATCH | `/api/users/:id/active` | admin | Activate/deactivate |
| POST | `/api/users/:id/login-code` | admin | Admin-assisted login code |
| GET | `/api/attendance/current` | user | Which prayer is open now (+ next) |
| POST | `/api/attendance/check-in` | user | Face-verified, geofenced check-in |
| POST | `/api/attendance/identify` | cap `identifyMembers` | Identify a member by face (suggestion only) |
| GET | `/api/attendance/me` | user | My history |
| GET | `/api/attendance/me/today` | user | Today's prayers |
| GET | `/api/attendance/family/today` | user | Today for me + dependents |
| GET | `/api/attendance/family` | user | History for me + dependents |
| POST | `/api/attendance/manual` | admin | Manual check-in |
| GET | `/api/attendance/date/:date` | admin | Attendance for a date |
| GET | `/api/activity/merits/me` | user | My merits |
| GET/POST | `/api/activity/merits` | cap `manageMerits` | List / award merits |
| DELETE | `/api/activity/merits/:id` | cap `manageMerits` | Revoke a merit |
| GET | `/api/activity/quran/me` | user | My Quran logs |
| GET/POST | `/api/activity/quran` | cap `manageQuran` (list) / user (log) | List / log Quran activity |
| DELETE | `/api/activity/quran/:id` | user | Delete a Quran log |
| GET | `/api/dashboard/stats` | – | Overall stats |
| GET | `/api/dashboard/weekly` | – | Weekly activity (last 7 days) |
| GET | `/api/dashboard/leaderboard` | – | Rankings (`?period=month\|year\|all&category=…`) |
| GET | `/api/dashboard/me/breakdown` | user | My per-prayer counts |
| GET | `/api/programs` | user | List programs |
| POST/PUT/DELETE | `/api/programs[/:id]` | admin | Manage programs |
| POST/DELETE | `/api/programs/:id/join` | user | Join/leave |
| POST | `/api/telegram/link-token` | user | Create a Telegram link token |
| DELETE | `/api/telegram/link` | user | Unlink Telegram |
| GET | `/api/telegram/status` | admin | Telegram integration status |

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
