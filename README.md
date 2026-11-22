# opencode-codearts

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![OpenCode plugin](https://img.shields.io/badge/OpenCode-plugin-blue)](https://opencode.ai)
![no magpie](https://img.shields.io/badge/magpie-not%20required-lightgrey)
![tests](https://img.shields.io/badge/tests-99%20passing-success)

把[华为云码道 CodeArts（代码智能体）](https://www.huaweicloud.com/product/codearts.html)
的模型接入 opencode / Claude Code：

- **只认 AK/SK**：读取 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`，不做网页登录、不需要 magpie。
- **本地代理**：默认 `127.0.0.1:17228`，同时提供 OpenAI 与 Anthropic 两套接口。
- **直连**：不读取系统代理；进程里存在 `HTTP(S)_PROXY` 时固定 `NO_PROXY=*`。
- **零密钥落盘**：AK/SK 只从环境变量或 shell profile 读取，插件不保存凭据。
- **并发闸门**：对齐 `opencode-deveco`，最多 3 个并发会话，排队/429/冷却。

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
      "api": "http://127.0.0.1:17228/api/v2",
      "env": [],
      "options": { "apiKey": "opencode-oauth-dummy-key", "baseURL": "http://127.0.0.1:17228/api/v2" },
      "models": { "GLM-5.2": { "...": "..." } }
    }
  }
}
```

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
| `POST /api/v2/chat/completions` | OpenAI 兼容，签名转发（SSE 透传） |
| `POST /anthropic/v1/messages` | Anthropic Messages 兼容（流式/非流式） |
| `GET /models` | OpenAI 风格模型列表 + 全部上游字段（实时失败时回退缓存） |
| `GET /models/<id>` | 单个模型的完整记录（含 `upstream` 原始对象） |
| `GET /usage` | 积分套餐用量 |
| `GET /status` | `{ configured, ak, source, ... }`，不泄露 SK |
| `GET /health` | 存活检查 |

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

### 上游错误归一化

- 上下文超长：返回 `codearts_context_limit`，并在消息里附上该模型的上下文窗口。
- 请求体：`developer` role → `system`；`max_completion_tokens` → `max_tokens`；
  `tool_choice` 对象形式 → 网关接受的枚举/窄化 tools；`reasoning_effort`
  归一化为 `low|high|max`。

## 环境变量

| 变量 | 默认 | 说明 |
| --- | ---: | --- |
| `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK` | — | 必填，华为云 AK/SK |
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
| `429 codearts_concurrency_limit` | 账号的 3 个会话被其他客户端占用；关闭部分会话后重试 |
| `400 codearts_context_limit` | 提示词超过模型上下文，缩短后重试 |
| 端口 17228 被占用 | 若占用者也是本代理会直接复用；否则用 `CODEARTS_PROXY_PORT` 换端口 |
| 模型列表为空 | 先 `curl 127.0.0.1:17228/models`；无实时列表时用静态 12 个模型兜底 |
| 想看详细日志 | `export CODEARTS_LOG_LEVEL=debug`，然后重启代理/opencode |

## 说明与限制

- 区域固定华为云 `cn-north-4`（与码道 CLI 一致）。
- AK/SK 路径**不需要** `maas_type: benefit` 头；带上反而会被网关拒绝（`APIG.0101`）。
- 用量是尽力而为：读取 `snap-manager/v1/statistics/plugin`，通过 `GET /usage` 查看。
- 运行时代码只依赖 Node/Bun 内置的 `fetch` 与 WebCrypto；`@opencode-ai/plugin` 仅提供类型。
- 插件层不是必需的；独立代理 + `print-provider` 即可完成全部功能。

## English

**opencode-codearts** is a local proxy and optional opencode plugin for Huawei Cloud
CodeArts (码道). It authenticates with `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK` (no browser
OAuth, no magpie), signs every request with Huawei's SDK-HMAC-SHA256, and serves both
OpenAI (`/api/v2/chat/completions`) and Anthropic (`/anthropic/v1/messages`) APIs on
`127.0.0.1:17228` (override with `CODEARTS_PROXY_PORT`). Connections are direct; the
proxy never reads OS proxy settings and pins `NO_PROXY=*` when a proxy environment is
present.

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

## License

MIT — see [LICENSE](./LICENSE).
