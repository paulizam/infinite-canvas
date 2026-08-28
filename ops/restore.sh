#!/bin/sh
set -eu
umask 077
: "${1:?usage: restore.sh BACKUP.dump}"
: "${POSTGRES_PASSWORD:?POSTGRES_PASSWORD required}"
[ "${CONFIRM_RESTORE:-}" = "RESTORE" ] || { echo 'Set CONFIRM_RESTORE=RESTORE'; exit 2; }
FILE=$1
sha256sum -c "$FILE.sha256"
docker compose stop api worker
docker compose cp "$FILE" postgres:/tmp/restore.dump
docker compose exec -T postgres pg_restore -U "${POSTGRES_USER:-infinite_canvas}" -d "${POSTGRES_DB:-infinite_canvas}" --clean --if-exists --no-owner /tmp/restore.dump
docker compose exec -T postgres rm -f /tmp/restore.dump
if [ "${BLOB_STORAGE_DRIVER:-local}" = local ]; then
  ASSET_FILE="$FILE.assets.tar.gz"
  [ -f "$ASSET_FILE" ] || { echo "Missing local asset archive: $ASSET_FILE"; exit 2; }
  cat "$ASSET_FILE" | docker compose run --rm --no-deps -T api sh -c 'find "${ASSET_LOCAL_ROOT:-/data/assets}" -mindepth 1 -maxdepth 1 -exec rm -rf -- {} + && tar -C "${ASSET_LOCAL_ROOT:-/data/assets}" -xzf -'
fi
docker compose run --rm migrate
docker compose up -d api worker
echo 'Restore completed; run the documented smoke test.'
