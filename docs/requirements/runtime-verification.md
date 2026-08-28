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
