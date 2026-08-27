# Fusion Goal Progress

## 2026-08-27

- 完成 R0 workspace/contracts/canvas-core、版本迁移、插件 integrity/permissions/Worker sandbox。
- 新增 `apps/api`：Identity、Session、Workspace RBAC、Cloud Canvas、PostgreSQL migration/repository。
- 共享包与 API 标准 Node ESM build、API typecheck、4 项 contract tests、`dist` import 已通过。
- API 安全扫描 0 Critical/High，质量扫描通过；引入 Prettier 并清理新模块长行。
- 开始 Web Server mode adapter：新增 cookie-based typed Cloud API client 与错误边界测试。
- 完成显式 Local/Server Mode、Session 恢复、登录注册页、Workspace 选择及双语导航入口。
- 加固 Mutation runtime schema：拒绝 Document 保留字段伪造，扩展节点字段保持 round-trip。
- 完成 Cloud Canvas CRUD/snapshot sync、remote revision 分账、409 熔断与 Local/Workspace 缓存隔离。
- 完成 WebSocket Collaboration Hub、Origin/Session/project 鉴权、canonical mutation、presence、room isolation 与前端重连/去重。
- 完成 Workspace 不可变媒体素材：magic-byte 校验、SHA-256 去重、Local FS/S3 adapter、服务端 object key、RBAC、跨租户隐藏与 AssetRef 删除保护。
- 修复 PostgreSQL mutation project_id 类型漂移；初始快照及 mutation 均事务化同步 AssetRef。API 13 项测试、typecheck、build 与 dist import 通过。
- 启动 Generation Job：补齐跨端 job contract、严格 phase state machine、同 attempt upstreamTaskId 不可变规则、Job/Worker heartbeat schema；migration runner 改为 checksum ledger。API 15 项测试通过。
- 完成 Job repository contract、Memory/PostgreSQL 原子实现、用户 create/list/get/cancel/retry API 与 Worker claim/heartbeat/transition 内部 API；强 Token、租约所有权、过期回收及跨用户隐藏已覆盖测试。
- 新增独立 `apps/worker`：全局/租约 heartbeat、指数退避 claim、批次续租、取消处理、失效租约恢复、信号优雅退出及 Worker Dockerfile；Model Gateway 未配置时显式进入 needs_review。
