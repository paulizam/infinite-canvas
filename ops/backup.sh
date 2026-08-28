#!/bin/sh
set -eu
umask 077
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
OUT=${BACKUP_DIR:-./backups}
KEEP_DAYS=${BACKUP_RETENTION_DAYS:-14}
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/infinite-canvas-$STAMP.dump"
ASSET_FILE="$FILE.assets.tar.gz"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-infinite_canvas}" -d "${POSTGRES_DB:-infinite_canvas}" --format=custom --no-owner --file=/tmp/backup.dump
docker compose cp postgres:/tmp/backup.dump "$FILE"
docker compose exec -T postgres rm -f /tmp/backup.dump
if [ "${BLOB_STORAGE_DRIVER:-local}" = local ]; then
  docker compose exec -T api tar -C "${ASSET_LOCAL_ROOT:-/data/assets}" -czf - . > "$ASSET_FILE"
  sha256sum "$FILE" "$ASSET_FILE" > "$FILE.sha256"
else
  sha256sum "$FILE" > "$FILE.sha256"
  printf '%s\n' 'S3 objects are external to this archive; enable bucket versioning and provider backups.'
fi
find "$OUT" -type f -name 'infinite-canvas-*' -mtime "+$KEEP_DAYS" -delete
printf 'Backup written: %s\n' "$FILE"
