#!/bin/sh
set -eu
umask 077
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
OUT=${BACKUP_DIR:-./backups}
KEEP_DAYS=${BACKUP_RETENTION_DAYS:-14}
mkdir -p "$OUT"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="$OUT/infinite-canvas-$STAMP.dump"
docker compose exec -T postgres pg_dump -U "${POSTGRES_USER:-infinite_canvas}" -d "${POSTGRES_DB:-infinite_canvas}" --format=custom --no-owner --file=/tmp/backup.dump
docker compose cp postgres:/tmp/backup.dump "$FILE"
docker compose exec -T postgres rm -f /tmp/backup.dump
sha256sum "$FILE" > "$FILE.sha256"
find "$OUT" -type f -name 'infinite-canvas-*' -mtime "+$KEEP_DAYS" -delete
printf 'Backup written: %s\n' "$FILE"
