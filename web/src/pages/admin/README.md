# Admin Console

Server mode 的平台管理控制台，通过 HttpOnly Session 调用 `/api/v1/admin`，统一承载系统健康、用户、任务、模型渠道、商业运营、治理、配置与审计能力。

## 核心职责

- Dashboard、用户状态/角色、Session 撤销和生成任务恢复。
- 五步模型配置：协议、渠道 Secret、连接测试、模型同步、逻辑模型绑定。
- 套餐、促销、优惠券/CDK、订单、退款、对账与财务统计。
- 类型化站点设置、公告/运营提示词和 Audit CSV。

## 使用

登录具备 `platform_role=admin` 的账号后访问 `/admin`。普通用户即使直接访问该路径也会被 API 返回 403；浏览器不需要也不接触 `MAINTENANCE_TOKEN`。

## 文件

- `index.tsx`：控制台框架和通用管理页。
- `model-commerce.tsx`：模型向导与商业运营工作台。
- `DESIGN.md`：权限、数据流和安全决策。
