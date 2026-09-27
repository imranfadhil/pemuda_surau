#!/bin/sh
# ===================================================================
#  Restore a PostgreSQL backup.
#
#  Usage (inside the backup container):
#    restore.sh --list                 list available backups (local + remote)
#    restore.sh <file.dump>            restore a local backup file
#    restore.sh --remote <file.dump>   download from R2 then restore
#    restore.sh --latest               restore the newest local backup
#
#  WARNING: this DROPS and recreates the target database. It is destructive.
#  Set FORCE=1 to skip the confirmation prompt (for scripted use).
# ===================================================================
set -eu

BACKUP_DIR="${BACKUP_DIR:-/backups}"
DB_NAME="${PGDATABASE:-pemuda_surau}"

log() { echo "[restore] $*"; }

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

list_backups() {
  echo "--- local ($BACKUP_DIR) ---"
  ls -lh "$BACKUP_DIR"/*.dump 2>/dev/null || echo "(none)"
  if configure_rclone; then
    echo "--- remote (r2:$R2_BUCKET) ---"
    rclone ls "r2:$R2_BUCKET" 2>/dev/null || echo "(none / unreachable)"
  else
    echo "--- remote: not configured ---"
  fi
}

do_restore() {
  file="$1"
  if [ ! -f "$file" ]; then
    log "ERROR: file not found: $file"
    exit 1
  fi

  if [ "${FORCE:-0}" != "1" ]; then
    printf "[restore] This will DROP and recreate '%s' from %s. Continue? [y/N] " "$DB_NAME" "$file"
    read -r answer
    case "$answer" in
      y|Y) ;;
      *) log "aborted."; exit 1 ;;
    esac
  fi

  log "dropping and recreating '$DB_NAME' ..."
  psql -d postgres -v ON_ERROR_STOP=1 \
    -c "DROP DATABASE IF EXISTS \"$DB_NAME\" WITH (FORCE);" \
    -c "CREATE DATABASE \"$DB_NAME\";"

  log "restoring from $file ..."
  pg_restore -d "$DB_NAME" --no-owner --no-privileges "$file"
  log "restore complete."
}

# ---- Dispatch ------------------------------------------------------
case "${1:-}" in
  --list)
    list_backups
    ;;
  --latest)
    latest=$(ls -t "$BACKUP_DIR"/*.dump 2>/dev/null | head -1 || true)
    if [ -z "$latest" ]; then
      log "ERROR: no local backups found in $BACKUP_DIR"
      exit 1
    fi
    do_restore "$latest"
    ;;
  --remote)
    [ -n "${2:-}" ] || { log "ERROR: --remote needs a filename"; exit 1; }
    configure_rclone || { log "ERROR: R2 not configured"; exit 1; }
    mkdir -p "$BACKUP_DIR"
    log "downloading $2 from r2:$R2_BUCKET ..."
    rclone copy "r2:$R2_BUCKET/$2" "$BACKUP_DIR" --no-traverse
    do_restore "$BACKUP_DIR/$2"
    ;;
  "")
    log "usage: restore.sh --list | --latest | <file.dump> | --remote <file.dump>"
    exit 1
    ;;
  *)
    do_restore "$1"
    ;;
esac
