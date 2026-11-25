# opencode-codearts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![OpenCode plugin](https://img.shields.io/badge/OpenCode-plugin-blue)](https://opencode.ai)
![no magpie](https://img.shields.io/badge/magpie-not%20required-lightgrey)
![tests](https://img.shields.io/badge/tests-108%20passing-success)

把[华为云码道 CodeArts（代码智能体）](https://www.huaweicloud.com/product/codearts.html)
的模型接入 opencode / Claude Code：

- **AK/SK 优先**：读取 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`；可选 TUI 网页登录作为模型兜底。
- **本地代理**：默认 `127.0.0.1:17228`，同时提供 OpenAI 与 Anthropic 两套接口。
- **直连**：不读取系统代理；进程里存在 `HTTP(S)_PROXY` 时固定 `NO_PROXY=*`。
- **凭据处理**：AK/SK 不落盘；可选 web 登录保存在 `web-auth.json`（0600）。
- **并发闸门**：对齐 `opencode-deveco`，最多 3 个并发会话，排队/429/冷却。
- **会话复用**：ZCode 的 `x-session-id` 与 opencode 的 `prompt_cache_key` 会映射到上游
  `x-ot-session-id` / `user-session-id`；同一会话切模型不会重复占用 3 个上游会话。
- **响应兜底**：openpangu 把最终回答写进 `reasoning_content` 时自动回填正文；清理
  `<|message_end|>`；上游缺 `finish_reason` 时补 `stop` / `tool_calls`。
- **token 上限**：按模型声明的输出上限截断 `max_tokens`，避免 opencode 发 256000 被上游拒绝。

## 前置条件

- Node.js ≥ 20
- 华为云访问密钥（AK/SK）。获取与配置方式见官方文档：
  <https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0026.html>
- 可选：opencode ≥ 1.0 或 Claude Code

## 配置 AK/SK

官方文档中的变量名就是本代理使用的变量名：

```bash
export CODEARTS_CLI_AK="Access Key Id"
export CODEARTS_CLI_SK="Secret Access Key"
```

- **zsh**：写入 `~/.zshrc`
- **bash**：写入 `~/.bashrc`
- **fish**：`set -gx CODEARTS_CLI_AK "..."`、`set -gx CODEARTS_CLI_SK "..."` 写入 `~/.config/fish/config.fish`

改完后 `source` 对应文件，或重开终端。可以先验证码道 CLI 本身：

```bash
codearts models
```

### shell profile 兜底

代理进程可能由 systemd / opencode 后台 service 启动，环境里没有你终端导出的变量。
这时会读取当前 shell 的 profile：

| `$SHELL` | 读取顺序（先当前 shell，再其他常见文件） |
| --- | --- |
| zsh | `.zshenv` → `.zprofile` → `.zshrc` → `.zlogin` → `.profile` → `.bash_profile` → `.bashrc` |
| bash | `.bash_profile` → `.bashrc` → `.profile` → `.zshrc` → `.zshenv` |
| fish | `.config/fish/config.fish` → `.profile` → `.bashrc` → `.zshrc` |
| sh / dash | `.profile` → `.bash_profile` → `.bashrc` → `.zshrc` → `.zshenv` |

支持 `export KEY=value`、`KEY=value` 和 fish 的 `set -gx KEY value`。只读取、不执行 profile，
也只提取这两个变量。

- 指定其他文件：`export CODEARTS_ENV_FILE=/path/to/file`
- 关闭兜底：`export CODEARTS_DISABLE_PROFILE=1`

### 认证优先级（AK/SK 优先）

1. 进程环境变量 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`
2. shell profile（上一节）
3. **CodeArts TUI 网页登录**（可选兜底）：`npm run login` 或 `GET /login`

网页登录只在前两步都拿不到 AK/SK 时使用，因为登录态会过期；AK/SK 存在时永远优先。
登录结果保存在 `~/.config/opencode/opencode-codearts/web-auth.json`（0600），
包含临时 AK/SK/ST、refresh token 和 DPoP 私钥，可自动续期。

> 早期版本提供过可选的每日签到（Cookie 导入 + systemd timer）；因网页登录态频繁失效、
> 无法可靠自动执行，该功能已在 1.1.1中移除。

## 用法一：独立本地代理（推荐，不需要插件列表）

这两个项目本质上都是本地代理；代理自己跑起来后，只要在 opencode 里声明 provider 即可，
**不需要把仓库挂进 `plugin` 数组**。

```bash
cd /path/to/opencode-codearts
npm install
npm run build

# 停用 opencode v2 自己的后台 service，避免它常驻并托管插件代理
opencode service set disabled true
opencode service stop

# 前台运行，便于看日志：
npm run start:proxy
# 或带崩溃自动重启的 supervisor（没有 systemd 时使用）：
npm start
```

另开终端确认：

```bash
curl http://127.0.0.1:17228/status
curl http://127.0.0.1:17228/models
```

生成 opencode provider 配置并合并到 `~/.config/opencode/opencode.json`：

```bash
npm run print-provider
```

输出形如：

```json
{
  "provider": {
    "codearts": {
      "name": "CodeArts",
      "npm": "@ai-sdk/openai-compatible",
      "api": "http://127.0.0.1:17228/v2",
      "env": [],
      "options": { "apiKey": "opencode-oauth-dummy-key", "baseURL": "http://127.0.0.1:17228/v2" },
      "models": { "GLM-5.2": { "...": "..." } }
    }
  }
}
```

ZCode / 其他 OpenAI 兼容客户端：Base URL 填 `http://127.0.0.1:17228/v2`
（实际请求为 `/v2/chat/completions`）。Anthropic / Claude Code 用
`ANTHROPIC_BASE_URL=http://127.0.0.1:17228/anthropic`。代理同时兼容省略 `/v2`、
旧 `/api/v2` 前缀和 `/v1` 前缀的路径。

把 `provider.codearts` 合并进现有 `opencode.json`，重启 opencode：

```bash
opencode models | grep codearts
opencode run "你好" -m codearts/GLM-5.2
```

### 开机自启

一键安装/卸载（脚本会按当前仓库路径和 `node` 路径生成配置）：

```bash
# Linux（systemd --user）/ macOS（launchd）
bash scripts/install-autostart.sh
bash scripts/uninstall-autostart.sh
```

```powershell
# Windows（登录时启动；另有 start/stop 手动脚本）
powershell -ExecutionPolicy Bypass -File scripts\install-autostart-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\uninstall-autostart-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\start-windows.ps1
powershell -ExecutionPolicy Bypass -File scripts\stop-windows.ps1
```

也可以手动使用 `scripts/` 下的模板：

- `opencode-codearts.service`（Linux systemd user）
- `com.opencode-codearts.proxy.plist`（macOS LaunchAgent）
- `start-windows.ps1` / `stop-windows.ps1`（Windows 隐藏窗口 + supervisor）

安装后确认：

```bash
systemctl --user status opencode-codearts
curl http://127.0.0.1:17228/status
```

如需恢复 opencode 自己的后台 service：

```bash
opencode service unset disabled
opencode service start
```

## 用法二：opencode 插件（可选）

如果希望 opencode 启动时自动拉起代理并注入 provider，可以把仓库加入 `plugin` 数组：

```json
{
  "plugin": ["file:///path/to/opencode-codearts"]
}
```

模块同时导出 V1 `{ id, server }` 与当前 opencode V2 的 `{ id, setup }`，两种加载器都能用。
插件只负责注入 provider；它不会留下常驻 daemon：

- 如果 17228 上已经是 systemd/手动启动的 CodeArts 代理，插件探测 `/status` 后**直接复用**；
- 如果没有，插件才在当前 opencode 进程内启动一个临时代理，opencode 进程退出时代理随之关闭。

核心行为与独立代理完全一致。

> 首次安装或更新插件后请重启一次 opencode。

## Claude Code / Anthropic 客户端

代理同时实现 Anthropic Messages API：

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:17228/anthropic
export ANTHROPIC_API_KEY=opencode-oauth-dummy-key
export ANTHROPIC_MODEL=glm-5.3-flash

claude
```

- 路由：`POST /anthropic/v1/messages`（流式/非流式）。
- 支持 thinking、tool use、图片；thinking 的 `reasoning_effort` 会归一化为 CodeArts 接受的
  `low|high|max`。
- Claude 模型名会映射到 CodeArts 模型：`CODEARTS_ANTHROPIC_MODEL`（默认 `glm-5.3-flash`）。
  也可以直接把 `ANTHROPIC_MODEL` 设为 CodeArts 模型 id（如 `GLM-5.2`）。
- 响应的 `model` 字段回显上游模型 id，与 deveco 行为一致。

## 模型与上下文

| 模型 | 显示名 | context | output | 图片输入 |
| --- | --- | ---: | ---: | :---: |
| `GLM-5.2` | GLM-5.2 | 202,752 | 65,536 | |
| `openpangu-2.0-flash` | OpenPangu-2.0-Flash | 524,288 | 65,535 | |
| `openpangu-2.0-pro` | OpenPangu-2.0-Pro | 524,288 | 65,535 | |
| `openpangu-2.1-pro` | OpenPangu-2.1-Pro | 524,288 | 65,535 | |
| `glm-5.3` | GLM-5.3 | 1,048,576 | 65,536 | |
| `glm-5.3-flash` | GLM-5.3-Flash | 1,048,576 | 65,536 | ✓ |
| `glm-5.2-sft-harmony` | GLM-5.2-ArkTS-SPARK | 202,752 | 65,535 | |
| `deepseek-v4.1-flash` | DeepSeek-V4.1-Flash | 1,048,576 | 65,536 | ✓ |
| `deepseek-v4.1-flash-1017` | DeepSeek-V4.1-Flash-1017 | 1,048,576 | 65,536 | ✓ |
| `kimi-k3` | Kimi-K3 | 1,048,576 | 65,536 | ✓ |
| `kimi-k3.1-pro` | Kimi-K3.1-Pro | 1,048,576 | 65,536 | ✓ |
| `speed` | 智速模式 | 1,048,576 | 65,536 | |

列表优先使用 `/v1/model/builtin` 的实时结果，并缓存到
`~/.config/opencode/opencode-codearts/models.json`，供下次启动使用。

**完整上游参数**：代理保留上游返回的每一个字段，包括 `model_desc`、`model_category`、
`provider`、`channel_source`、`model_sku`、`credit`（各档价格/倍率）、`time_slots`
（错峰时段）、`intervals`、`enable`、`display_enabled`、`context_window`、`max_tokens`、
`supports_images` 等。它们会：

- 在 `GET /models` 的每个模型对象里原样带出；
- 通过 `GET /models/<model-id>` 单独查看；
- 写入 `models.json` 快照；
- 出现在 `npm run print-provider` 生成的 provider 配置里。

静态冷启动目录 `src/builtin-models.ts` 也是同一份完整快照（12 个模型）。

**视觉回落**：文本模型收到新图片时自动转发到 `CODEARTS_VISION_MODEL`（默认
`glm-5.3-flash`）；历史图片会被替换为文本占位符，避免后续文本轮次报错。

## 本地代理接口

默认 `http://127.0.0.1:17228`，刻意避开 `opencode-deveco` 的 `17128`：

| 路由 | 说明 |
| --- | --- |
| `POST /v2/chat/completions` | OpenAI 兼容，签名转发（SSE 透传）；省略 `/v2` 或旧 `/api/v2`、`/v1` 前缀也可 |
| `POST /anthropic/v1/messages` | Anthropic Messages 兼容（流式/非流式） |
| `GET /models` | OpenAI 风格模型列表 + 全部上游字段（实时失败时回退缓存） |
| `GET /models/<id>` | 单个模型的完整记录（含 `upstream` 原始对象） |
| `GET /usage` | 积分套餐用量（含 `remaining` / `display_remaining` 剩余额度） |
| `GET /login` | 启动 CodeArts TUI 网页登录，返回 `login_url` |
| `GET /logout` | 清除网页登录态（不影响 AK/SK） |
| `GET /status` | `{ configured, ak, source, web_auth, ... }`，不泄露 SK |
| `GET /health` | 存活检查 |

查询剩余额度：

```bash
curl -s http://127.0.0.1:17228/usage \
  | jq '.windows[] | {name, used: .amount, remaining, display_remaining}'
```

`display` 保留“已用 / 总额”语义；`remaining` 是原始 `package_credit_remain`，缺失时用 `limit - used` 兜底。

### 并发限制（对齐 deveco 的闸门）

CodeArts 每个账号**最多 3 个并发会话**，第 4 个会被上游直接拒绝：

```json
{"error_code":"TM.00001041","error_msg":"并发会话数已达上限(3个)，请关闭部分会话后重试。"}
```

代理内置 `ConcurrencyGate`（与 `opencode-deveco` 同款语义）：

- 默认最多 **3** 个并发的 chat 请求；
- 超出后进入有界队列，默认最多排 **3** 个；
- 队列也满时立刻返回 **429**（`codearts_queue_full`，带 `Retry-After: 1`）；
- 排队请求被客户端取消时立即出队，不占槽位；
- 每个排队请求在开始前等待 **1 秒**冷却；
- 仍撞上上游 `TM.00001041`（其他 CLI/IDE 占用会话）时，改写为 **429**
  `codearts_concurrency_limit`；
- `/status`、`/models`、`/usage` 不占并发槽位。
- 同一会话复用：客户端传 `x-session-id`（ZCode）或请求体 `prompt_cache_key`（opencode）时，
  代理会把它作为上游 `x-ot-session-id` / `user-session-id` 签名发送；同一会话内切换模型
  只占一个上游会话，不会切 3 次就累计满 3 个。

### 上游错误归一化

- 上下文超长：返回 `codearts_context_limit`，并在消息里附上该模型的上下文窗口。
- 请求体：`developer` role → `system`；`max_completion_tokens` → `max_tokens`；
  `tool_choice` 对象形式 → 网关接受的枚举/窄化 tools；`reasoning_effort`
  归一化为 `low|high|max`。
- `max_tokens` 按模型声明的输出上限截断（例如 kimi 的 256000 → 65536），避免上游
  `InferHub.001001005.400`。
- SSE 流缺少 `finish_reason` 时补 `stop` 或 `tool_calls`，避免 opencode 报
  `stream ended without finish_reason` 并反复重试。
- 最终回答只出现在 `reasoning_content` 时回填到 `content`；同时清理
  `<|message_end|>` 控制符。

### 风控与追踪头

代理按 CodeArts CLI 26.11.21 的实际请求补齐并签名以下头，避免上游把代理请求视为匿名客户端：

- 追踪：`x-ot-trace-id`、`x-ot-span-id`、`x-snap-traceid`
- 会话：`x-ot-session-id`、`x-ot-parent-session-id`、`user-session-id`、`x-session-affinity`
- 客户端：`x-ot-client-type: CLI`、`x-ot-client-version: 26.11.21`、`x-ot-function: agent-tui`、`client-ip`
- 插件/IDE：`plugin-name`、`plugin-version`、`ide-name`、`ide-version`
- 请求：`user-msg-id`、`x-message-id`、`created-time`、`model-id`、`model-name`、
  `x-language: zh-cn`、`x-remote-origin-url`

`model-name` 与 CLI 一致做百分号编码（`智速模式` → `%E6%99%BA...`），否则 fetch 会因非 ASCII 头值拒绝请求。

没有客户端会话 ID 时，代理使用进程级兜底 session，而不是发一个无会话的裸请求。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | ---: | --- |
| `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK` | — | 首选，华为云 AK/SK |
| `CODEARTS_CLI_SECURITY_TOKEN` | — | 可选，临时 STS 凭据 |
| `CODEARTS_ENV_FILE` | — | 指定 profile 文件 |
| `CODEARTS_DISABLE_PROFILE` | — | `1` 关闭 profile 兜底 |
| `CODEARTS_PROXY_PORT` | 17228 | 本地代理端口 |
| `CODEARTS_MAX_CONCURRENCY` | 3 | 并发 chat 上限 |
| `CODEARTS_MAX_QUEUE` | 3 | 排队上限；0 = 不排队 |
| `CODEARTS_QUEUE_COOLDOWN_SEC` | 1 | 排队请求冷却秒数 |
| `CODEARTS_ANTHROPIC_MODEL` | `glm-5.3-flash` | Claude 模型名映射到的 CodeArts 模型 |
| `CODEARTS_VISION_MODEL` | `glm-5.3-flash` | 文本模型遇图时的视觉回落模型 |
| `CODEARTS_LOG_LEVEL` | `info` | `debug` 看详细日志 |

## 故障排查

| 现象 | 处理 |
| --- | --- |
| `401 codearts_missing_credentials` | 设置 `CODEARTS_CLI_AK/SK`，或确认 shell profile 中有这两个变量 |
| `429 codearts_queue_full` | 并发/排队已满；稍后重试，或调大 `CODEARTS_MAX_QUEUE` |
| `429 codearts_concurrency_limit` | 账号的 3 个会话被其他客户端占用；确认客户端带 `x-session-id` / `prompt_cache_key` 以复用会话；仍 429 时关闭其他会话后重试 |
| `opencode` 报 `stream ended without finish_reason` | 1.1.1已在上游缺 finish 时补 `stop` / `tool_calls`；更新代理并重启 |
| `InferHub.001001005.400` | `max_tokens` 超出模型输出上限；1.1.1会按模型 `limit.output` 自动截断 |
| `ModelArts.81101` / `81114`（`speed` 模型） | 智速模式为上游共享配额（常见 4 次/秒、100 次/分），CLI 同样会触发；稍后重试或改用具体模型 |
| `400 codearts_context_limit` | 提示词超过模型上下文，缩短后重试 |
| 端口 17228 被占用 | 若占用者也是本代理会直接复用；否则用 `CODEARTS_PROXY_PORT` 换端口 |
| 模型列表为空 | 先 `curl 127.0.0.1:17228/models`；无实时列表时用静态 12 个模型兜底 |
| 想看详细日志 | `export CODEARTS_LOG_LEVEL=debug`，然后重启代理/opencode |

## 说明与限制

- 区域固定华为云 `cn-north-4`（与码道 CLI 一致）。
- AK/SK 路径**不需要** `maas_type: benefit` 头；带上反而会被网关拒绝（`APIG.0101`）。
- 用量是尽力而为：读取 `snap-manager/v1/statistics/plugin`，通过 `GET /usage` 查看（含剩余额度）。
- 运行时代码只依赖 Node/Bun 内置的 `fetch` 与 WebCrypto；`@opencode-ai/plugin` 仅提供类型。
- 插件层不是必需的；独立代理 + `print-provider` 即可完成全部功能。
- CLI 26.11.21 起对 `/api/v2/chat/completions` 默认启用 SM2/SM4-GCM 传输加密
  （`X-Encrypt-Capable: sm4-gcm`，失败自动回退明文）。代理保持签名明文请求；实测上游
  仍接受明文并正常返回（`/models`、`/usage`、OpenAI 与 Anthropic 对话均通过）。若未来
  上游强制加密，需要为代理补充国密实现。

## 版本记录

- **1.1.2**：对齐 CodeArts CLI 26.11.21 协议：客户端版本升级到 `26.11.21`，新增签名的
  `client-ip` 头，`model-name` 按 CLI 规则做百分号编码（修复中文模型名），并补充模型目录
  `Agent-Type: PromptCenter` 回归测试。文档记录 CLI 的 SM2/SM4 传输加密现状与 `speed`
  模型上游限流。测试更新至 108 项。
- **1.1.1**：`GET /usage` 新增 `remaining` / `display_remaining` 剩余额度字段（保留 `display` 兼容）；文档与测试更新至 107 项。
- **1.1.0**：reasoning-only 回填、`<|message_end|>` 清理、缺失 `finish_reason` 补全、`max_tokens` 截断、会话复用、CodeArts CLI 风控头对齐；签到功能已移除。

## English

**opencode-codearts** is a local proxy and optional opencode plugin for Huawei Cloud
CodeArts (码道). It authenticates with `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK` by default
(an optional TUI web login can serve as a model fallback; no magpie), signs every request
with Huawei's SDK-HMAC-SHA256, and serves both OpenAI (`/v2/chat/completions`) and
Anthropic (`/anthropic/v1/messages`) APIs on `127.0.0.1:17228` (override with
`CODEARTS_PROXY_PORT`). Connections are direct; the proxy never reads OS proxy settings
and pins `NO_PROXY=*` when a proxy environment is present.

`GET /usage` now includes `remaining` and `display_remaining` for each credit bucket.
1.1.2 aligns the risk-control headers with CodeArts CLI 26.11.21: the signed
`client-ip` header is added and `model-name` is percent-encoded (non-ASCII names such as
智速模式 would otherwise be rejected by fetch). The CLI now encrypts chat traffic with
SM2/SM4-GCM by default; the proxy keeps signed plaintext requests, which the gateway
still accepts. Compatibility fixes in 1.1.1: reasoning-only final answers are promoted to
`content`, `<|message_end|>` is stripped, a missing `finish_reason` is synthesized, and
`max_tokens` is capped to the model's declared output limit. ZCode `x-session-id` and
opencode `prompt_cache_key` are forwarded as `x-ot-session-id` / `user-session-id`, so
model switches in one conversation reuse the same upstream CodeArts session.

Run it standalone and declare the provider in `opencode.json`:

```bash
npm install && npm run build
npm run start          # or: npm run start:proxy
npm run print-provider # merge the output into ~/.config/opencode/opencode.json
```

Claude Code:

```bash
export ANTHROPIC_BASE_URL=http://127.0.0.1:17228/anthropic
export ANTHROPIC_API_KEY=opencode-oauth-dummy-key
export ANTHROPIC_MODEL=glm-5.3-flash
claude
```

The plugin entry (`{ id, server, setup }`) is optional: it only auto-starts the proxy and
injects the provider. See [DESIGN.md](./DESIGN.md) for the full architecture.

> The optional daily check-in (cookie import + systemd timer) was removed in the reissued
> 1.1.1: the web session expires too often to run unattended.

## License

MIT — see [LICENSE](./LICENSE).
