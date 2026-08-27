# Creative Studio Projection Design

## 目标

- Canvas 与 Studio 使用同一 Project 数据，不复制可写状态。
- 文本、图片、视频、音频及其 alternatives 投影为统一视图模型。
- 云端素材保留 `canvas`、`workspace_asset`、`generation_job` provenance。

## 决策

Projection 保持纯函数并独立测试。Canvas 内容按 `kind + nodeId + payload` 去重；Generation Job result 只递归提取结构化 `AssetRef`，最多遍历八层，既不执行结果内容也不把文本任务误作媒体。Workspace Assets 不设置 `nodeId`，避免虚构 Project ownership。

## 限制与演进

当前版本浏览显示 Project 当前 revision 与节点 alternatives；不可变历史 revision 待 Checkpoint API 落地后追加。跨域媒体预览受部署端 CORS/Cookie 策略约束，下载统一走已鉴权 Cloud client。

## 变更历史

- 2026-08-28：建立 CAN-012 projection contract 与三类来源投影。
