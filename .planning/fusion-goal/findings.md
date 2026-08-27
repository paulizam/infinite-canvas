# Fusion Goal Findings

- 当前分支：`feat/fusion-platform`；不合并 `main`。
- 共享包此前直接 export TypeScript 源码，仅适配 bundler，不满足标准 Node `dist` 运行。
- API 使用 Argon2 password hash、SHA-256 session token hash、HttpOnly/SameSite Strict cookie。
- Cloud Canvas mutation 使用 revision 乐观并发与 mutationId 幂等；PostgreSQL 写路径使用 transaction/`FOR UPDATE`。
- 跨租户按资源 ID 查询统一返回 404，避免资源枚举。
- 本机无 Docker/PostgreSQL runtime；真实 migration/integration 暂为 `[unverified]`，内存 repository contract tests 已覆盖领域语义。
