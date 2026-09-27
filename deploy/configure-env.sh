#!/bin/sh
# Configure the droplet's .env from deploy/config.bat.
#
# Piped over stdin by sync.bat (`ssh ... "bash -s -- <args>" < configure-env.sh`)
# so cmd.exe never has to quote the shell code. Values arrive as positional
# args, so tokens containing ':' or '+' are never re-parsed by cmd.exe.
#
#   $1  REMOTE_DIR
#   $2  ADMIN_PHONES
#   $3  OTP_CHANNEL
#   $4  TELEGRAM_BOT_TOKEN
#   $5  TELEGRAM_BOT_USERNAME
#   $6  SMS_PROVIDER
#   $7  SMS_API_KEY
#   $8  SMS_SENDER_ID
#   $9  DOMAIN
set -e

REMOTE_DIR="$1"; shift
cd "$REMOTE_DIR"

# Generate secrets only while the line is still a placeholder, so they are
# never overwritten on later syncs.
if grep -q '^JWT_SECRET=change_this' .env; then
  sed -i "s#^JWT_SECRET=.*#JWT_SECRET=$(openssl rand -hex 32)#" .env
fi

# Rotate the DB password ONLY before the database volume exists. Postgres
# applies POSTGRES_PASSWORD on first init only, so rotating it after the volume
# is created would leave the DB expecting the old password and break the API.
if ! docker volume ls -q | grep -q '_db_data$'; then
  if grep -q '^POSTGRES_PASSWORD=change_this' .env; then
    sed -i "s#^POSTGRES_PASSWORD=.*#POSTGRES_PASSWORD=$(openssl rand -hex 16)#" .env
  fi
fi

# Set a key only when a value was supplied (empty config values are skipped).
set_kv() {
  if [ -n "$2" ]; then
    sed -i "s#^$1=.*#$1=$2#" .env
  fi
}

set_kv ADMIN_PHONES "$1"
set_kv OTP_CHANNEL "$2"
set_kv TELEGRAM_BOT_TOKEN "$3"
set_kv TELEGRAM_BOT_USERNAME "$4"
set_kv SMS_PROVIDER "$5"
set_kv SMS_API_KEY "$6"
set_kv SMS_SENDER_ID "$7"

if [ -n "$8" ]; then
  set_kv CORS_ORIGIN "https://$8"
  set_kv PUBLIC_URL "https://$8"
fi

echo '--- applied ---'
grep -E '^(ADMIN_PHONES|OTP_CHANNEL|TELEGRAM_BOT_USERNAME|SMS_PROVIDER|CORS_ORIGIN|PUBLIC_URL)=' .env || true
