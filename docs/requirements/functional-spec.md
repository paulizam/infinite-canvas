# Infinite Canvas Fusion 详细功能清单设计

> 状态：Draft for Implementation  
> 配套架构：[`ARCHITECTURE.md`](ARCHITECTURE.md)  
> 来源标记：`I` = infinite-canvas，`Z` = z3cz，`V` = VOZEB-PRO，`N` = 融合新增  
> 优先级：`P0` 首个可用基线，`P1` 核心增强，`P2` 高级产品能力，`P3` 后续生态。

## 1. 产品形态与角色

### 1.1 运行模式

| 模式 | 能力 | 限制 |
|---|---|---|
| Local | 无账号、离线画布、localForage、WebDAV、用户自有 API、本地 Agent | 无服务端持久任务、团队协作、商业计费 |
| Server | 账号/团队、云项目、服务端模型、协作、任务恢复、对象存储、计费治理 | 需要 API/Worker/PostgreSQL |
| Hybrid | 本地草稿 + 显式上传云空间；本地 Agent 操作云项目缓存 | 同步冲突必须显式处理 |

### 1.2 用户角色

- Visitor：公开页面、作品浏览、注册登录。
- Creator：个人项目、生成、Agent、Workflow、素材和发布。
- Team Editor/Viewer：按 workspace 权限协作或只读。
- Workspace Admin/Owner：成员、凭据、额度和空间设置。
- Platform Operator/Admin：模型、财务、内容、任务、系统和审计治理。

## 2. 基础与账户

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| BAS-001 | P0 | I/N | 主题、响应式工作区、中文/英文；刷新后偏好保持，移动端关键操作可达。 |
| BAS-002 | P0 | I | Local mode 无需注册即可创建、保存、导入导出项目。 |
| BAS-003 | P0 | V | 邮箱/密码注册登录、退出、Session 续期；密码哈希且 Session 可撤销。 |
| BAS-004 | P0 | V | 安装向导创建首个管理员；安装 token 一次性使用。 |
| BAS-005 | P1 | V | 邮箱验证、忘记/重置密码、登录保护与频率限制。 |
| BAS-006 | P1 | V | 管理员 TOTP MFA 设置、挑战、恢复与强制撤销 Session。 |
| BAS-007 | P1 | Z | Workspace/Organization、邀请、成员、owner/admin/editor/viewer RBAC。 |
| BAS-008 | P1 | Z/N | 个人空间与团队空间切换；资源查询严格 tenant 隔离。 |
| BAS-009 | P2 | V | 账户资料、头像、绑定信息、账户注销申请与数据保留流程。 |
| BAS-010 | P1 | N | Local 项目显式上传云端；上传失败不破坏本地原件。 |

## 3. 项目与无限画布

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| CAN-001 | P0 | I | 创建、搜索、重命名、复制、删除、多选删除项目。 |
| CAN-002 | P0 | I | 平移、缩放、适配、重置、小地图、网格/点阵/空白背景。 |
| CAN-003 | P0 | I | 节点拖拽、缩放、多选、框选、层级、对齐、复制粘贴、删除。 |
| CAN-004 | P0 | I | 节点连线、断开、选中上下游、连接命中与关系高亮。 |
| CAN-005 | P0 | I | Undo/Redo 覆盖所有结构化 CanvasOperation；刷新不污染历史。 |
| CAN-006 | P0 | I | 文本、图片、视频、音频、生成配置等内置节点。 |
| CAN-007 | P0 | I | 文件拖入画布，按类型创建节点并保存媒体引用。 |
| CAN-008 | P0 | I | 导入/导出整项目或选中节点，资源随包；兼容 export v3。 |
| CAN-009 | P0 | I | 图片裁剪、遮罩、旋转/角度、拆分、放大、取视频帧。 |
| CAN-010 | P0 | I | Prompt/参考素材通过连接或 mention 绑定生成节点。 |
| CAN-011 | P0 | I/V | 生成节点记录 prompt、model、尺寸、画质、时长、参考和 attempt。 |
| CAN-012 | P1 | Z | Canvas 与 Creative Studio 双视图，切换不改变项目数据。 |
| CAN-013 | P1 | V/Z | 云端 snapshot + patch + revision 保存；冲突不静默覆盖。 |
| CAN-014 | P1 | N | 未安装插件节点显示 fallback，原始数据可导出/再导入不丢失。 |
| CAN-015 | P1 | N | 项目模板、封面、文件夹、最近访问与收藏。 |
| CAN-016 | P2 | V | Canvas Agent Run 分析节点关系、执行任务并把结果写回目标节点。 |

## 4. AI 生成与模型网关

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| GEN-001 | P0 | I/V | 文本问答/改写，支持 streaming、system prompt 和 reasoning 参数。 |
| GEN-002 | P0 | I/V | 文生图、图生图、多参考图编辑、透明背景、多结果。 |
| GEN-003 | P0 | I/V/Z | 文生视频、首帧/首尾帧、参考素材、比例、画质、时长。 |
| GEN-004 | P0 | I/V/Z | 文本转音频/语音，保存 mime、duration 和原件。 |
| GEN-005 | P0 | I | 多渠道 OpenAI-compatible Base URL、模型列表和自定义调用脚本。 |
| GEN-006 | P0 | V | Protocol/Channel/Upstream Model/Logical Model/Capability 分层配置。 |
| GEN-007 | P0 | V | 逻辑模型候选优先级、默认模型和兼容能力校验。 |
| GEN-008 | P1 | V | OpenAI、Gemini、Seedance、Stable Diffusion、A1111/Forge adapter。 |
| GEN-009 | P1 | V | 声明式自定义协议；测试连接、获取模型、映射字段、预览请求。 |
| GEN-010 | P0 | V/Z | `clientRequestId` 幂等；同一 attempt 只创建一次上游任务。 |
| GEN-011 | P0 | V/Z | 持久 Job 支持 lease、heartbeat、poll/webhook、页面关闭后恢复。 |
| GEN-012 | P0 | V/Z | cancel、明确失败、主动 retry；retry 创建新 attempt，不隐式重复消费。 |
| GEN-013 | P0 | V | 失败/取消幂等退款；成功记录实际用量和媒体结果。 |
| GEN-014 | P1 | V/Z | 生成运维：卡死、失联 Worker、异常持久化、needs_review 人工处理。 |
| GEN-015 | P1 | I/V | 历史恢复、批次结果、失败原因、原件下载、WebP 预览。 |
| GEN-016 | P1 | V | 参数倍率与预估积分；提交前显示预计消耗。 |
| GEN-017 | P2 | Z | 火山引擎 AK/SK 接入、模型/资源包导入与消耗查询。 |
| GEN-018 | P2 | Z | AI MediaKit/画质增强等 provider-specific capability 插件化。 |

## 5. 统一创作 Agent 与本地 Agent

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| AGT-001 | P0 | I | 本地 Canvas Agent 连接 Codex，MCP 读取 snapshot/selection 并应用 operations。 |
| AGT-002 | P0 | I | 多 tab session 隔离、streaming、历史、诊断、approval 与权限展示。 |
| AGT-003 | P1 | I | Claude Code adapter 升级为可维护 Agent SDK adapter。 |
| AGT-004 | P1 | V | 统一创作 Agent 会话同时支持文本、图片、视频、音频和参考素材。 |
| AGT-005 | P1 | V | 智能 planning、手动逻辑模型、参数约束和 Skill policy。 |
| AGT-006 | P1 | V | Agent Run 任务认领、事件流、子任务、结果项、失败恢复和审计。 |
| AGT-007 | P1 | V | Agent 生成结果发送至 Canvas、素材库、短剧项目。 |
| AGT-008 | P1 | I/V | Skills 分类、启停、导入、资源文件、触发规则与能力约束。 |
| AGT-009 | P2 | I | 从检索结果安装 Skill；安装前展示来源、文件与权限。 |
| AGT-010 | P1 | N | 删除、批量付费生成、外部访问必须 approval；操作留审计记录。 |
| AGT-011 | P2 | N | 远端团队 Agent adapter，与本地 Agent 共用 tool contract。 |

## 6. Workflow 执行

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| WFL-001 | P1 | Z | typed input/output ports、节点 schema、edge type compatibility。 |
| WFL-002 | P1 | Z | DAG 校验：缺参、非法环、不可达节点、credential 和 capability。 |
| WFL-003 | P1 | N | Canvas 显式发布为 Workflow，返回 error/warning 与 source node mapping。 |
| WFL-004 | P1 | Z | 全量执行、从选中节点执行、单节点重试、取消。 |
| WFL-005 | P1 | Z | 拓扑分层并行、条件分支、skip reason、sub-step。 |
| WFL-006 | P1 | Z | execution/node execution 状态、输入输出快照、timeline 和错误定位。 |
| WFL-007 | P1 | Z | 持久 step retry、sleep、waitForEvent、Worker 重启恢复。 |
| WFL-008 | P2 | Z | Webhook、表单、邮件、计划任务等 trigger nodes。 |
| WFL-009 | P2 | Z | Workflow 模板、文件夹、封面、导入导出和版本。 |
| WFL-010 | P2 | Z | API snippet/公开调用 endpoint，具备 token scope 与限流。 |

## 7. 素材、媒体与提示词

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| AST-001 | P0 | I/V | 图片、视频、音频、文件、Prompt 素材入库、搜索、筛选、删除。 |
| AST-002 | P0 | V | local/S3 provider；历史资产按自身 provider 读取。 |
| AST-003 | P0 | V/N | stable storageKey/AssetRef，原件与 preview variant 分离。 |
| AST-004 | P0 | V | 上传格式、大小、归属校验；服务端 UUID 重命名。 |
| AST-005 | P0 | V | 鉴权媒体读取和短期 signed URL，不暴露 bucket secret。 |
| AST-006 | P1 | V | 引用保护、对象迁移、孤儿扫描、retention GC。 |
| AST-007 | P1 | I | WebDAV 分域同步 Canvas/Assets/生成记录与媒体。 |
| AST-008 | P1 | I | 七个内置 Prompt sources，自定义 JSON source、刷新、缓存、标签检索。 |
| AST-009 | P1 | V | 运营提示词库、分类、上下架；一键送入 Agent/Canvas/短剧。 |
| AST-010 | P2 | N | content hash 去重、媒体版本与来源血缘。 |

## 8. 插件生态

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| PLG-001 | P0 | I | Plugin SDK 支持节点 render、inspector、serialization、migration、toolbar。 |
| PLG-002 | P0 | I | 内置 HTML、Markdown、SVG、Panorama、Sticky Note 节点。 |
| PLG-003 | P0 | N | manifest 声明 app version、permissions、network allowlist、integrity/signature。 |
| PLG-004 | P0 | N | 远程插件 sandboxed iframe/Worker；不能直接读取主应用 storage/secrets。 |
| PLG-005 | P1 | I/N | Registry 安装、启停、更新、卸载、版本固定与撤销。 |
| PLG-006 | P1 | N | 安装/升级前权限 diff；用户明确确认新增权限。 |
| PLG-007 | P2 | N | 插件运行错误隔离、资源限额、诊断与兼容报告。 |

## 9. 云同步与多人协作

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| COL-001 | P1 | Z | WebSocket 多端实时同步 node/edge/viewport patches。 |
| COL-002 | P1 | Z/N | revision + mutationId；重复 patch 幂等，过期 baseRevision 返回 conflict。 |
| COL-003 | P1 | Z | 500ms debounce persistence，最后客户端离开前 flush。 |
| COL-004 | P1 | N | presence、光标、选区、在线成员，不写入永久文档。 |
| COL-005 | P1 | N | viewer 只读、editor 可写；服务端逐 patch 鉴权。 |
| COL-006 | P2 | N | 离线 operation queue、重连 rebase 与人工冲突解决。 |
| COL-007 | P2 | N | 项目版本快照、命名 checkpoint、恢复为新 revision。 |

## 10. 短剧生产线

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| DRM-001 | P2 | V | 新建短剧项目、来源文本/文件导入、剧本富文本与版本。 |
| DRM-002 | P2 | V | 剧本拆分、内容审核、分析任务、分段合并和人工修订。 |
| DRM-003 | P2 | V | 角色、场景、道具档案与参考图，跨分镜复用。 |
| DRM-004 | P2 | V | 分镜/镜头列表、Prompt、景别、运镜、时长和顺序。 |
| DRM-005 | P2 | V | 镜头图片/视频生成、版本选择、失败重试与成本汇总。 |
| DRM-006 | P2 | V | 配音、音色、对白、背景音、字幕与时间轴。 |
| DRM-007 | P2 | V | FFmpeg 合成、进度、失败恢复、成片版本和原件下载。 |
| DRM-008 | P2 | V | 剪映草稿导出；输出可被目标版本正常导入。 |
| DRM-009 | P2 | V | 短剧资产与通用素材库/Canvas 双向发送。 |
| DRM-010 | P3 | N | 团队批注、镜头审批和生产状态看板。 |

Web 验收入口为 `/drama` 项目库与 `/drama/:id` 生产工作台；任何仅存在 API、但在这两个入口不可达的操作，不计为完整产品验收。媒体生成、渲染和剪映导出只提交 durable job，页面展示状态、成本、失败重试与不可变产物版本，不得在浏览器伪造完成态。

DRM-002 的“分析任务”必须是可查询、可失败、可重试、可计费的服务端 Generation Job；模型输出经结构校验后由用户显式应用为新版本。客户端直接提交 `analysis` JSON 只属于人工修订元数据，不得替代分析任务验收。

## 11. 作品社区与内容治理

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| COM-001 | P2 | V | 作品草稿、封面、描述、标签、可见性和发布版本快照。 |
| COM-002 | P2 | V | 提交审核、通过/驳回、下架、修改后重发。 |
| COM-003 | P2 | V | 广场搜索、筛选、推荐分页、作品详情与分享。 |
| COM-004 | P2 | V | 作者主页、点赞、关注及计数一致性。 |
| COM-005 | P2 | V | 举报、治理原因、操作人、时间与 audit trail。 |
| COM-006 | P3 | N | 评论、收藏、合集；均具备反滥用与可治理能力。 |

## 12. 积分、订单与商业运营

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| BIL-001 | P1 | V | 积分钱包、不可变流水、余额查询与后台调整审计。 |
| BIL-002 | P1 | V | 模型基础价、参数倍率、预估价、原子扣费与幂等退款。 |
| BIL-003 | P2 | V | 商品/套餐、免费额度、促销、优惠券、CDK。 |
| BIL-004 | P2 | V | 邀请码、邀请关系、奖励规则和防重复领取。 |
| BIL-005 | P2 | V | 订单创建、支付跳转/二维码、状态查询与过期关闭。 |
| BIL-006 | P2 | V | 支付 webhook 签名、重放防护、event id 去重。 |
| BIL-007 | P2 | V | 退款申请、渠道退款、积分回滚、失败补偿。 |
| BIL-008 | P2 | V | 对账、财务流水、收入/退款/模型成本统计。 |

## 13. 管理后台

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| ADM-001 | P1 | V | Dashboard：用户、任务、调用、媒体、积分与系统健康。 |
| ADM-002 | P1 | V | 用户检索、状态、角色、积分、Session 撤销和操作审计。 |
| ADM-003 | P1 | V | 五步模型渠道向导、协议、连接测试、模型同步、逻辑模型启用。 |
| ADM-004 | P1 | V | 生成任务检索、phase/attempt/provider/error、恢复/取消/review。 |
| ADM-005 | P1 | V | 对象存储配置、连通测试、迁移、占用和孤儿检查。 |
| ADM-006 | P2 | V | 套餐、促销、优惠券、CDK、订单、支付、退款、对账。 |
| ADM-007 | P2 | V | 作品审核、举报、下架、公告与提示词运营。 |
| ADM-008 | P1 | V/N | 审计日志按 actor/action/resource/requestId 查询和导出。 |
| ADM-009 | P1 | V | 站点品牌、注册策略、邮件、代理、生成并发和功能开关。 |
| ADM-010 | P1 | N | 配置保存前校验，secret 字段只显示配置状态，不回显明文。 |

## 14. 运维、安全与合规功能

| ID | P | 来源 | 功能与验收结果 |
|---|---:|---|---|
| OPS-001 | P0 | I/V/Z | Docker Compose 一键启动 web/api/worker/Postgres，healthcheck 可判活。 |
| OPS-002 | P0 | V | `.env.example` 覆盖必需配置，安装前强度校验，不含真实密钥。 |
| OPS-003 | P1 | V | 定时备份、恢复演练、脱敏业务导出导入。 |
| OPS-004 | P1 | V | Worker heartbeat、queue age、卡死任务告警。 |
| OPS-005 | P1 | N | requestId/jobId 全链路日志、metrics 和 traces，secret 自动脱敏。 |
| OPS-006 | P0 | N | CSP、CSRF/Origin、防 IDOR、参数化 SQL、上传校验、SSRF 防护。 |
| OPS-007 | P0 | N | secret scan、依赖/license inventory、SBOM、镜像漏洞扫描。 |
| OPS-008 | P1 | V | 管理员 MFA、维护/Worker token 分权与轮换。 |
| OPS-009 | P1 | N | 数据 retention、账户注销、媒体 GC 和审计保留策略。 |
| OPS-010 | P1 | V | release check：版本、品牌、文档、敏感文件、migration 与 notices。 |

## 15. 分期交付范围

| Release | 目标 | 必含功能域 |
|---|---|---|
| R0 Foundation | 地基可安全演进 | BAS-001/002、CAN P0、PLG P0、安全/contract tests |
| R1 Cloud Creation | 云工作区与可靠生成 | Auth/Workspace、云 Canvas、Asset、GEN P0、Worker、Admin 模型/任务 |
| R2 Workflow Agent | 可执行编排与统一 Agent | WFL P1、Studio、AGT P1、协作 P1 |
| R3 Production Suite | 内容生产闭环 | Drama、Community、Billing/Commerce、治理 |
| R4 Ecosystem | 扩展生态 | 高级插件、公开 Workflow API、更多 Trigger/Provider |

Release 只能在前序 migration、权限、任务幂等和回归测试通过后推进。

## 16. 全局验收规则

1. 每项功能必须绑定上述 ID；PR、测试、CHANGELOG 使用同一 ID。
2. 所有写操作明确 ownership、idempotency 与 concurrency 行为。
3. 所有付费生成可追溯：请求、模型、attempt、扣费、上游状态、媒体、退款。
4. 所有媒体可追溯来源与引用；删除不能制造静默坏链。
5. Local mode 断网可编辑；Server mode 刷新/换实例不丢已受理任务。
6. 新 schema 必须有旧版本 migration 和 round-trip tests。
7. 新 provider/plugin/payment channel 必须通过 adapter contract tests。
8. 安全相关失败默认 fail closed；不得以 UI 隐藏代替服务端权限。

## 17. 暂不纳入首期

- 微服务拆分、Kafka、复杂 event sourcing；
- 原生移动端；
- 自建 GPU 推理集群；
- 评论/合集等社区扩展；
- 复杂企业 SSO/SCIM；
- 无明确业务收益的 Cloudflare-only 特性。

这些能力不得阻塞 R0/R1，但 contracts 应避免永久封死未来扩展。
