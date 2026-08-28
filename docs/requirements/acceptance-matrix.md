# 133 项功能验收矩阵

> 由 `node ops/requirements-audit.mjs` 从 `docs/requirements/functional-spec.md` 生成。`SOURCE-EVIDENCE` 仅表示已定位领域实现与测试入口，不等价于该需求最终 PASS；`RUNTIME-PENDING` 表示还必须在真实 Docker/PostgreSQL、外部 Provider、WebDAV、支付沙箱或媒体工具链中取得运行证据。矩阵不以“未发现 TODO”或宽泛领域测试替代逐项验收。

## 汇总

- 总需求：133
- 已定位源码/测试入口：129
- 实机/外部环境待验：4
- 待验 ID：GEN-008、GEN-017、GEN-018、DRM-008

## 逐项证据

| ID | P | 状态 | 验收目标 | 当前权威证据 |
|---|---:|---|---|---|
| BAS-001 | P0 | SOURCE-EVIDENCE | 主题、响应式工作区、中文/英文；刷新后偏好保持，移动端关键操作可达。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-002 | P0 | SOURCE-EVIDENCE | Local mode 无需注册即可创建、保存、导入导出项目。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-003 | P0 | SOURCE-EVIDENCE | 邮箱/密码注册登录、退出、Session 续期；密码哈希且 Session 可撤销。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-004 | P0 | SOURCE-EVIDENCE | 安装向导创建首个管理员；安装 token 一次性使用。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-005 | P1 | SOURCE-EVIDENCE | 邮箱验证、忘记/重置密码、登录保护与频率限制。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-006 | P1 | SOURCE-EVIDENCE | 管理员 TOTP MFA 设置、挑战、恢复与强制撤销 Session。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-007 | P1 | SOURCE-EVIDENCE | Workspace/Organization、邀请、成员、owner/admin/editor/viewer RBAC。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-008 | P1 | SOURCE-EVIDENCE | 个人空间与团队空间切换；资源查询严格 tenant 隔离。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-009 | P2 | SOURCE-EVIDENCE | 账户资料、头像、绑定信息、账户注销申请与数据保留流程。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| BAS-010 | P1 | SOURCE-EVIDENCE | Local 项目显式上传云端；上传失败不破坏本地原件。 | `apps/api/src/app.test.ts`<br>`web/src/services/cloud-platform.test.ts` |
| CAN-001 | P0 | SOURCE-EVIDENCE | 创建、搜索、重命名、复制、删除、多选删除项目。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-002 | P0 | SOURCE-EVIDENCE | 平移、缩放、适配、重置、小地图、网格/点阵/空白背景。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-003 | P0 | SOURCE-EVIDENCE | 节点拖拽、缩放、多选、框选、层级、对齐、复制粘贴、删除。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-004 | P0 | SOURCE-EVIDENCE | 节点连线、断开、选中上下游、连接命中与关系高亮。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-005 | P0 | SOURCE-EVIDENCE | Undo/Redo 覆盖所有结构化 CanvasOperation；刷新不污染历史。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-006 | P0 | SOURCE-EVIDENCE | 文本、图片、视频、音频、生成配置等内置节点。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-007 | P0 | SOURCE-EVIDENCE | 文件拖入画布，按类型创建节点并保存媒体引用。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-008 | P0 | SOURCE-EVIDENCE | 导入/导出整项目或选中节点，资源随包；兼容 export v3。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-009 | P0 | SOURCE-EVIDENCE | 图片裁剪、遮罩、旋转/角度、拆分、放大、取视频帧。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-010 | P0 | SOURCE-EVIDENCE | Prompt/参考素材通过连接或 mention 绑定生成节点。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-011 | P0 | SOURCE-EVIDENCE | 生成节点记录 prompt、model、尺寸、画质、时长、参考和 attempt。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-012 | P1 | SOURCE-EVIDENCE | Canvas 与 Creative Studio 双视图，切换不改变项目数据。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-013 | P1 | SOURCE-EVIDENCE | 云端 snapshot + patch + revision 保存；冲突不静默覆盖。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-014 | P1 | SOURCE-EVIDENCE | 未安装插件节点显示 fallback，原始数据可导出/再导入不丢失。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-015 | P1 | SOURCE-EVIDENCE | 项目模板、封面、文件夹、最近访问与收藏。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| CAN-016 | P2 | SOURCE-EVIDENCE | Canvas Agent Run 分析节点关系、执行任务并把结果写回目标节点。 | `packages/canvas-core/src/core.test.ts`<br>`web/src/lib/canvas/canvas-import.test.ts` |
| GEN-001 | P0 | SOURCE-EVIDENCE | 文本问答/改写，支持 streaming、system prompt 和 reasoning 参数。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-002 | P0 | SOURCE-EVIDENCE | 文生图、图生图、多参考图编辑、透明背景、多结果。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-003 | P0 | SOURCE-EVIDENCE | 文生视频、首帧/首尾帧、参考素材、比例、画质、时长。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-004 | P0 | SOURCE-EVIDENCE | 文本转音频/语音，保存 mime、duration 和原件。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-005 | P0 | SOURCE-EVIDENCE | 多渠道 OpenAI-compatible Base URL、模型列表和自定义调用脚本。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-006 | P0 | SOURCE-EVIDENCE | Protocol/Channel/Upstream Model/Logical Model/Capability 分层配置。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-007 | P0 | SOURCE-EVIDENCE | 逻辑模型候选优先级、默认模型和兼容能力校验。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-008 | P1 | RUNTIME-PENDING | OpenAI、Gemini、Seedance、Stable Diffusion、A1111/Forge adapter。 | `packages/model-gateway/src/provider-adapters.ts`<br>`packages/model-gateway/src/provider-specific.ts`<br>`apps/worker/src/provider-runtime.ts`<br>`packages/model-gateway/src/router.test.ts`<br>`packages/model-gateway/src/provider-specific.test.ts`<br>`apps/worker/src/provider-runtime.test.ts`<br>`apps/worker/src/gateway-handler.test.ts`<br>`apps/worker/src/provider-sandbox-runtime.integration.test.ts`<br>Command: `PROVIDER_SANDBOX_CASES_FILE=/secure/cases.json pnpm --filter @infinite-canvas/worker test -- src/provider-sandbox-runtime.integration.test.ts`<br>Needs: Provider sandbox credentials and endpoints |
| GEN-009 | P1 | SOURCE-EVIDENCE | 声明式自定义协议；测试连接、获取模型、映射字段、预览请求。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-010 | P0 | SOURCE-EVIDENCE | `clientRequestId` 幂等；同一 attempt 只创建一次上游任务。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-011 | P0 | SOURCE-EVIDENCE | 持久 Job 支持 lease、heartbeat、poll/webhook、页面关闭后恢复。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-012 | P0 | SOURCE-EVIDENCE | cancel、明确失败、主动 retry；retry 创建新 attempt，不隐式重复消费。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-013 | P0 | SOURCE-EVIDENCE | 失败/取消幂等退款；成功记录实际用量和媒体结果。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-014 | P1 | SOURCE-EVIDENCE | 生成运维：卡死、失联 Worker、异常持久化、needs_review 人工处理。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-015 | P1 | SOURCE-EVIDENCE | 历史恢复、批次结果、失败原因、原件下载、WebP 预览。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-016 | P1 | SOURCE-EVIDENCE | 参数倍率与预估积分；提交前显示预计消耗。 | `apps/api/src/generation-job-api.test.ts`<br>`apps/worker/src/gateway-handler.test.ts` |
| GEN-017 | P2 | RUNTIME-PENDING | 火山引擎 AK/SK 接入、模型/资源包导入与消耗查询。 | `packages/model-gateway/src/volcengine.ts`<br>`apps/api/src/model-discovery.ts`<br>`packages/model-gateway/src/volcengine.test.ts`<br>`apps/api/src/model-discovery.test.ts`<br>Command: `pnpm --filter @infinite-canvas/model-gateway test && pnpm --filter @infinite-canvas/api test`<br>Needs: Volcengine sandbox AK/SK |
| GEN-018 | P2 | RUNTIME-PENDING | AI MediaKit/画质增强等 provider-specific capability 插件化。 | `packages/model-gateway/src/provider-specific.ts`<br>`apps/worker/src/provider-runtime.ts`<br>`packages/model-gateway/src/provider-specific.test.ts`<br>`apps/worker/src/provider-runtime.test.ts`<br>`apps/worker/src/provider-sandbox-runtime.integration.test.ts`<br>Command: `PROVIDER_SANDBOX_CASES_FILE=/secure/cases.json pnpm --filter @infinite-canvas/worker test -- src/provider-sandbox-runtime.integration.test.ts`<br>Needs: MediaKit sandbox endpoint |
| AGT-001 | P0 | SOURCE-EVIDENCE | 本地 Canvas Agent 连接 Codex，MCP 读取 snapshot/selection 并应用 operations。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-002 | P0 | SOURCE-EVIDENCE | 多 tab session 隔离、streaming、历史、诊断、approval 与权限展示。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-003 | P1 | SOURCE-EVIDENCE | Claude Code adapter 升级为可维护 Agent SDK adapter。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-004 | P1 | SOURCE-EVIDENCE | 统一创作 Agent 会话同时支持文本、图片、视频、音频和参考素材。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-005 | P1 | SOURCE-EVIDENCE | 智能 planning、手动逻辑模型、参数约束和 Skill policy。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-006 | P1 | SOURCE-EVIDENCE | Agent Run 任务认领、事件流、子任务、结果项、失败恢复和审计。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-007 | P1 | SOURCE-EVIDENCE | Agent 生成结果发送至 Canvas、素材库、短剧项目。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-008 | P1 | SOURCE-EVIDENCE | Skills 分类、启停、导入、资源文件、触发规则与能力约束。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-009 | P2 | SOURCE-EVIDENCE | 从检索结果安装 Skill；安装前展示来源、文件与权限。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-010 | P1 | SOURCE-EVIDENCE | 删除、批量付费生成、外部访问必须 approval；操作留审计记录。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| AGT-011 | P2 | SOURCE-EVIDENCE | 远端团队 Agent adapter，与本地 Agent 共用 tool contract。 | `apps/api/src/agent-run-api.test.ts`<br>`apps/worker/src/agent-runtime.test.ts` |
| WFL-001 | P1 | SOURCE-EVIDENCE | typed input/output ports、节点 schema、edge type compatibility。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-002 | P1 | SOURCE-EVIDENCE | DAG 校验：缺参、非法环、不可达节点、credential 和 capability。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-003 | P1 | SOURCE-EVIDENCE | Canvas 显式发布为 Workflow，返回 error/warning 与 source node mapping。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-004 | P1 | SOURCE-EVIDENCE | 全量执行、从选中节点执行、单节点重试、取消。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-005 | P1 | SOURCE-EVIDENCE | 拓扑分层并行、条件分支、skip reason、sub-step。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-006 | P1 | SOURCE-EVIDENCE | execution/node execution 状态、输入输出快照、timeline 和错误定位。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-007 | P1 | SOURCE-EVIDENCE | 持久 step retry、sleep、waitForEvent、Worker 重启恢复。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-008 | P2 | SOURCE-EVIDENCE | Webhook、表单、邮件、计划任务等 trigger nodes。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-009 | P2 | SOURCE-EVIDENCE | Workflow 模板、文件夹、封面、导入导出和版本。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| WFL-010 | P2 | SOURCE-EVIDENCE | API snippet/公开调用 endpoint，具备 token scope 与限流。 | `packages/workflow-runtime/src/compiler.test.ts`<br>`apps/api/src/workflow-api.test.ts` |
| AST-001 | P0 | SOURCE-EVIDENCE | 图片、视频、音频、文件、Prompt 素材入库、搜索、筛选、删除。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-002 | P0 | SOURCE-EVIDENCE | local/S3 provider；历史资产按自身 provider 读取。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-003 | P0 | SOURCE-EVIDENCE | stable storageKey/AssetRef，原件与 preview variant 分离。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-004 | P0 | SOURCE-EVIDENCE | 上传格式、大小、归属校验；服务端 UUID 重命名。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-005 | P0 | SOURCE-EVIDENCE | 鉴权媒体读取和短期 signed URL，不暴露 bucket secret。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-006 | P1 | SOURCE-EVIDENCE | 引用保护、对象迁移、孤儿扫描、retention GC。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-007 | P1 | SOURCE-EVIDENCE | WebDAV 分域同步 Canvas/Assets/生成记录与媒体。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-008 | P1 | SOURCE-EVIDENCE | 七个内置 Prompt sources，自定义 JSON source、刷新、缓存、标签检索。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-009 | P1 | SOURCE-EVIDENCE | 运营提示词库、分类、上下架；一键送入 Agent/Canvas/短剧。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| AST-010 | P2 | SOURCE-EVIDENCE | content hash 去重、媒体版本与来源血缘。 | `apps/api/src/asset-references.test.ts`<br>`apps/api/src/asset-provider-switch-runtime.integration.test.ts`<br>`web/src/services/webdav-sync.ts` |
| PLG-001 | P0 | SOURCE-EVIDENCE | Plugin SDK 支持节点 render、inspector、serialization、migration、toolbar。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| PLG-002 | P0 | SOURCE-EVIDENCE | 内置 HTML、Markdown、SVG、Panorama、Sticky Note 节点。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| PLG-003 | P0 | SOURCE-EVIDENCE | manifest 声明 app version、permissions、network allowlist、integrity/signature。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| PLG-004 | P0 | SOURCE-EVIDENCE | 远程插件 sandboxed iframe/Worker；不能直接读取主应用 storage/secrets。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| PLG-005 | P1 | SOURCE-EVIDENCE | Registry 安装、启停、更新、卸载、版本固定与撤销。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| PLG-006 | P1 | SOURCE-EVIDENCE | 安装/升级前权限 diff；用户明确确认新增权限。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| PLG-007 | P2 | SOURCE-EVIDENCE | 插件运行错误隔离、资源限额、诊断与兼容报告。 | `web/src/lib/canvas/plugin-manifest.test.ts`<br>`web/src/lib/canvas/plugin-sandbox.test.ts`<br>`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts` |
| COL-001 | P1 | SOURCE-EVIDENCE | WebSocket 多端实时同步 node/edge/viewport patches。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| COL-002 | P1 | SOURCE-EVIDENCE | revision + mutationId；重复 patch 幂等，过期 baseRevision 返回 conflict。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| COL-003 | P1 | SOURCE-EVIDENCE | 500ms debounce persistence，最后客户端离开前 flush。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| COL-004 | P1 | SOURCE-EVIDENCE | presence、光标、选区、在线成员，不写入永久文档。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| COL-005 | P1 | SOURCE-EVIDENCE | viewer 只读、editor 可写；服务端逐 patch 鉴权。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| COL-006 | P2 | SOURCE-EVIDENCE | 离线 operation queue、重连 rebase 与人工冲突解决。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| COL-007 | P2 | SOURCE-EVIDENCE | 项目版本快照、命名 checkpoint、恢复为新 revision。 | `apps/api/src/collaboration.test.ts`<br>`web/src/services/cloud-collaboration.test.ts` |
| DRM-001 | P2 | SOURCE-EVIDENCE | 新建短剧项目、来源文本/文件导入、剧本富文本与版本。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-002 | P2 | SOURCE-EVIDENCE | 剧本拆分、内容审核、分析任务、分段合并和人工修订。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-003 | P2 | SOURCE-EVIDENCE | 角色、场景、道具档案与参考图，跨分镜复用。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-004 | P2 | SOURCE-EVIDENCE | 分镜/镜头列表、Prompt、景别、运镜、时长和顺序。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-005 | P2 | SOURCE-EVIDENCE | 镜头图片/视频生成、版本选择、失败重试与成本汇总。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-006 | P2 | SOURCE-EVIDENCE | 配音、音色、对白、背景音、字幕与时间轴。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-007 | P2 | SOURCE-EVIDENCE | FFmpeg 合成、进度、失败恢复、成片版本和原件下载。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-008 | P2 | RUNTIME-PENDING | 剪映草稿导出；输出可被目标版本正常导入。 | `apps/worker/src/drama-render-runtime.ts`<br>`apps/worker/src/drama-render-runtime.test.ts`<br>Command: `pnpm --filter @infinite-canvas/worker test`<br>Needs: Target Jianying desktop version |
| DRM-009 | P2 | SOURCE-EVIDENCE | 短剧资产与通用素材库/Canvas 双向发送。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| DRM-010 | P3 | SOURCE-EVIDENCE | 团队批注、镜头审批和生产状态看板。 | `apps/api/src/drama-api.test.ts`<br>`apps/worker/src/drama-render-runtime.test.ts` |
| COM-001 | P2 | SOURCE-EVIDENCE | 作品草稿、封面、描述、标签、可见性和发布版本快照。 | `apps/api/src/community-api.test.ts`<br>`apps/api/src/community-service.ts` |
| COM-002 | P2 | SOURCE-EVIDENCE | 提交审核、通过/驳回、下架、修改后重发。 | `apps/api/src/community-api.test.ts`<br>`apps/api/src/community-service.ts` |
| COM-003 | P2 | SOURCE-EVIDENCE | 广场搜索、筛选、推荐分页、作品详情与分享。 | `apps/api/src/community-api.test.ts`<br>`apps/api/src/community-service.ts` |
| COM-004 | P2 | SOURCE-EVIDENCE | 作者主页、点赞、关注及计数一致性。 | `apps/api/src/community-api.test.ts`<br>`apps/api/src/community-service.ts` |
| COM-005 | P2 | SOURCE-EVIDENCE | 举报、治理原因、操作人、时间与 audit trail。 | `apps/api/src/community-api.test.ts`<br>`apps/api/src/community-service.ts` |
| COM-006 | P3 | SOURCE-EVIDENCE | 评论、收藏、合集；均具备反滥用与可治理能力。 | `apps/api/src/community-api.test.ts`<br>`apps/api/src/community-service.ts` |
| BIL-001 | P1 | SOURCE-EVIDENCE | 积分钱包、不可变流水、余额查询与后台调整审计。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-002 | P1 | SOURCE-EVIDENCE | 模型基础价、参数倍率、预估价、原子扣费与幂等退款。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-003 | P2 | SOURCE-EVIDENCE | 商品/套餐、免费额度、促销、优惠券、CDK。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-004 | P2 | SOURCE-EVIDENCE | 邀请码、邀请关系、奖励规则和防重复领取。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-005 | P2 | SOURCE-EVIDENCE | 订单创建、支付跳转/二维码、状态查询与过期关闭。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-006 | P2 | SOURCE-EVIDENCE | 支付 webhook 签名、重放防护、event id 去重。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-007 | P2 | SOURCE-EVIDENCE | 退款申请、渠道退款、积分回滚、失败补偿。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| BIL-008 | P2 | SOURCE-EVIDENCE | 对账、财务流水、收入/退款/模型成本统计。 | `apps/api/src/commerce-api.test.ts`<br>`apps/api/src/payment-service.test.ts`<br>`apps/api/src/payment-sandbox-runtime.integration.test.ts` |
| ADM-001 | P1 | SOURCE-EVIDENCE | Dashboard：用户、任务、调用、媒体、积分与系统健康。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-002 | P1 | SOURCE-EVIDENCE | 用户检索、状态、角色、积分、Session 撤销和操作审计。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-003 | P1 | SOURCE-EVIDENCE | 五步模型渠道向导、协议、连接测试、模型同步、逻辑模型启用。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-004 | P1 | SOURCE-EVIDENCE | 生成任务检索、phase/attempt/provider/error、恢复/取消/review。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-005 | P1 | SOURCE-EVIDENCE | 对象存储配置、连通测试、迁移、占用和孤儿检查。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-006 | P2 | SOURCE-EVIDENCE | 套餐、促销、优惠券、CDK、订单、支付、退款、对账。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-007 | P2 | SOURCE-EVIDENCE | 作品审核、举报、下架、公告与提示词运营。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-008 | P1 | SOURCE-EVIDENCE | 审计日志按 actor/action/resource/requestId 查询和导出。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-009 | P1 | SOURCE-EVIDENCE | 站点品牌、注册策略、邮件、代理、生成并发和功能开关。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| ADM-010 | P1 | SOURCE-EVIDENCE | 配置保存前校验，secret 字段只显示配置状态，不回显明文。 | `apps/api/src/admin-domain-api.test.ts`<br>`web/src/pages/admin/model-commerce.tsx` |
| OPS-001 | P0 | SOURCE-EVIDENCE | Docker Compose 一键启动 web/api/worker/Postgres，healthcheck 可判活。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-002 | P0 | SOURCE-EVIDENCE | `.env.example` 覆盖必需配置，安装前强度校验，不含真实密钥。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-003 | P1 | SOURCE-EVIDENCE | 定时备份、恢复演练、脱敏业务导出导入。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-004 | P1 | SOURCE-EVIDENCE | Worker heartbeat、queue age、卡死任务告警。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-005 | P1 | SOURCE-EVIDENCE | requestId/jobId 全链路日志、metrics 和 traces，secret 自动脱敏。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-006 | P0 | SOURCE-EVIDENCE | CSP、CSRF/Origin、防 IDOR、参数化 SQL、上传校验、SSRF 防护。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-007 | P0 | SOURCE-EVIDENCE | secret scan、依赖/license inventory、SBOM、镜像漏洞扫描。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-008 | P1 | SOURCE-EVIDENCE | 管理员 MFA、维护/Worker token 分权与轮换。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-009 | P1 | SOURCE-EVIDENCE | 数据 retention、账户注销、媒体 GC 和审计保留策略。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |
| OPS-010 | P1 | SOURCE-EVIDENCE | release check：版本、品牌、文档、敏感文件、migration 与 notices。 | `.github/workflows/quality-security.yml`<br>`ops/README.md` |

## 最终运行证据门槛

1. 当前 commit 在本机通过 `pnpm release:check`；GitHub Actions 已按仓库所有者要求保持禁用，不以远端 workflow 代替本机验收。
2. 隔离 Compose 环境完成注册登录、Workspace/Canvas、Asset 上传下载、Generation Worker、Workflow Worker、Drama FFmpeg 与备份恢复 smoke。
3. 使用所有者提供的测试账户完成 Seedance、Stable Diffusion/A1111/Forge、MediaKit、Volcengine AK/SK、WebDAV、支付 sandbox 的无真实消费或受控小额验收。
4. 每个 `RUNTIME-PENDING` 必须附日期、环境、命令/步骤、脱敏结果与 artifact URL，之后方可改为 `PASS`。
