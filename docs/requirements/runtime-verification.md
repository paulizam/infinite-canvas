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

## AST-005 S3-compatible asset round-trip

- 验证日期：2026-08-28
- 本机服务：MinIO `RELEASE.2025-09-07T16-13-09Z`，Windows amd64
- 二进制 SHA-256：`AF709E6BA68488404E85ACDD22A3030D0F5E56A108D4B27D744F18CEB50861B4`
- 隔离 endpoint：`http://127.0.0.1:19000`（验收后已停止进程并确认端口释放）
- Test：`apps/api/src/blob-store-runtime.integration.test.ts`
- 链路：CreateBucket → PutObject → GetObject → presigned HTTP GET → DeleteObject → missing-object assertion → DeleteBucket
- 断言：二进制字节完全一致、signed URL 返回 HTTP 200、删除后读取失败

本地复验：

```powershell
$env:S3_TEST_ENDPOINT = "http://127.0.0.1:19000"
$env:S3_TEST_ACCESS_KEY = "<sandbox-access-key>"
$env:S3_TEST_SECRET_KEY = "<sandbox-secret-key>"
pnpm --filter @infinite-canvas/api test -- src/blob-store-runtime.integration.test.ts
```

未设置 `S3_TEST_ENDPOINT` 时该 integration test 显式 skip，不能作为 Runtime PASS。

## AST-007 WebDAV browser protocol

- 验证日期：2026-08-28
- 本机服务：WsgiDAV `4.3.3`、Cheroot `11.0.0`、Python `3.11.9`
- 隔离 endpoint：`http://127.0.0.1:19080`（验收后已停止并确认端口释放）
- Test：`web/src/services/webdav-runtime.integration.test.ts`
- 认证：隔离 Basic Auth 测试账户，凭据仅写入本机临时目录
- 数据链路：MKCOL → PROPFIND → PUT binary → GET binary → byte equality
- CORS：来自 `http://127.0.0.1:3000` 的 OPTIONS preflight 返回 204，并允许 PROPFIND、Authorization 与 Depth
- 结果：2 tests PASS；Unicode 路径与 `application/octet-stream` 内容保持一致

复验时设置：

```powershell
$env:WEBDAV_TEST_ENDPOINT = "http://127.0.0.1:19080"
$env:WEBDAV_TEST_USERNAME = "<sandbox-user>"
$env:WEBDAV_TEST_PASSWORD = "<sandbox-password>"
pnpm --dir web test -- src/services/webdav-runtime.integration.test.ts
```

未设置 `WEBDAV_TEST_ENDPOINT` 时该 integration test 显式 skip，不能作为 Runtime PASS。

## PLG-005 registry and browser sandbox lifecycle

- 验证日期：2026-08-28
- 浏览器：本机 Microsoft Edge（Chromium，headless）
- Test：`web/src/lib/canvas/plugin-browser-runtime.integration.test.ts`
- 隔离拓扑：Vite 应用 origin 与动态端口 Registry/plugin origin 分离；Registry 返回 manifest v2 与 CORS headers
- 安全链：远程源码 SHA-256 integrity 校验 → module Worker sandbox → 未声明 network origin 的 `fetch` 被拒绝 → 仅返回可序列化节点描述
- 生命周期：Registry 安装 v1 → 禁用/启用 → 发现并升级 v2 → Registry 发布 v3 时保持 v2 固定 → 撤销后自动停用并记录原因 → 卸载清理
- 断言：sandbox 标记、权限拒绝、节点 owner/注册状态、缓存源码与 integrity、版本、诊断和 Store 记录全部符合预期
- 结果：1 test PASS；临时 Vite、Registry 与浏览器进程全部结束，监听端口释放

本机复验：

```powershell
$env:PLUGIN_BROWSER_TEST = "1"
$env:PLUGIN_BROWSER_EXECUTABLE = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
pnpm --dir web test -- src/lib/canvas/plugin-browser-runtime.integration.test.ts
```

未设置 `PLUGIN_BROWSER_TEST=1` 时该 integration test 显式 skip，不能作为 Runtime PASS。`PLUGIN_BROWSER_EXECUTABLE` 可指向任意 Playwright 支持的本机 Chromium executable；测试不下载浏览器。
