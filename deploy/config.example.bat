@echo off
REM ===================================================================
REM  DigitalOcean deployment config
REM  Copy this file to  config.bat  and fill in your values.
REM  config.bat is gitignored so your secrets stay local.
REM
REM  Prereq: doctl installed & authenticated  ->  doctl auth init
REM ===================================================================

REM ---- Project ----
set PROJECT_NAME=pemuda-surau
REM Directory on the droplet where the app lives
set REMOTE_DIR=/opt/pemuda_surau

REM ---- Droplet ----
set DROPLET_NAME=%PROJECT_NAME%-server
REM Region: sgp1 = Singapore (lowest DO latency to Malaysia).
set REGION=sgp1
REM Size: s-1vcpu-2gb (~$12/mo, hourly-billed). 2 GB RAM gives headroom for
REM Postgres + API + web + tunnel. Use s-1vcpu-1gb (~$6/mo) to trim cost.
set SIZE=s-1vcpu-2gb
REM Docker 1-click marketplace image on Ubuntu (Docker + Compose preinstalled).
set IMAGE=docker-20-04

REM ---- SSH Key ----
REM A key of this name is registered with DO (from your local public key).
set KEY_NAME=%PROJECT_NAME%-do-key
set KEY_FILE=%USERPROFILE%\.ssh\%KEY_NAME%
set PUB_FILE=%USERPROFILE%\.ssh\%KEY_NAME%.pub

REM ---- App config ----
REM Your public domain (e.g. surau.example.com). Used for CORS + shown after deploy.
REM Leave blank if you only use the droplet IP.
set DOMAIN=

REM Cloudflare Tunnel token (named tunnel -> stable HTTPS URL).
REM Create at: Zero Trust -> Networks -> Tunnels -> Create a tunnel
REM Public hostname must point to service  HTTP  /  web:80
set CLOUDFLARE_TUNNEL_TOKEN=

REM Comma-separated phone numbers that get admin rights on first login
set ADMIN_PHONES=

REM ---- Telegram (free OTP delivery) ----
REM Create a bot with @BotFather -> /newbot, then paste the token + username here.
set TELEGRAM_BOT_TOKEN=
set TELEGRAM_BOT_USERNAME=
REM Optional random string Telegram sends in the webhook secret header
set TELEGRAM_WEBHOOK_SECRET=
REM Delivery mode: webhook (production) | polling (local dev)
set TELEGRAM_MODE=webhook

REM How login codes are delivered: telegram | sms | console
set OTP_CHANNEL=telegram

REM SMS provider: console | twilio | vonage (only used when OTP_CHANNEL=sms)
set SMS_PROVIDER=console
set SMS_API_KEY=
set SMS_SENDER_ID=

REM Compose profile to enable on the server.
REM   tunnel  = start the Cloudflare Tunnel (recommended)
REM   (blank) = app only, no public HTTPS
set COMPOSE_PROFILE=tunnel