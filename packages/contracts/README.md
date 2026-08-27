# Fusion Contracts

`@infinite-canvas/contracts` 是 Browser、API 与 Worker 共享的纯 TypeScript 协议包，包含 Canvas、Platform、Model Gateway 与 Agent JSON contracts；不得依赖运行时基础设施或携带凭据。

Agent 核心契约由 `src/agent.ts` 导出。`AGENT_TOOL_CONTRACT_VERSION` 发生不兼容变化时必须递增；Local Canvas Agent 与 Remote Team Agent 的 `canvas_get_state`、`canvas_apply_ops` 保持同名及相同 `{ ops }` 输入语义。远端写操作仍须由 API 在有效 Worker lease 内执行，不能把此类型契约视为授权。
