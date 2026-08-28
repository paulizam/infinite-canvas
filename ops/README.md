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

`migrate`、API 与 Worker 以非 root 镜像运行；Compose 进一步启用只读根文件系统、drop all capabilities、`no-new-privileges` 和 `noexec/nosuid/nodev` tmpfs。API 的 `/data/assets` 命名卷是本地存储模式唯一持久可写路径；API/Worker 使用 init shim 回收子进程，尤其是中断的 FFmpeg 任务。PostgreSQL 保留官方 entrypoint 所需权限，不套用会破坏首次卷初始化的统一 capability 策略。

Because Compose constructs `DATABASE_URL` from `POSTGRES_PASSWORD`, use a high-entropy URL-safe value (for example base64url) rather than reserved URI characters. API startup validates required values, encryption-key shape, token length, token separation, and previous-token expiry.

## Backup and restore

`backup.sh` creates a permission-restricted PostgreSQL custom dump plus SHA-256 sidecar and applies retention. Restore is intentionally destructive and requires `CONFIRM_RESTORE=RESTORE`; rehearse it against an isolated Compose project before production use.

```sh
BACKUP_DIR=/secure/backups ./ops/backup.sh
CONFIRM_RESTORE=RESTORE ./ops/restore.sh /secure/backups/infinite-canvas-....dump
```

生产环境应由宿主 scheduler 调用，例如每日 UTC 02:00 的 cron：`0 2 * * * cd /srv/infinite-canvas && BACKUP_DIR=/secure/backups ./ops/backup.sh`。必须把 scheduler 失败接入告警，且至少每季度在隔离 Compose project 执行一次恢复演练。

Asset volume snapshots must be taken in the same maintenance window as PostgreSQL. A valid drill proves database checksum, migrations, `/health`, login, Asset download and one queued Worker job.

### 脱敏业务迁移包

业务迁移包保留业务实体与 UUID/FK 关系，但排除 Session、MFA、Worker heartbeat、渠道凭据、Workflow API Token、支付原始事件与 GC outbox；用户邮箱/姓名被匿名化，密码替换为不可登录的随机 Argon2 hash，嵌套 JSON 中的 credential/secret/token 自动脱敏。导出使用 repeatable-read snapshot、原子写文件、0600 权限与内嵌 SHA-256。

```sh
pnpm --filter @infinite-canvas/api business:transfer export /secure/export/business.json
pnpm --filter @infinite-canvas/api business:transfer verify /secure/export/business.json
# 只导入已执行全部 migration 的隔离空数据库；导入为单事务，失败自动回滚。
CONFIRM_BUSINESS_IMPORT=IMPORT pnpm --filter @infinite-canvas/api business:transfer import /secure/export/business.json
```

导入默认逐表检查目标为空；`--allow-nonempty` 只用于经过评审的灾难恢复，不提供静默 upsert。媒体二进制仍须用同一维护窗口的 Asset volume/object-store snapshot 搬迁。

## Release and supply-chain gates

```sh
pnpm security:secrets
pnpm licenses:check
pnpm audit --registry=https://registry.npmjs.org --audit-level high
pnpm release:check
```

`release:check` verifies VERSION/tag consistency, product brand, required documentation, sensitive tracked files, the immutable migration checksum manifest and generated third-party notices. `quality-security.yml` additionally runs Gitleaks, PostgreSQL migrations twice, Syft SPDX SBOM generation, Trivy filesystem/image scans, Compose validation and all three container builds. When adding a migration, never edit a previously shipped SQL file; add the next numbered file and deliberately run `node ops/migration-manifest.mjs`.

## External runtime preflight

在执行真实 Provider、Volcengine 或剪映桌面验收前运行：

```powershell
pnpm runtime:preflight -- --allow-pending
pnpm runtime:preflight -- --json --allow-pending
```

严格模式 `pnpm runtime:preflight` 在任一条件缺失时返回 exit code `2`，适合验收脚本 fail closed；`--allow-pending` 只用于查看准备状态。报告只显示环境变量或路径是否存在，不输出 API Key、AK/SK 或文件内容。所需配置包括：

- `PROVIDER_SANDBOX_CASES_FILE` 及 case 中声明的 `apiKeyEnv`
- `VOLCENGINE_SANDBOX_BASE_URL`、`VOLCENGINE_SANDBOX_ACCESS_KEY_ID`、`VOLCENGINE_SANDBOX_SECRET_ACCESS_KEY`
- `JIANYING_EXECUTABLE`、`JIANYING_DRAFT_ROOT`、`FFMPEG_PATH`

Case file 必须保存在仓库外，只保存密钥环境变量名称，不保存密钥本身；Preflight 强制 Provider URL 使用 HTTPS。
