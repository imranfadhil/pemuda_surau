#!/bin/sh
# ===================================================================
#  Nightly PostgreSQL backup.
#
#  - Dumps the database with pg_dump (custom format, compressed).
#  - Keeps a local copy in /backups (a Docker volume).
#  - Uploads to Cloudflare R2 (or any S3-compatible store) when configured.
#  - Prunes local + remote copies older than BACKUP_RETENTION_DAYS.
#
#  Usage:
#    backup.sh          run the nightly scheduler (default)
#    backup.sh --once   take a single backup now and exit
# ===================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
BACKUP_HOUR="${BACKUP_HOUR:-3}"
DB_NAME="${PGDATABASE:-pemuda_surau}"

log() { echo "[backup] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# Configure an rclone "r2" remote from env vars. Returns 1 when not configured.
configure_rclone() {
  if [ -n "${R2_ACCOUNT_ID:-}" ] && [ -n "${R2_ACCESS_KEY_ID:-}" ] \
     && [ -n "${R2_SECRET_ACCESS_KEY:-}" ] && [ -n "${R2_BUCKET:-}" ]; then
    export RCLONE_CONFIG_R2_TYPE=s3
    export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
    export RCLONE_CONFIG_R2_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
    export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
    export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
    return 0
  fi
  return 1
}

run_backup() {
  mkdir -p "$BACKUP_DIR"
  ts=$(date '+%Y-%m-%d_%H%M%S')
  file="$BACKUP_DIR/${DB_NAME}_${ts}.dump"

  log "dumping '$DB_NAME' ..."
  if ! pg_dump -Fc -f "$file"; then
    log "ERROR: pg_dump failed"
    rm -f "$file"
    return 1
  fi
  log "dump complete: $file ($(du -h "$file" | cut -f1))"

  if configure_rclone; then
    log "uploading to r2:$R2_BUCKET ..."
    if rclone copy "$file" "r2:$R2_BUCKET" --no-traverse; then
      log "upload ok"
    else
      log "WARN: upload failed - local copy kept"
    fi
  else
    log "R2 not configured - keeping local backup only"
  fi

  # Prune old local dumps.
  find "$BACKUP_DIR" -name '*.dump' -type f -mtime +"$RETENTION_DAYS" -delete 2>/dev/null || true
  log "pruned local backups older than ${RETENTION_DAYS}d"

  # Prune old remote dumps.
  if configure_rclone; then
    rclone delete "r2:$R2_BUCKET" --min-age "${RETENTION_DAYS}d" 2>/dev/null || true
    log "pruned remote backups older than ${RETENTION_DAYS}d"
  fi
}

# ---- One-shot mode -------------------------------------------------
if [ "${1:-}" = "--once" ]; then
  run_backup
  exit $?
fi

# ---- Scheduler -----------------------------------------------------
log "scheduler started (daily at ${BACKUP_HOUR}:00, retention ${RETENTION_DAYS}d)"
if configure_rclone; then
  log "offsite target: r2:$R2_BUCKET"
else
  log "offsite target: none (set R2_* env vars to enable)"
fi

# Take one backup immediately so a fresh deploy is protected right away.
run_backup || true

last_run=""
while true; do
  today=$(date '+%Y-%m-%d')
  hour=$(date '+%H')
  # Strip a leading zero so the numeric comparison works (e.g. "03" -> "3").
  hour=$((10#$hour))
  if [ "$hour" -eq "$BACKUP_HOUR" ] && [ "$last_run" != "$today" ]; then
    run_backup || true
    last_run="$today"
  fi
  sleep 300
done
