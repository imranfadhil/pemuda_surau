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

REM Comma-separated phone numbers that get admin rights on first login
set ADMIN_PHONES=

REM ---- Telegram (free OTP delivery) ----
REM Create a bot with @BotFather -> /newbot, then paste the token + username here.
set TELEGRAM_BOT_TOKEN=
set TELEGRAM_BOT_USERNAME=

REM How login codes are delivered: telegram | sms | console
set OTP_CHANNEL=telegram

REM SMS provider: console | twilio | vonage (only used when OTP_CHANNEL=sms)
set SMS_PROVIDER=console
set SMS_API_KEY=
set SMS_SENDER_ID=