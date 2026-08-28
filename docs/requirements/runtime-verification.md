# Runtime Verification

本文件记录不能由纯 mock/contract test 代替的运行验收。持续集成中的对应命令是权威可重复证据。

统一准备检查：

```powershell
# 查看 Pending，不输出任何 secret
pnpm runtime:preflight -- --allow-pending
# 所有外部条件未就绪时返回 exit code 2
pnpm runtime:preflight
```

`ops/runtime-preflight.mjs` 校验 Provider case schema/HTTPS/动态密钥变量、Volcengine 三项配置以及 Windows 剪映 executable、draft root、FFmpeg；它只证明环境已准备，不能替代下述真实 harness。

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

## AST-002 PostgreSQL + S3 provider switch

- 验证日期：2026-08-28
- PostgreSQL：原生 PostgreSQL `17.2`，隔离端口 `127.0.0.1:19432`，完整执行 32 个 migrations
- S3：MinIO `RELEASE.2025-09-07T16-13-09Z`，隔离 endpoint `http://127.0.0.1:19000`
- Test：`apps/api/src/asset-provider-switch-runtime.integration.test.ts`
- 链路：以 `local` 上传历史图片及 preview → 将当前 provider 切到 `s3` → 上传新图片及 preview → 由同一 PostgreSQL repository 按每条 Asset 的 immutable `storageProvider` 分流读取 → 删除元数据与两端对象
- 断言：PostgreSQL 同时持久化 `local`/`s3` provider；历史 local 原始字节在切换后不变；S3 新对象字节不变；两次连续运行均 PASS
- 清理：测试 bucket、临时 local root、PostgreSQL/MinIO 进程均已清理，`19432/19000/19001` 端口已释放

本机复验需先准备已执行 migrations 的隔离 PostgreSQL 数据库和 MinIO bucket endpoint：

```powershell
$env:ASSET_PROVIDER_TEST_DATABASE_URL = "postgresql://<user>:<password>@127.0.0.1:19432/<database>"
$env:S3_TEST_ENDPOINT = "http://127.0.0.1:19000"
$env:S3_TEST_ACCESS_KEY = "<sandbox-access-key>"
$env:S3_TEST_SECRET_KEY = "<sandbox-secret-key>"
pnpm --filter @infinite-canvas/api test -- src/asset-provider-switch-runtime.integration.test.ts
```

未同时设置 `ASSET_PROVIDER_TEST_DATABASE_URL` 与 `S3_TEST_ENDPOINT` 时该 integration test 显式 skip，不能作为 Runtime PASS。

## BIL-005 / BIL-006 / BIL-007 payment sandbox lifecycle

- 验证日期：2026-08-28
- Provider：独立本机 HTTP payment sandbox，严格经过生产 `HttpPaymentAdapter`；Bearer token、JSON wire contract、`Idempotency-Key` 和响应限制均生效
- Persistence：原生 PostgreSQL `17.2` 隔离数据库，完整执行 32 个 migrations
- Test：`apps/api/src/payment-sandbox-runtime.integration.test.ts`
- BIL-005：创建订单 → provider checkout URL/二维码 → 同幂等键不重复请求渠道 → 查询状态 → 到期批量关闭
- BIL-006：sandbox payment event 使用 HMAC-SHA256 原始 body 签名 → fulfillment/积分入账 → 同 event id + payload 重放幂等 → 错误签名拒绝
- BIL-007：持久化 refund 后调用 provider → 积分回滚；另一路由先返回 HTTP 503 → 标记 `refund_failed` → 使用同一 durable refund id 重试成功
- 数据断言：两笔 payment events、两笔 refund ledger、最终 wallet balance 为 0；测试连续运行两次均 PASS
- 清理：HTTP sandbox 与 PostgreSQL 进程均停止，监听端口释放

本机复验需准备已执行 migrations 的隔离 PostgreSQL database：

```powershell
$env:PAYMENT_SANDBOX_TEST_DATABASE_URL = "postgresql://<user>:<password>@127.0.0.1:19432/<database>"
pnpm --filter @infinite-canvas/api test -- src/payment-sandbox-runtime.integration.test.ts
```

未设置 `PAYMENT_SANDBOX_TEST_DATABASE_URL` 时该 integration test 显式 skip，不能作为 Runtime PASS。测试自行启动动态端口 payment sandbox，不接触真实资金。

## GEN-008 / GEN-018 provider sandbox harness (pending credentials)

- Test：`apps/worker/src/provider-sandbox-runtime.integration.test.ts`
- 支持 adapter：OpenAI-compatible、Gemini、Seedance、Stable Diffusion/A1111/Forge、MediaKit
- MediaKit 确定性能力层：迁移 z3cz 的 `fast/standard/pro/llm` 视频增强与 `standard/refined` 字幕擦除矩阵；Admin 保存渠道级配置，Worker 合并 protocol/channel config，并对显式配置执行 operation + mode fail-closed gate。未配置的历史渠道保持兼容。
- 真实链路：构建生产请求 → 实际 HTTPS submit → 可选 poll 至终态 → adapter normalize → 必须存在可用 text/media result
- 凭据隔离：case file 只写 `apiKeyEnv` 环境变量名；密钥仅从进程环境读取，不写入 JSON、日志或仓库
- 安全门槛：HTTP 2xx、poll deadline、失败终态和空结果均导致 test FAIL；没有 case file 时显式 skip，不能作为 Runtime PASS

外部 case file 示例：

```json
[
  {
    "id": "openai-sandbox-text",
    "adapter": "openai-compatible",
    "baseUrl": "https://sandbox.example.com",
    "apiKeyEnv": "OPENAI_SANDBOX_API_KEY",
    "capability": "text",
    "upstreamModel": "sandbox-model",
    "parameters": { "prompt": "Return exactly: runtime-ok" }
  }
]
```

复验命令：

```powershell
$env:PROVIDER_SANDBOX_CASES_FILE = "C:\secure\provider-cases.json"
$env:OPENAI_SANDBOX_API_KEY = "<sandbox-secret>"
pnpm --filter @infinite-canvas/worker test -- src/provider-sandbox-runtime.integration.test.ts
```

2026-08-28 本机 Process/User/Machine 均未发现相关 sandbox endpoint/credential，且 A1111/Forge 常用端口无监听，因此 `GEN-008`、`GEN-018` 继续保持 `RUNTIME-PENDING`，没有把 skip 计为 PASS。

## DRM-008 Jianying desktop import (pending desktop runtime)

- Worker exporter 已迁移已授权 VOZEB-PRO 使用的 MIT `jsjianyingdraft`：Render Job 快照镜头/音频 material manifest，生成真实 video/audio/subtitle track 与 segment；剪映 5 输出 `draft_content.json`、剪映 6 输出 `draft_info.json`，两者均附 `draft_meta_info.json` 和本地素材。
- 素材总量限制 200 MiB；版本只接受 `5`/`6`；素材文件名去除路径与危险字符，防止 ZIP entry traversal。
- 本地单测只证明包结构与 Worker 生命周期，不等价于目标剪映桌面版成功导入；完成该项仍需在目标 Windows 剪映 5.x/6+ 执行真实导入。

## GEN-017 Volcengine AK/SK harness (pending credentials)

- Test：`packages/model-gateway/src/volcengine-sandbox-runtime.integration.test.ts`
- 已迁移 z3cz 的资源包计量语义：跨状态按 InstanceNo 去重，按 ConfigurationCode 聚合 quota/used/remaining/expired，并拒绝混合单位；Admin 直接展示可用额度而非截断 raw JSON
- 真链：使用生产 HMAC-SHA256 signer 分别请求 models、resource packages、usage；要求 HTTP 2xx、JSON 小于 2 MiB、无 `ResponseMetadata.Error`
- 配置：`VOLCENGINE_SANDBOX_BASE_URL`、`VOLCENGINE_SANDBOX_ACCESS_KEY_ID`、`VOLCENGINE_SANDBOX_SECRET_ACCESS_KEY`；region/service/version/action 可用同名前缀变量覆盖
- 密钥只从进程环境读取，不写入 case、日志或仓库

```powershell
$env:VOLCENGINE_SANDBOX_BASE_URL = "https://open.volcengineapi.com"
$env:VOLCENGINE_SANDBOX_ACCESS_KEY_ID = "<sandbox-ak>"
$env:VOLCENGINE_SANDBOX_SECRET_ACCESS_KEY = "<sandbox-sk>"
pnpm --filter @infinite-canvas/model-gateway test -- src/volcengine-sandbox-runtime.integration.test.ts
```

未同时设置三项变量时 3 tests 显式 skip，不能作为 Runtime PASS；2026-08-28 本机未发现 AK/SK，因此 `GEN-017` 继续保持 `RUNTIME-PENDING`。
