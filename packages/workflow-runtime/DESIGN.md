# Workflow Runtime 设计

## 目标与边界

本模块解决业务发布图能否安全执行、节点以何顺序执行以及持久状态如何合法跃迁的问题。它不访问数据库、Provider、凭据明文或网络；API/Worker adapter 负责 transaction、lease 和实际 I/O，并持久化本模块输出。

## 架构

```text
WorkflowDefinition
  ├─ value type assignability
  ├─ structural / policy validator ──> structured issues
  └─ Kahn topological scheduler ─────> deterministic parallel layers
                                         └─ selection planner / skip reasons
CanvasDocument ── declarative CompileRule ──> WorkflowDefinition + source mapping + diagnostics
Execution state ── pure transitions ──> NodeExecution snapshots + monotonic Events + durable Steps
```

跨端 contract 位于 `@infinite-canvas/contracts`：`WorkflowNodeSchema` 描述注册节点，`WorkflowNodeDefinition` 是发布版本中的可执行快照。定义携带 ports，避免节点插件升级后静默改变既有 Workflow 语义。

## 核心不变量

1. node、edge 以及同方向 port ID 唯一。
2. edge 必须连接存在的 output 与 input，source type 可赋值给 target type。
3. 非 `multiple` input 最多一条 edge；required input 必须由 edge 或 config 同名字段提供。
4. 有向图无环；显式 entry 存在时，每个节点必须可达。
5. 可用集合由调用方从已鉴权 Workspace 上下文提供；Runtime 只比较 capability/credential opaque ID。
6. 拓扑层与部分执行计划确定性排序，可被持久执行器幂等重建。
7. Canvas generic handle 只有在 rule 指定默认 port 或 schema 恰有一个 port 时才可映射；多 port 禁止猜测。
8. Execution transition 是纯函数；state 可 JSON round-trip，event sequence 单调，terminal state 不被普通 refresh 复活。
9. 成功的 durable step 按 key 回放已存结果而不重复执行；sleep/event wait 不消耗 attempt，failure retry 才递增。

## 类型规则

- `T` 可赋值给相同 `T`；任意 source 可赋值给 target `any`。
- `any` 不能收窄到具体类型。
- union source 的每个成员都必须被 target union 接受。
- array 维度一致且元素递归兼容。
- `image | video | audio` 是 `asset` 子类型。

类型字符串后续会演进为带 version 的 registry；未知字符串当前只能精确匹配，避免猜测转换。

## 决策与权衡

| 决策                               | 理由                                                           | 代价                                               |
| ---------------------------------- | -------------------------------------------------------------- | -------------------------------------------------- |
| 纯 TypeScript、零运行时依赖        | Web publish、API 和 Worker 复用一致语义                        | JSON Schema 深度 config 校验由后续 compiler 层接入 |
| Kahn 分层而非 DFS 排序             | 直接表达同层并行并自然检测 cycle                               | 动态 condition 在执行时产生 skip，不改变静态 DAG   |
| Durable step 作为 adapter          | 吸收 z3cz 的 `step/sleep/waitForEvent` 优势且不绑定 Cloudflare | PostgreSQL step store 尚需下一阶段实现             |
| 部分执行选择节点及全部 descendants | 与“从选中节点执行”交互一致                                     | 上游输入必须由已保存 snapshot 或显式参数提供       |
| 声明式 config/credential binding   | 服务端可复验，且不会执行插件脚本                               | 复杂转换须由受信任、版本化 adapter 实现            |

## 安全

- 不读取 credential value，仅校验 opaque reference 是否在授权集合。
- graph 大小上限必须由 API schema 在进入本模块前施加，防止 CPU/内存 DoS。
- 不执行 config 中的脚本、表达式或 URL。
- validator issues 不包含凭据内容或 Provider payload。
- 发布与执行 API 仍必须进行 tenant ownership/RBAC；本模块不是授权边界。

## 后续

- PostgreSQL Execution/NodeExecution/Event、lease 与 durable step（WFL-004~007）。
- condition/trigger adapter 以及 config JSON Schema registry。
