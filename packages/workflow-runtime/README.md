# @infinite-canvas/workflow-runtime

Provider-neutral Workflow 图校验与执行规划内核，实现 WFL-001/002，并为持久化执行器提供确定性 DAG 语义。

## 能力

- typed input/output ports：union、array、`any` 和媒体 `asset` 协变。
- DAG 校验：重复标识、悬空 edge/port、类型、基数、必填输入、环与不可达节点。
- 执行约束：node catalog、capability 与 credential availability。
- 确定性拓扑分层：同层节点可并行，层内按 node ID 稳定排序。
- 部分执行：从选中节点开始执行全部下游，并记录跳过原因。

## 示例

```ts
import {
  planWorkflowExecution,
  validateWorkflow,
} from "@infinite-canvas/workflow-runtime";

const validation = validateWorkflow(definition, {
  availableCapabilities: new Set(["ai:text"]),
  availableCredentials: new Set(["provider:primary"]),
});
if (!validation.valid) console.error(validation.issues);
const plan = planWorkflowExecution(definition, ["rewrite"]);
```

## API

- `validateWorkflow(definition, options)`：返回结构化 issues 与可调度 layers。
- `topologicalLayers(...)`：无效图抛出 `WorkflowValidationError`。
- `isWorkflowValueTypeCompatible(source, target)`：port assignability。
- `planWorkflowExecution(definition, startNodeIds?)`：全量或下游部分执行计划。

详见 [DESIGN.md](DESIGN.md)。
