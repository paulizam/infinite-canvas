# Operations

## Server mode

```sh
cp .env.example .env
# Replace every <...> value; use independent high-entropy secrets.
docker compose up -d --build
docker compose ps
curl -fsS http://localhost:3000/health
```

`migrate` must complete before API starts. PostgreSQL and Asset data use named volumes. Web only exposes port 3000 and reverse-proxies API/WebSocket traffic.

Because Compose constructs `DATABASE_URL` from `POSTGRES_PASSWORD`, use a high-entropy URL-safe value (for example base64url) rather than reserved URI characters. API startup validates required values, encryption-key shape, token length, token separation, and previous-token expiry.

## Backup and restore

`backup.sh` creates a permission-restricted PostgreSQL custom dump plus SHA-256 sidecar and applies retention. Restore is intentionally destructive and requires `CONFIRM_RESTORE=RESTORE`; rehearse it against an isolated Compose project before production use.

```sh
BACKUP_DIR=/secure/backups ./ops/backup.sh
CONFIRM_RESTORE=RESTORE ./ops/restore.sh /secure/backups/infinite-canvas-....dump
```

Asset volume snapshots must be taken in the same maintenance window as PostgreSQL. A valid drill proves database checksum, migrations, `/health`, login, Asset download and one queued Worker job.
