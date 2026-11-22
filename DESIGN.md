# CodeArts 代理设计说明

## 一、目标与非目标

**目标**

1. 用本地代理把华为云码道（CodeArts）模型接入 opencode 与 Claude Code。
2. 鉴权优先 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`（与官方 CLI 同一套）；可选 TUI 网页登录
   作为模型兜底，签到使用浏览器 Cookie。不依赖 magpie。
3. 结构和 `opencode-deveco` 对齐：TypeScript + `src/` → `dist/` + 本地代理；
   同时提供 OpenAI 与 Anthropic 两套协议。
4. 代理默认 **17228**（deveco 是 17128），两者可并存。
5. 全程直连：不读系统代理；进程里存在 `HTTP(S)_PROXY` 时固定 `NO_PROXY=*`。

**非目标**

- 不把 TUI OAuth 当作签到凭据——它不返回网页 user token，签到仍用浏览器 Cookie。
- 不保存 AK/SK 到磁盘；可选的 web 登录凭据保存在 `web-auth.json`（0600）。
- 自动签到默认不启用，必须显式 `npm run signin:enable`。
- 不实现 DevEco 专有的 `exitSessionQueue`、真实姓名/区域门禁。

## 二、总体架构

```
opencode / Claude Code
  │  OpenAI:    POST http://127.0.0.1:17228/v2/chat/completions
  │  Anthropic: POST http://127.0.0.1:17228/anthropic/v1/messages
  ▼
本地代理 CodeArtsProxy
  │  1. 从 env / shell profile 解析 AK/SK
  │  2. 协议转换 / 请求体归一化 / 视觉回落
  │  3. 并发闸门（最多 3 个会话，有界队列 + 冷却）
  │  4. SDK-HMAC-SHA256 签名
  │  5. 直连上游
  ▼
https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions
```

**独立代理是主用法**：代理自己运行，opencode 只需要 `provider.codearts`（由
`npm run print-provider` 生成），不需要把仓库加入 `plugin` 数组。

插件层是**可选的便利层**，同一份 `dist/index.js` 同时导出两种形态：

| 形态 | 导出 | 使用方 | 注入方式 |
| --- | --- | --- | --- |
| V1 | `{ id, server: Plugin }` | 较早的 opencode | `server` 返回 `config` hook，写 `config.provider.codearts` |
| V2 | `{ id, setup(ctx) }` | 当前 `PluginSupervisor` | `ctx.provider.transform(draft => draft.add({ info, models }))` |

V2 的 `setup` 会先检查 `ctx.provider.transform` 是否存在；V1 用 V1 形状的 ctx 调用
`setup` 时直接返回，由 `server` 负责。

## 三、认证：AK/SK 优先 + 网页登录兜底

优先级：

1. 进程环境变量 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`。
2. `CODEARTS_ENV_FILE` 指定的文件。
3. 当前 shell 的 profile（按 `$SHELL` 排序）：
   - zsh：`.zshenv` → `.zprofile` → `.zshrc` → `.zlogin`
   - bash：`.bash_profile` → `.bashrc` → `.profile`
   - fish：`.config/fish/config.fish`
   - sh/dash：`.profile`
   - 每个列表最后都追加其他常见文件，避免 service 与终端 shell 不一致时漏掉变量。
4. CodeArts TUI 网页登录保存的临时 AK/SK/ST
   （`~/.config/opencode/opencode-codearts/web-auth.json`，0600）。
5. `CODEARTS_DISABLE_PROFILE=1` 可关闭第 2、3 步（测试使用）；不影响第 4 步。

profile **只读取不执行**，只匹配 `export KEY=value`、`KEY=value`、`set -gx KEY value`。
可选 `CODEARTS_CLI_SECURITY_TOKEN` 用于临时 STS 凭据；永久 AK/SK 不需要。

网页登录（`src/oauth.ts` + `web-auth.ts`）镜像 CodeArts CLI 的 TUI 流程：
`CodeArts_Tui` + PKCE + DPoP → 本地回调 → STS `/v1/oauth2/tokens`，保存完整凭据与
refresh token，可自动续期。AK/SK 存在时**永远优先**使用 AK/SK，因为网页登录态容易过期。

> 实测 TUI OAuth 只返回临时 AK/SK/ST + refresh token，**不返回网页 user token**；
> 因此它只能作为模型 API 的兜底，每日签到仍需要浏览器 Cookie（见“每日签到”）。

这样设计的原因：代理可能由 systemd 或 opencode 后台 service 启动，进程环境里没有用户
终端导出的变量。profile 兜底让变量“手动设置一次”即可长期生效；网页登录则给没有
AK/SK 的机器一个可用的模型通道。

## 四、请求签名

实现见 `src/signing.ts`，与华为 SDK 的 SDK-HMAC-SHA256 一致：

```
CanonicalRequest =
  HTTP_METHOD\n
  CanonicalURI（以 / 结尾）\n
  CanonicalQueryString\n
  CanonicalHeaders（小写、按 key 排序）\n
  SignedHeaders\n
  Hex(SHA-256(body))

StringToSign = "SDK-HMAC-SHA256\n" + X-Sdk-Date + "\n" + Hex(SHA-256(CanonicalRequest))
Authorization = "SDK-HMAC-SHA256 Access=<AK>,SignedHeaders=<...>,Signature=<...>"
```

- 固定签名头：`host`、`x-sdk-date`、`x-sdk-content-sha256`；POST 追加 `content-type`。
- 有 security token 时才发送 `x-security-token`。
- 签名头必须原样发送；代理使用 `Headers` 逐项写入，不额外改写已签名头的值。
- AK/SK 路径**不发送** `maas_type: benefit`。实测带上该头会被网关拒绝（`APIG.0101`）。
- 签名在拿到并发槽位之后进行，长时间排队不会让 `x-sdk-date` 过期。

## 五、本地代理

`src/proxy.ts`，默认 `127.0.0.1:17228`，`CODEARTS_PROXY_PORT` 可覆盖。

| 路由 | 行为 |
| --- | --- |
| `POST /v2/chat/completions` | OpenAI 兼容：归一化 → 签名 → 转发；SSE 逐块透传（省略 `/v2` 或旧 `/api/v2`、`/v1` 前缀也可） |
| `POST /anthropic/v1/messages` | Anthropic Messages：转换 → 签名 → 转发；流式事件转换 |
| `GET /v2/models`（或 `/models`） | 实时拉 `/v1/model/builtin`，失败回退快照/静态目录；每个模型带全部上游字段 |
| `GET /models/<id>` 等 | 单个模型的完整记录（含 `upstream` 原始对象） |
| `GET /usage` | 签名 GET `/snap-manager/v1/statistics/plugin`，映射为积分窗口 |
| `GET /login` | 启动 TUI 网页登录，返回 `login_url`；回调后保存 `web-auth.json` |
| `GET /logout` | 清除网页登录态（不影响 AK/SK） |
| `GET /signin` | 每日签到（浏览器 Cookie / web user token） |
| `GET /status` | `{ configured, ak, source, source_file, missing, base_url, anthropic_base_url, models, web_auth, web_cookie }` |
| `GET /health` | `{ ok: true }` |
| `GET /login`、`/logout` | `410` + “请设置 CODEARTS_CLI_AK/SK”说明（明确没有网页登录） |

流式处理：

- 上游 SSE 原样 `res.write`；每收到一块重置 120 秒空闲计时器。
- 客户端断开（`res` close / `req` aborted）→ abort 上游请求。
- 上游头部等待也有 120 秒上限；网络错误返回 502 JSON。
- Anthropic 流使用 `openaiChatStreamToAnthropic` 转换，`onUpstreamChunk` 同样重置空闲计时器。

端口冲突：如果目标端口已被**本代理**的另一个实例占用（systemd 服务 + 手动 `start:proxy`），
`startProxy()` 会探测 `/status` 的 `provider` 字段并直接复用，不再让插件加载失败。

### 每日签到

`src/signin.ts` 走网页福利活动服务（axios baseURL 为 `/chat`）：

```
GET  https://devcloud.cn-north-4.huaweicloud.com
     /chat/PromptCenterService/v1/ops/delivery?channel=WEB
POST https://devcloud.cn-north-4.huaweicloud.com
     /chat/PromptCenterService/v1/ops/claim
body: { campaignId, idempotentKey: "daily-<id>-<YYYYMMDD>", channel: "WEB" }
```

当前两个每日签到活动（都是限时活动）：

| campaignId | 标题 | 奖励 |
| ---: | --- | ---: |
| 34 | 每日签到领100积分 | 100 CREDIT |
| 40 | Skill创新赛每日签到礼 | 1000 CREDIT |

Skill 创新赛介绍：<https://developer.huaweicloud.com/competition/information/1300000350/html1>。
默认按标题包含「每日签到」匹配，可用 `CODEARTS_SIGNIN_TITLES` 或
`CODEARTS_SIGNIN_CAMPAIGNS=34,40` 覆盖。

鉴权必须是网页登录态：浏览器 Cookie（含 `devclouddevuibjtcftk`），或 web user token
（`x-auth-token`）。AK/SK 与 TUI OAuth token 都不能直接领取；`benefit/claim` 与
`opengw` 的 AK/SK 路径都返回 `4000 invalid channel, group not found`。

Cookie 来源：`CODEARTS_WEB_COOKIE` → `CODEARTS_WEB_COOKIE_FILE` →
`~/.config/opencode/opencode-codearts/web-cookie.txt`（0600）。支持浏览器扩展 JSON、
Playwright `{cookies}`、Netscape `cookies.txt`、完整 cURL（自动提取 `Cookie:`）或裸 Cookie。

结果处理：

- `code 0/200`：领取成功；
- `CONFIRMED` / `CLAIMED` / `40001`（尚未刷新）：今日已领取，按成功处理；
- `endedCampaigns` 或「过期/结束/未开始」：活动已结束，记录 `expired` 并跳过；
- `401`/`403`/`HW-AJAX-REDIRECT`：登录态失效，需要重新导出 Cookie；
- 两个活动都下线、列表为空：输出“未找到进行中的每日签到活动”，按完成处理；
- 其他错误：非 0 退出，交给定时器日志。

**自动签到是可选功能**：`install-autostart.sh` 只安装代理，不会启用签到 timer。
用户先完成 `npm run login` 与 `npm run signin:import-cookie`（支持 Cookie-Editor/
EditThisCookie JSON、剪贴板、cURL、Cookie 头），再用 `npm run signin:enable` 显式启用；
`npm run signin:disable` 关闭。`signin:enable` 会检查 `web-auth.json` 和
`web-cookie.txt`，然后安装 `opencode-codearts-signin.timer`（每天 08:00，`Persistent=true`）。

`src/signin-cli.ts`（`npm run signin`）用于手动测试。

### 并发闸门（对齐 deveco）

CodeArts 每个账号最多 3 个并发会话，第 4 个返回 400 `TM.00001041`。`src/gate.ts` 的
`ConcurrencyGate` 与 `opencode-deveco/src/proxy.ts` 同款语义：

- `CODEARTS_MAX_CONCURRENCY`（默认 3）：同时打到上游的 chat 数量。
- `CODEARTS_MAX_QUEUE`（默认 3）：等待队列上限；再超出立即 429
  `codearts_queue_full` + `Retry-After: 1`。
- `CODEARTS_QUEUE_COOLDOWN_SEC`（默认 1）：排队请求获准后先等冷却，再调用上游。
- 客户端在排队期间断开 → `abandoned`，立即出队且不占槽位。
- 槽位在**上游响应完全结束**后才 `release()`，覆盖正常、流中断、fetch 失败所有路径。
- 若仍撞上上游 `TM.00001041`（其他 CLI/IDE 占用会话），读取错误体并改写为 429
  `codearts_concurrency_limit`。
- 会话复用：客户端 `x-session-id` 或请求体 `prompt_cache_key` 会映射为上游
  `x-ot-session-id` / `user-session-id` 并参与签名；同一会话切换模型只占一个上游会话，
  避免切 3 次模型就把 3 个会话额度耗尽。
- OpenAI 与 Anthropic 两条路径共用同一个闸门；元数据请求不经过闸门。

### 直连策略

`src/http.ts` 不创建任何代理 dispatcher。Bun 的 `fetch` 会读 `HTTP(S)_PROXY`，因此检测到
代理环境时把 `NO_PROXY`/`no_proxy` 置为 `*`；Node 的 `fetch` 默认不读代理环境，此项无副作用。

## 六、协议转换与请求归一化

### OpenAI 路径

`src/normalize.ts` 修正网关不接受/会误读的形状：

- `developer` role → `system`。
- `max_completion_tokens` → `max_tokens`。
- `tool_choice` 对象 → 枚举；强制工具时 `required` + 窄化 `tools`。
- `reasoning_effort`：`none/minimal/medium/xhigh` → `low|high|max`
  （CodeArts 的 thinking 模型只接受这三档）。
- `max_tokens` 截断到模型的 `limit.output`（如 kimi 的 256000 → 65536），避免上游
  `InferHub.001001005.400`。
- 响应侧兜底：SSE 缺 `finish_reason` 时补 `stop` / `tool_calls`；最终回答只在
  `reasoning_content` 时回填 `content`；清理 `<|message_end|>` 控制符。

### 视觉回落

`src/vision-routing.ts`：

- 目录里 `modalities.input` 不含 `image` 的模型收到**新图片** → 改路由到
  `CODEARTS_VISION_MODEL`（默认 `glm-5.3-flash`）。
- 只有**历史图片**时 → 用文本占位符替换图片，模型不变。
- 未知模型不做处理，避免把自定义 provider 的模型改掉。

### Anthropic 路径

`src/anthropic-transform.ts`（移植自 deveco）双向转换：

- 请求：Anthropic `system` / `messages` / `tools` / `tool_choice` / `thinking` →
  OpenAI Chat Completions。
- 响应：OpenAI `message` / `tool_calls` / `reasoning_content` → Anthropic
  `content` blocks（text / thinking / tool_use）。
- 流：OpenAI SSE → Anthropic `message_start`、`content_block_*`、`message_delta`、
  `message_stop`；错误转为 Anthropic `error` 事件。
- **兼容 CodeArts 的紧凑 SSE**：上游写 `data:{...}`（冒号后无空格），解析器同时接受
  `data:` 与 `data: `，`[DONE]` 同理。
- Claude 模型名映射：请求里的模型若本身是 CodeArts 模型 id 就直接用；否则用
  `CODEARTS_ANTHROPIC_MODEL`（默认 `glm-5.3-flash`）。

## 七、上游错误归一化

- `TM.00001041` / 并发会话上限 → 429 `codearts_concurrency_limit`（Anthropic 侧为
  `rate_limit_error`）。
- 上下文超长（context length / too many tokens / OverLimit…）→ 原状态码 +
  `codearts_context_limit`，消息附上该模型的 context 窗口。
- 其他上游错误保留状态码与正文；网络错误返回 502。

## 八、模型目录与用量

- 实时来源：`GET /v1/model/builtin`（签名 GET，额外头 `Agent-Type: PromptCenter`、
  `X-Language: zh-cn`）。
- **保留全部上游参数**：`model_id`、`model_name`、`model_category`、`model_desc`、
  `model_sku`、`provider`、`channel_source`、`enable`、`display_enabled`、
  `context_window`、`max_tokens`、`supports_images`、`credit`（各输入/输出档价格与倍率）、
  `time_slots`（错峰时段）、`intervals`。原始对象放在 `ModelInfo.upstream`，不做裁剪。
- 映射到 opencode 的字段：`name`、`limit.context/output`、`attachment`、
  `modalities`、`tool_call`；其余字段通过 `upstream` 保留。
- 忽略 `enable === false` / `display_enabled === false`，按 `model_id` 去重。
- 快照：`~/.config/opencode/opencode-codearts/models.json`
  （`OPENCODE_CONFIG_DIR` 优先）。旧版本快照缺少的 `upstream` 会用静态目录补齐。
- 冷启动目录：`src/builtin-models.ts` 保存 `/v1/model/builtin` 的完整 12 模型快照，
  `src/config.ts` 由它生成 `CATALOG`。
- `GET /models` 把 `upstream` 展开到模型对象顶层；`GET /models/<id>` 返回完整记录；
  `print-provider` 生成的 provider 配置同样带 `upstream`（opencode 会忽略未知字段）。
- 用量：`usage.ts` 把 `usageTotalPackageCredit` 等积分桶映射为
  `{ plan, windows: [{ name, used, display, amount, limit, unit }] }`，总积分排第一，空桶丢弃。

## 九、守护与服务

**opencode 后台 service 与代理是两回事**：opencode v2 默认会拉起
`opencode.exe serve --service`，并可能在它里面加载插件、启动代理。本项目的部署方式是：

1. 停用 opencode 自己的后台 service：
   `opencode service set disabled true` + `opencode service stop`；
2. CodeArts 代理由 systemd user / launchd / Windows 启动项独立管理，登录即运行；
3. 插件只注入 provider；启动时先探测 17228，已有代理就复用，没有才在当前 opencode
   进程内启动，opencode 进程退出时代理随之关闭，不会留下独立 daemon。

- `src/proxy-cli.ts`：独立代理入口（`npm run start:proxy`），处理 SIGINT/SIGTERM。
- `src/daemon.ts`：可选的 supervisor（`npm start`），用于没有 systemd/launchd 的场景
  （例如 Windows 或手动运行），不是 opencode 的后台进程。
- `scripts/opencode-codearts.service`：systemd user 服务（Linux 主用法）。
- `scripts/com.opencode-codearts.proxy.plist`：macOS LaunchAgent。
- `scripts/start-windows.ps1` / `stop-windows.ps1`：Windows 隐藏窗口 + supervisor。
- `scripts/install-autostart.sh` / `uninstall-autostart.sh`：Linux/macOS 一键安装/卸载自启动。
- `scripts/install-autostart-windows.ps1` / `uninstall-autostart-windows.ps1`：
  Windows 启动文件夹快捷方式。
- `scripts/opencode-codearts-signin.service` / `.timer`：每日 08:00 签到模板（Linux）。
- `scripts/com.opencode-codearts.signin.plist`：每日 08:00 签到模板（macOS）。
- `scripts/enable-signin-timer.sh` / `disable-signin-timer.sh`：签到 timer 的显式启用/关闭；
  启用前检查 web 登录和 Cookie 文件。
- 安装脚本会把当前 `$SHELL` 写入服务环境，保证 AK/SK 的 shell profile 兜底可用；
  **不会**自动启用签到 timer。
- `src/print-provider.ts`（`npm run print-provider`）：输出 opencode 的 provider 配置，
  供“独立代理、不挂插件列表”的用法。

## 十、模块与文件

```
src/
├── index.ts              两种插件形态的默认导出
├── plugin.ts             V1 config hook + V2 setup + 代理生命周期
├── proxy.ts              本地 HTTP 代理（OpenAI/Anthropic、闸门、签名、模型、用量）
├── config.ts             provider/端点/端口/静态目录/闸门参数/日志
├── credentials.ts        env → CODEARTS_ENV_FILE → shell profile → web login 解析
├── oauth.ts              TUI OAuth（CodeArts_Tui + PKCE + DPoP）
├── web-auth.ts           网页登录持久化、刷新、状态
├── signin.ts             每日签到（Cookie / web user token）
├── login-cli.ts          npm run login
├── signin-cli.ts         npm run signin
├── import-cookie.ts      npm run signin:import-cookie
├── gate.ts               并发闸门（上限 + 有界队列 + 冷却）
├── signing.ts            SDK-HMAC-SHA256（WebCrypto）
├── normalize.ts          OpenAI 请求体归一化
├── vision-routing.ts     文本模型遇图回落
├── anthropic-transform.ts Anthropic ↔ OpenAI 请求/响应/流转换
├── builtin-models.ts     /v1/model/builtin 的完整静态快照（全部字段）
├── models.ts             实时模型列表、快照、用户模型合并
├── usage.ts              积分用量映射
├── http.ts               直连 fetch + NO_PROXY 策略
├── network-error.ts      DNS/连接/超时/TLS 失败的可读提示
├── proxy-cli.ts          独立运行代理（npm run start:proxy）
├── daemon.ts             supervisor（npm start）
├── print-provider.ts     输出 opencode provider 配置
└── *.test.ts             vitest（124 项）
scripts/
├── opencode-codearts.service
├── com.opencode-codearts.proxy.plist
├── opencode-codearts-signin.service / .timer
├── com.opencode-codearts.signin.plist
├── enable-signin-timer.sh / disable-signin-timer.sh
├── install-autostart.sh / uninstall-autostart.sh
├── install-autostart-windows.ps1 / uninstall-autostart-windows.ps1
└── start-windows.ps1 / stop-windows.ps1
```

## 十一、与 opencode-deveco 的对齐情况

| 维度 | opencode-deveco | opencode-codearts |
| --- | --- | --- |
| 运行形态 | 本地代理 + 可选插件 | 本地代理 + 可选插件（独立代理为主） |
| 鉴权 | 浏览器登录 + jwtToken 文件 + Bearer | AK/SK 优先；可选 TUI web 登录兜底 |
| 请求 | 注入 Bearer，无签名 | SDK-HMAC-SHA256 签名 |
| 代理端口 | 17128 | **17228** |
| 并发闸门 | `ConcurrencyGate`，默认 1 | `ConcurrencyGate`，默认 **3**（账号上限） |
| 队列/冷却/429 | 有 | 有（同名语义） |
| OpenAI 归一化 | 有 | 有（developer/max_tokens/tool_choice/effort） |
| 视觉回落 | 有 | 有（按目录 `supports_images`） |
| Anthropic Messages | 有 | 有（含紧凑 `data:` SSE） |
| 上下文/限流提示 | 有 | 有（context + TM.00001041） |
| 模型目录/快照 | 有 | 有 |
| 用量 | magpie hook | `GET /usage` |
| 守护/自启脚本 | systemd/launchd/Windows | systemd/launchd/Windows |
| 凭据存储 | jwt.json | AK/SK 不落盘；可选 web 登录 `web-auth.json`（0600） |
| 依赖 | undici（代理环境） | 无运行时依赖（WebCrypto + 全局 fetch） |

**有意保留的差异**

- 不实现 DevEco 的 `exitSessionQueue`、真实姓名/区域门禁、`-DevEco` 模型别名。
- 不实现 magpie 的 `auth.usage` hook（opencode 没有该 hook），改为 `/usage` 接口。
- 不写 `small_model`（CodeArts 没有云端 task map；用户可自行指定）。

## 十二、测试

`npm test`（vitest，124 项）：

- 签名：SHA-256/HMAC 已知向量、canonical request 布局、固定时间戳的确定性、security token。
- 凭据：env 组合、掩码、zsh/bash/fish/sh 的 profile 顺序与 `set -gx` 解析。
- 模型：builtin 解析、VL/禁用过滤、去重、快照读写、旧快照补全、全部上游字段保留、用户配置合并。
- 用量：总积分优先、空桶丢弃、`limit - remain` 兜底、业务错误码。
- 闸门：上限、排队、队列满、排队取消、冷却。
- 归一化：developer role、max_completion_tokens、tool_choice、reasoning_effort。
- 视觉回落：新图改路由、历史图剥离、视觉/未知模型不处理。
- Anthropic：请求/响应转换、thinking、tool calls、流式事件、紧凑 `data:` 解析。
- 代理：`/status`、缺少凭据 401、web 登录状态/logout、签名转发、SSE 透传、实时模型、
  `/models/<id>`、用量、并发串行化、队列满 429、`TM.00001041` → 429、上下文超长提示、
  视觉回落、Anthropic。
- 响应归一化：reasoning-only 回填 `content`、`<|message_end|>` 清理、缺 `finish_reason`
  补 `stop` / `tool_calls`、`max_tokens` 截断到模型输出上限。
- 会话复用：`x-session-id` 优先、`prompt_cache_key` 兜底，两者都写入上游
  `x-ot-session-id` / `user-session-id`。
- 签到：Cookie JSON/Netscape/cURL/裸头解析、`devclouddevuibjtcftk` 优先、两个每日签到活动、
  `ELIGIBLE` 领取、`CONFIRMED`/`40001` 已领取、`endedCampaigns`/过期跳过、无活动按完成、
  `HW-AJAX-REDIRECT` 失效、缺少 Cookie 时拒绝请求、web user token 头。
- 插件：V1 config hook 注入、用户 provider 保留、快照优先、端口跟随。
- 网络错误：DNS、连接拒绝、超时、TLS、连接中断的提示与 cause 链。
- supervisor：崩溃重启与退避。

真实环境冒烟（单测之外）：

- `GET /v1/model/builtin` → 200，12 个模型；
- `GET /models/GLM-5.2` → 含 `model_desc`、`model_category`、`credit`、`time_slots`、
  `upstream` 等全部字段；
- OpenAI chat（`stream:false` / `stream:true`）→ 200，SSE 正常；
- tool call → `finish_reason: "tool_calls"`，参数正确；
- `GET /usage` → 体验版积分窗口；
- Anthropic 非流/流式/thinking → 转换正常；
- `opencode models --standalone` → `codearts/<model>` 出现；
- 仅 provider 配置（无 plugin 数组）→ `codearts/<model>` 出现；
- opencode v2.3.2：glm/openpangu 基础对话、`shell` 工具调用、同会话
  `glm → openpangu → kimi → deepseek` 均正常且上下文共用；
- ZCode provider 级：openpangu 原始 reasoning-only 请求已回填正文；同会话 4 模型切换
  全部 200，无 429；
- TUI 网页登录（`CodeArts_Tui` + PKCE + DPoP）→ 保存 `web-auth.json`；
- 清空 AK/SK/profile 后，`/status` 显示 `source: "web"`，`/models` 实时列表正常；
- 签到接口：TUI OAuth token 不含 web user token，实际领取需要浏览器 Cookie；
  `npm run signin:import-cookie` 直接导入 Cookie-Editor JSON（43 个 Cookie，识别到 cftk），
  `npm run signin` 识别到两个活动（34 每日签到领100积分、40 Skill创新赛每日签到礼）
  并返回“今日已领取”。
- 自动签到 opt-in：`signin:disable` 移除 timer；`signin:enable` 检查 web 登录 + Cookie 后
  重新安装/启用 `opencode-codearts-signin.timer`（每天 08:00）。
