# Runtime Verification

本文件记录不能由纯 mock/contract test 代替的运行验收。持续集成中的对应命令是权威可重复证据。

## DRM-007 FFmpeg render

- 验证日期：2026-08-28
- 本地二进制：FFmpeg `9.0.1-essentials_build`
- CI：`.github/workflows/quality-security.yml` 的 `Exercise real FFmpeg drama rendering`
- Test：`apps/worker/src/drama-render-runtime.integration.test.ts`
- 输入：由 FFmpeg lavfi 生成的 320×180、24fps、1 秒 H.264 MP4
- 链路：claim → progress → materialize → concat/libx264 → persist → succeeded
- 断言：进程 exit code 0、输出大于 1 KiB、MP4 `ftyp`、输出版本名与最终 Asset ID 正确

本地复验：

```bash
FFMPEG_PATH=/path/to/ffmpeg pnpm --filter @infinite-canvas/worker test -- src/drama-render-runtime.integration.test.ts
```

未设置 `FFMPEG_PATH` 时该 integration test 显式 skip；CI 会安装 FFmpeg 并强制设置该变量，因此 release 分支不会只靠 skip 获得通过。

## OPS-001 / OPS-003 / OPS-007 deployment and supply chain

- 验证日期：2026-08-28
- GitHub Actions Run：[`33149259159`](https://github.com/paulizam/infinite-canvas/actions/runs/33149259159)
- Runtime commit：`b1e3bacc7c371886245ce6b2a8d25208790f36e8`
- 结果：`quality`、`migration`、`supply-chain`、`containers` 四个 jobs 全部 `success`
- OPS-001：Web/API/Worker 三镜像完成 multi-stage build；Compose 启动后 Web/API healthcheck 通过
- OPS-003：PostgreSQL migrations 连续执行两次；脱敏业务包 export/verify/import；数据库与 Asset 在破坏性修改后通过 checksum backup/restore 恢复
- OPS-007：secret scan、license inventory、`pnpm audit`、Gitleaks、SPDX SBOM、filesystem Trivy 与 API image Trivy 全部通过
- SBOM artifact：`infinite-canvas-supply-chain.spdx.json`（artifact `9677034009`）
- Gitleaks artifact：`gitleaks-results.sarif`（artifact `9677031066`）

该 Run 使用隔离分支 `ci/runtime-validation` 注册 workflow，产品实现同步于 `feat/fusion-platform`；隔离分支不替代产品分支源码和 release gate。
