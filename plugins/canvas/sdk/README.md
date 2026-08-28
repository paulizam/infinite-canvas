# @infinite-canvas/plugin-sdk

Infinite Canvas 画布节点插件的 **TypeScript SDK**。插件作者只写节点 UI 与逻辑,类型、JSX、运行时桥接、构建全部由 SDK 提供;产物仍是宿主加载器现有契约的 ESM(React external,宿主单例)。

## 提供什么

| 能力 | 说明 |
| --- | --- |
| **完整类型** | `CanvasPlugin` / `CanvasNodeDefinition` / `CanvasNodeContext` / `CanvasAgentOp` / `CanvasTheme` / `CanvasNodeData` … 全部有提示 |
| `definePlugin(...)` | 给插件对象(或工厂)补全类型;对象形式无需再 `const { React } = runtime` |
| automatic JSX | `jsxImportSource` 指向本包,TSX 自动转发到宿主 React,**不打包第二份 React** |
| 类型化 hooks | `import { useState, useEffect, useMemo, useRef, ... }`,运行时转发宿主 React |
| `buildPlugin(...)` | 统一 esbuild 构建,插件 `build.mjs` 只需一行 |
| 版本化节点状态 | `serialization` 提供 JSON serialize/deserialize/migrate；`Inspector` 提供属性检查器 |

## 最小插件

```tsx
// src/index.tsx
import { definePlugin, useState } from "@infinite-canvas/plugin-sdk";
import type { CanvasNodeContentProps } from "@infinite-canvas/plugin-sdk";

function Content({ ctx }: CanvasNodeContentProps) {
    const [n, setN] = useState(0);
    return (
        <button onMouseDown={(e) => e.stopPropagation()} onClick={() => setN((v) => v + 1)} style={{ color: ctx.theme.node.text }}>
            {ctx.node.title}: {n}
        </button>
    );
}

export default definePlugin({
    id: "my-plugin",
    name: "我的插件",
    version: "1.0.0",
    nodes: [
        {
            type: "my-plugin:node",
            title: "示例",
            icon: "✨",
            defaultSize: { width: 240, height: 160 },
            Content,
        },
    ],
});
```

```js
// build.mjs
import { buildPlugin } from "@infinite-canvas/plugin-sdk/build";
await buildPlugin(import.meta.url);
```

`npm run build` 产出 `dist/<目录名>.js` 并同步到 `web/public/plugins/`。

## Inspector 与版本化状态

节点可声明 `Inspector`（优先于兼容字段 `Panel`），并用 `serialization` 为导出数据建立稳定 schema：

```ts
{
    Inspector,
    serialization: {
        schemaVersion: 2,
        serialize: (node) => ({ text: node.metadata?.content }),
        deserialize: (data) => ({ content: (data as { text: string }).text }),
        migrate: (data, from, to) => from === 1 && to === 2 ? { text: (data as { value: string }).value } : data,
    },
}
```

宿主将状态写入项目内的 `__pluginState` JSON envelope，单节点限额 1MiB。未安装插件的 envelope 原样保留；插件重新安装后才执行 migration。高于当前 SDK 支持版本的数据不会降级覆盖，并在 `pluginCodecError` 中留下兼容诊断。

## 依赖接入

插件 `package.json`:

```json
{
    "type": "module",
    "scripts": { "build": "node build.mjs", "dev": "node build.mjs --watch", "typecheck": "tsc --noEmit" },
    "devDependencies": {
        "@infinite-canvas/plugin-sdk": "file:../sdk",
        "@types/react": "19.1.12",
        "typescript": "^5"
    }
}
```

插件 `tsconfig.json` 关键项:`"jsx": "react-jsx"`、`"jsxImportSource": "@infinite-canvas/plugin-sdk"`、`"moduleResolution": "bundler"`。

## 设计约束

- **React 单例**:JSX 与 hooks 惰性读取 `globalThis.InfiniteCanvasRuntime.React`(宿主在加载插件前注入),react 全程 external,绝不打包第二份。
- **重依赖**:three、marked 等在源码里 `await import("https://esm.sh/...")` 动态加载,esbuild 自动 external,不进 bundle。
- **类型真源**:`src/types.ts` 是宿主 `web/src/types/canvas-plugin.ts` 公开契约的镜像;宿主契约变更时同步此处。
