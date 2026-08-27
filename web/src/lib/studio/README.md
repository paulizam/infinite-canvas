# Creative Studio Projection

CAN-012 的只读成果投影层。它从 Canvas Project 节点输出生成统一的 `StudioMediaItem`，并把 Cloud Workspace Assets 与 Generation Job AssetRefs 以明确来源叠加，供 `/canvas/:id/studio` 浏览。

```ts
const items = projectCanvasMedia(project);
```

本模块依赖 Canvas 类型、Cloud DTO 与 platform contracts；不得在此修改 Project，也不得推断 Workspace Asset 属于当前 Project。
