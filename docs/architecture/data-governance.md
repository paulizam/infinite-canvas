# Data Governance

## 目标

账户注销、数据导出、Retention 与 Media GC 必须在不破坏账务、作品版本及不可变审计证据的前提下执行。实现位于 `apps/api/src/data-governance-*`，数据库结构由 `026_data_governance.sql` 管理。

## 信任边界

- 用户导出与注销使用 HttpOnly Session；注销还必须复核当前密码。
- GC 与 Retention 仅接受 Maintenance Token，不与 Worker Token 共用。
- 导出不包含密码 Hash、Session、MFA、Provider Secret、支付渠道标识或 Blob object key；任意嵌套的 password/secret/token/authorization/apiKey 字段再次递归脱敏。
- 操作结果写入不可变 `admin_audit_events`；Retention 永不更新或删除该表。

## 关键决策

| 决策                                                          | 理由                                                                                                             |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| 注销采用身份匿名化而非物理删除 `users`                        | 财务流水、订单、作品、工作流与审核证据持有历史用户外键；物理删除会破坏法定记录和引用完整性。                     |
| 注销撤销全部 Session 和 Workspace membership                  | 立即终止访问权；共享 Workspace 在缺少其他 owner 时按 admin/editor/viewer 顺序转交。                              |
| GC 先删数据库 Asset，再删 Blob                                | Blob 失败最多形成不可访问 orphan，不会形成数据库指向缺失对象。                                                   |
| Blob 删除使用持久 outbox                                      | `failed` 项可在下一批重试，错误只保存脱敏后的 500 字符摘要。                                                     |
| 单批沿用 Admin control-plane 的 100 项上限                    | 限制锁持有时间与对象存储突发请求，同时不引入第二套管理面边界。                                                   |
| Retention 仅清理过期 Session 与终态 Generation progress event | 用户可见的 Agent/Workflow timeline、账务流水及 Admin Audit 保持不可变；更长期归档应交给分区/冷存储而非行级篡改。 |

## 流程

1. `POST /internal/v1/maintenance/media-gc` 默认 `dryRun=true`，列出超过 `olderThan` 且 Canvas 无引用的候选。
2. 执行模式逐项尝试删除数据库记录；其他领域 FK 仍引用的 Asset 由 PostgreSQL 拒绝并跳过。
3. 成功删除的记录进入 `media_blob_gc`，事务提交后才调用 BlobStore。
4. Blob 成功标记 `deleted`；失败标记 `failed`，后续执行自动重试。

## 已知限制

- 当前宿主机没有 PostgreSQL/Docker，`026` 的真实迁移、并发 FK race 与对象存储失败恢复仍为 `[unverified]`。
- 账户导出是可读、脱敏的业务清单，不包含 Blob 二进制；完整可恢复业务导入包仍属于 OPS-003 后续工作。
- 孤立且无其他成员的 Workspace 在注销后保留至明确的 Workspace retention policy，避免静默销毁内容。
