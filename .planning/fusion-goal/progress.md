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
- Canvas Server mode 主生成链改走 Cloud Generation Job：按 capability 解析默认逻辑模型，以稳定 clientRequestId 创建任务并轮询终态；浏览器 Abort 会请求服务端取消，失败/needs_review 保留诊断。
- Cloud text 兼容 Gemini/OpenAI 结果归一化；image/video/audio 从 Job AssetRef 经 Session 鉴权下载 Blob，再复用现有本地媒体存储与节点回填，后端 reservation 成为权威扣费边界。
- Cloud 参考图改为浏览器先上传 Workspace Asset，Job input 仅保存 AssetRef；并行相同引用使用 single-flight，服务端 SHA-256 继续兜底去重。
- 新增租约绑定的 Worker input Asset 读取端点；严格校验 Worker Token、workerId、有效 lease 与 Workspace，S3 也由 API 读取原始字节，避免重定向携带内部请求头。
- Worker Provider submit 前递归物化 AssetRef，单任务限制 16 个唯一输入、64MiB 原始字节，重复引用只读取一次且 Data URL 不回写 Job。
- 将 Worker AssetRef materializer 拆出 gateway handler，并将占位字符串修正为 Promise single-flight，重复引用会等待同一读取结果而非把 `pending` 送给 Provider。
- 新增 Canvas generation provider facade，统一 Local/Cloud text/image/video/audio 调用；主生成、批量槽位、Retry、Mask Edit、Angle Edit 全部共享逻辑，Server mode 不再落回浏览器 Provider credential。
- Video Cloud Job 同步携带 image/video/audio 引用 AssetRef；多模态 text 的 `image_url.url` 保持 AssetRef 到 Worker 才物化。Job 成功、失败或取消结束后广播 Billing 刷新事件。
- Model Gateway 新增 runtime channel lookup，PostgreSQL 仅在连接测试/模型发现调用期间解密 AES-GCM credential，公开 DTO 继续只暴露 credentialConfigured。
- 新增独立 Model Discovery service/API：OpenAI `/v1/models`、Gemini `/v1beta/models`、显式 Custom catalog path；支持模型 ID 去前缀、去重和 displayName。
- Discovery 出站请求实施禁止 redirect、30 秒 timeout、DNS 后 private/reserved IP 拒绝（显式 allowPrivateNetwork 才放行）、2MiB 流式上限和无 Provider body 的错误映射；成功/失败反馈该 Channel 下 upstream health。
- 接续 OPS 阶段：确认 Goal 仍为 active、分支为 `feat/fusion-platform`；部署骨架尚未提交。发现根目录 `FUNCTIONAL_SPEC.md` 并不存在，后续以 `docs/requirements/functional-spec.md` 为权威功能规格。
- OPS 可观测纵切落地：W3C traceparent、受约束 requestId、规范化 route JSON 日志、unexpected error 脱敏与 Maintenance-only Prometheus metrics；Memory/PostgreSQL Job Repository 提供 queue depth/age、过期租约和 Worker heartbeat 聚合。API typecheck 与 24 files / 65 tests 通过。
- Compose 静态加固：API Asset volume 预置 node 用户权限；恢复流程改为 migration 成功后再启动 API/Worker；Nginx CSP 保留 Local mode 的显式 HTTP/WS Provider 能力。Compose YAML 已由 Python parser 验证，真实 Docker/PostgreSQL 仍因本机缺失标记 `[unverified]`。
