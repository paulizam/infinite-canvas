# Admin Console Design

## 目标与非目标

目标是提供可操作、可审计的 Server mode 控制面，并复用 API 的 Model Gateway、Commerce、Payment 与 Admin domains。非目标是在浏览器保存 Maintenance Token、Provider credential、CDK hash 或业务权威状态。

## 数据流

```text
Admin React Route
  -> adminPlatform (credentials: include)
  -> /api/v1/admin (Session + active/admin check)
  -> existing domain Services/Repositories
  -> PostgreSQL + immutable audit event
```

页面加载失败时不展示缓存管理数据。mutation 成功后重新读取权威状态；revisioned 设置由服务端拒绝并发覆盖。

## 决策

| 决策                      | 理由                                               |
| ------------------------- | -------------------------------------------------- |
| 独立 `/admin` route       | 与创作工作台隔离，同时复用现有 Layout/Session      |
| 五步模型向导              | 降低协议、渠道、发现、上游模型和逻辑绑定的配置错位 |
| 商业数据由各领域 API 提供 | 避免前端拼接账务状态或建立影子数据库               |
| Secret 只提供写入控件     | catalog 仅显示 `credentialConfigured`，禁止回显    |

## 安全

- 权限以每次 API 请求的数据库角色校验为准，路由隐藏不视为授权。
- Cookie 由浏览器携带，前端不读取 Session token。
- Credential/CDK 明文只存在于对应提交或一次性创建结果中。
- 表单边界与 API Zod 双重校验；连接测试沿用 SSRF、redirect 和响应大小限制。
- Audit 导出由服务端执行 CSV formula 防护。

## 已知限制

- Admin route 已独立 lazy chunk；主应用仍有既有第三方依赖体积警告。
- 管理员 MFA 在 OPS-008 阶段补齐；角色与 Session 权限已先行落地。

## 变更历史

- 2026-08-28：建立 Admin 控制台、模型五步向导与商业运营工作台。
