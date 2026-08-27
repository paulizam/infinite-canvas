# Generation Worker 设计

## 设计目标

- 在浏览器关闭或进程重启后继续 PostgreSQL 中已受理的 Generation Job。
- 通过 lease、heartbeat 和 `FOR UPDATE SKIP LOCKED` 实现多实例安全认领与故障回收。
- 将 provider 执行与 API/Canvas 隔离，支持独立扩缩容和优雅停止。

非目标：Worker 不认证终端用户、不直接修改 Canvas、不决定计费价格；这些由 API、Model Gateway 与 Billing domain 负责。

## 架构

```text
poll policy -> Worker runtime -> authenticated WorkerApiClient -> API -> PostgreSQL
                     |                       |
                JobHandler              lease/state guard
                     |
               Model Gateway（下一切片）
```

- `WorkerApiClient`：只连接配置的 HTTP(S) origin，携带独立 Worker Token。
- `runWorkerCycle`：先报告全局 heartbeat，再认领批次，并在 handler 运行期间周期续租。
- `runWorker`：有任务时快速继续，无任务或 API 故障时有界指数退避，响应 SIGINT/SIGTERM。
- `JobHandler`：稳定扩展点；后续注入 Model Gateway submit/poll/persist handler。

## 关键决策

| 决策                                       | 理由                                 | 影响                                                         |
| ------------------------------------------ | ------------------------------------ | ------------------------------------------------------------ |
| Worker 通过内部 API 操作租约               | 复用 API 的状态机、审计和 Token 边界 | API 暂时是 Worker control-plane，后续可下沉 database package |
| lease 周期为配置值，续租间隔为其三分之一   | 容忍瞬时网络抖动，同时及时发现失联   | handler 必须支持 AbortSignal 与幂等恢复                      |
| 未配置 Model Gateway 时转 `needs_review`   | 禁止猜测 provider 或产生隐式消费     | 接入 Gateway 后替换默认 handler                              |
| HTTP origin 丢弃路径并拒绝 URL credentials | 缩小 SSRF 与凭据泄露面               | 反向代理必须把 internal routes 暴露给受控 Worker 网络        |

## 已知限制

- PostgreSQL 多实例并发认领尚需真实数据库集成验收。
- 当前默认 handler 只收敛取消请求；生成任务在 Gateway 落地前进入 `needs_review`。
- API 短暂不可用依靠进程内退避，尚无独立 circuit-breaker metrics exporter。

## 安全考量

- `WORKER_TOKEN` 至少 32 字符，仅从环境读取，日志不输出 Token 或 Authorization header。
- API 使用 constant-time token 比较；状态变更同时校验 `workerId`、lease owner 与 expiry。
- 请求 URL 由部署配置与固定 internal path 组成，不接受 Job payload 提供的任意 URL。
- Job input 在进入 provider adapter 前仍必须经过 capability-specific schema 与 SSRF 规则验证。

## 变更历史

- 2026-08-27：建立独立 Worker、heartbeat、lease renewal、退避、恢复与容器入口。
