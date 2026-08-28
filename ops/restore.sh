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
docker compose run --rm migrate
docker compose up -d api worker
echo 'Restore completed; run the documented smoke test.'
