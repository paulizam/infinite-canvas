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

## Release and supply-chain gates

```sh
pnpm security:secrets
pnpm licenses:check
pnpm audit --registry=https://registry.npmjs.org --audit-level high
pnpm release:check
```

`release:check` verifies VERSION/tag consistency, product brand, required documentation, sensitive tracked files, the immutable migration checksum manifest and generated third-party notices. `quality-security.yml` additionally runs Gitleaks, PostgreSQL migrations twice, Syft SPDX SBOM generation, Trivy filesystem/image scans, Compose validation and all three container builds. When adding a migration, never edit a previously shipped SQL file; add the next numbered file and deliberately run `node ops/migration-manifest.mjs`.
