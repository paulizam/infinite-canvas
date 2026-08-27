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
- 完成 Model Gateway 首个纵切：五层模型契约、健康/优先级路由、能力校验、AES-256-GCM channel secret、Maintenance/Worker 分权 API 与 OpenAI-compatible submit/poll Worker handler。

## 2026-08-28

- 打通生成媒体持久化：Worker 支持 provider URL/Base64 与 binary audio，下载结果通过租约绑定的内部 API 经 magic-byte 校验、Workspace 去重写入 Asset BlobStore，Job result 仅保留 AssetRef。
- Provider 媒体下载强制 credential-free HTTPS，限制重定向次数并拒绝显式 private/local host；内部上传校验 Worker Token、workerId、有效租约及持久化阶段。
- 打通 Model Gateway 运行态健康反馈：Worker 上报 submit/poll 成败，连续失败依次进入 degraded/cooldown，60 秒冷却期间 Router 自动排除，成功后恢复 healthy。
- 新增 Gemini `generateContent` 与无脚本声明式 Custom runtime adapter；Custom 仅允许安全相对路径、固定鉴权模式、静态 JSON 与字段映射。
- cancel_requested 在存在上游任务且 capability 声明支持时调用原渠道 cancel endpoint；不支持或渠道身份不确定时转 needs_review，避免虚假取消与错误退款依据。
- 新增整数积分钱包、价格规则与数据库不可变流水；Job 创建和预留同事务，成功按 provider 明示实际积分补扣/返还，失败/取消幂等退款，needs_review 保留预留等待对账。
- 新增余额、流水、参数倍率预估 API，以及 Maintenance price rule/钱包调整接口；Memory contract 覆盖重复创建不重复扣费、失败退款和实际用量结算。
- Web Cloud Platform client 新增逻辑模型、Generation Job、Billing estimate/wallet/ledger 全套 typed endpoint。
- 生成配置节点在 Server mode 登录态 debounce 获取服务端权威预估与余额，展示预计积分/余额并阻止已知余额不足提交；controller 丢弃过期响应，Local mode 经测试不触发任何 Cloud API。
