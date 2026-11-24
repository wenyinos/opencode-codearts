# AGENTS.md — opencode-codearts

本文件是后续编码代理在本仓库工作的项目级说明。开始修改前，先读本文件、`README.md`、`DESIGN.md` 和相关 `src/` 实现，避免重复踩坑。

## 1. 项目定位

- 把华为云码道 CodeArts 的模型接入 **opencode、ZCode、Claude Code**。
- 主体是一个**本地代理**，插件是可选入口，不是必须挂载到 opencode 插件列表。
- 默认监听 `127.0.0.1:17228`，与 opencode-deveco 的 `17128` 区分。
- OpenAI 基址：`http://127.0.0.1:17228/v2`。
- Anthropic 基址：`http://127.0.0.1:17228/anthropic`。
- **不依赖 magpie**；AK/SK 优先，TUI 网页登录只作模型凭据兜底。
- **所有请求直连华为云**，不使用系统代理或第三方转发。
- opencode 自己的后台 service 与本代理是两件事：可以独立停用 opencode daemon，同时保留本代理的 systemd 服务。

当前版本：`1.1.1`。最近一次发布：`v1.1.1`。

## 2. 技术栈与硬约束

- Node.js ≥ 20，TypeScript，Vitest。
- `src/` 经 `tsc` 构建到 `dist/`；`dist/`、`scripts/`、`package-lock.json` 需要提交，直接 GitHub 安装依赖这些产物。
- 运行时代码只使用 Node/Bun 内置 `fetch`、WebCrypto 等能力，不随意增加运行时依赖。
- TypeScript 不使用 `any`；外部 JSON 用 `unknown` 和类型收窄处理。
- 异步 I/O 必须有错误反馈，不静默吞错；日志不得输出 AK/SK、Cookie、refresh token、Authorization 等敏感值。
- 不读取系统代理；检测到 `HTTP(S)_PROXY` 时固定 `NO_PROXY=*`。
- 不通过 SSH 登录或操作服务器；部署和线上操作由用户手动完成。

## 3. 关键目录与职责

| 文件 | 职责 |
| --- | --- |
| `src/proxy.ts` | 本地 HTTP 代理、请求归一化、签名转发、SSE 响应兜底、用量和状态接口 |
| `src/normalize.ts` | developer role、max tokens、tool_choice、reasoning_effort 归一化 |
| `src/anthropic-transform.ts` | Anthropic ↔ OpenAI 请求、响应、流式转换 |
| `src/gate.ts` | 并发上限、有界队列、冷却和取消 |
| `src/signing.ts` | SDK-HMAC-SHA256 签名，额外请求头也参与签名 |
| `src/credentials.ts` | 凭据解析顺序和掩码 |
| `src/config.ts` | 端点、端口、模型目录接口、默认参数、日志 |
| `src/builtin-models.ts` | 12 个内置模型的完整静态快照 |
| `src/models.ts` | 实时模型、快照、旧快照补全、用户模型合并 |
| `src/vision-routing.ts` | 文本模型遇新图片的视觉回落 |
| `src/http.ts` / `src/network-error.ts` | 直连 fetch、DNS/连接/超时/TLS 错误提示 |
| `src/oauth.ts` / `src/web-auth.ts` | TUI OAuth、web 凭据保存和刷新 |
| `src/plugin.ts` / `src/index.ts` | opencode V1/V2 插件入口 |
| `src/proxy-cli.ts` / `src/daemon.ts` | 独立代理和可选 supervisor |
| `scripts/` | systemd、launchd、Windows 自启动脚本 |
| `src/*.test.ts` | Vitest 单元与代理集成测试 |

## 4. 常用命令

```bash
npm install
npm run typecheck     # tsc --noEmit
npm test              # Vitest，当前 107 项
npm run build         # 更新 dist/
npm run start:proxy   # 直接启动代理
npm start             # 可选 supervisor
npm run print-provider
```

网页登录：

```bash
npm run login
```

> 早期的可选每日签到（Cookie 导入 + systemd timer）已在 1.1.1 移除：网页登录态
> 频繁失效，无法可靠自动执行。不要再把签到相关脚本、路由或 npm scripts 加回来。

## 5. 凭据与运行环境

凭据解析顺序：

1. 进程环境 `CODEARTS_CLI_AK` / `CODEARTS_CLI_SK`。
2. `CODEARTS_ENV_FILE` 指定文件。
3. 当前 shell profile（zsh/bash/fish/sh，按实际 `$SHELL` 适配）。
4. `web-auth.json` 中的 TUI 登录凭据（仅兜底）。

可选 `CODEARTS_CLI_SECURITY_TOKEN` 用于临时 STS 凭据。

- AK/SK 不落盘。
- web 登录凭据：`~/.config/opencode/opencode-codearts/web-auth.json`（0600）。
- `CODEARTS_DISABLE_PROFILE=1` 只关闭 profile 解析，不影响 web 登录兜底。

常用环境变量：

| 变量 | 默认 | 用途 |
| --- | --- | --- |
| `CODEARTS_PROXY_PORT` | `17228` | 本地端口 |
| `CODEARTS_MAX_CONCURRENCY` | `3` | 同时打到上游的 chat 数 |
| `CODEARTS_MAX_QUEUE` | `3` | 排队上限，0 为不排队 |
| `CODEARTS_QUEUE_COOLDOWN_SEC` | `1` | 排队冷却秒数 |
| `CODEARTS_ANTHROPIC_MODEL` | `glm-5.3-flash` | Anthropic 模型映射 |
| `CODEARTS_VISION_MODEL` | `glm-5.3-flash` | 视觉回落模型 |
| `CODEARTS_LOG_LEVEL` | `info` | `debug` 查看详细日志 |

## 6. 本地 API 表面

- `POST /v2/chat/completions`：OpenAI Chat Completions。
- 同时兼容裸路径、`/v1/chat/completions`、旧 `/api/v2/chat/completions`，客户端迁移时不要再次误删这些别名。
- `POST /anthropic/v1/messages`：Anthropic Messages。
- `GET /models`、`/v2/models`、`/models/<id>`：模型目录和单个模型完整元数据。
- `GET /usage`：积分用量，含 `amount`（已用）与 `remaining`（剩余）。
- `GET /status`、`GET /health`：状态和存活检查。
- `GET /login`、`GET /logout`：TUI web 登录与清除 web 凭据。

## 7. OpenAI 请求处理顺序

修改 `forwardChat` / `prepareOpenAIBody` 时保持以下语义：

1. 解析请求体，保留无法解析时的原始字节。
2. `developer` role → `system`。
3. `max_completion_tokens` → `max_tokens`。
4. `tool_choice` 对象 → 网关支持的枚举；强制工具时 `required` 并窄化 `tools`。
5. `reasoning_effort` 映射到 CodeArts 接受的 `low|high|max`。
6. **按模型 `limit.output` 截断 `max_tokens`**，避免 opencode 发 256000 被上游以 `InferHub.001001005.400` 拒绝。持久化模型缺少上限时，回退到内置目录。
7. 应用视觉回落。
8. 提取并校验会话 ID：
   - 优先请求头 `x-session-id`，也接受 `x-ot-session-id` / `user-session-id`；
   - opencode 没有合适请求头时，使用请求体 `prompt_cache_key`；
   - 最终映射为上游 `x-ot-session-id` 和 `user-session-id`，并通过 `extraHeaders` 纳入签名。
9. 进入并发闸门，再签名并直连上游。
10. 补齐 CodeArts CLI 风控/追踪头：`x-ot-trace-id`、`x-ot-span-id`、`x-snap-traceid`、
    `x-ot-session-id`、`x-ot-parent-session-id`、`user-session-id`、`x-session-affinity`、
    `x-ot-function: agent-tui`、`x-ot-client-type: CLI`、`x-ot-client-version: 26.11.11`、
    `plugin-name/version`、`ide-name/version`、`x-language`、`x-remote-origin-url`、
    `user-msg-id`、`x-message-id`、`created-time`、`model-id`、`model-name`。
    这些头必须参与签名；客户端没有 session 时使用进程级兜底 session。

## 8. 响应与 SSE 规则（高风险区域）

这些规则来自真实线上 bug，修改时必须保留并补测试。

### 8.1 reasoning-only 回填

openpangu 等模型可能把最终回答只写进 `reasoning_content`，`content` 为空，并带 `<|message_end|>`。

- 非流式：`content` 为空、`reasoning_content` 非空、无工具调用且 `finish_reason === "stop"` 时，把 reasoning 回填到 `content`。
- 流式：累计清理后的 content/reasoning，在 stop 结束且正文为空时，补一个正文 delta。
- 工具调用场景不要把 reasoning 错搬成正文。

### 8.2 控制符

- 从 content 和 reasoning 中清理 `<|message_end|>`。
- 不要让它进入客户端 UI 或后续历史。

### 8.3 缺失 finish_reason

- 上游在 `[DONE]` 或流结束前没有发 `finish_reason` 时，补 `stop`；已有工具调用则补 `tool_calls`。
- 这样避免 opencode 报 `OpenAI Chat stream ended without finish_reason` 并重试十次。

### 8.4 SSE 分帧

- 代理补出的正文块和 finish 块必须是**独立 SSE 事件**，以 `\n\n` 结束。
- 不得把两个 JSON 对象连续写进同一个 `data:` 事件；ZCode 会报 `Unexpected non-whitespace character after JSON`。
- 同时接受 CodeArts 的紧凑 `data:{...}` 与标准 `data: {...}`，以及两种 `[DONE]` 写法。
- 回归测试要逐事件拆分并 `JSON.parse`，不能只检查字符串包含关系。

### 8.5 上游 200 错误体

上游可能在 HTTP 200 的 SSE 中返回 `error_code` / `error_msg`。遇到空正文时先检查 `max_tokens`、tools 和原始错误体，不要仅凭 HTTP 200 判定成功。

## 9. 并发与会话语义

- 本地上限：3 并发、3 队列、1 秒冷却。
- 队列满：`429 codearts_queue_full`。
- 上游 `TM.00001041` / 并发会话上限：改写为 `429 codearts_concurrency_limit`。
- ZCode/opencode 的会话上下文由客户端通过 messages 携带；**切模型不等于客户端新建会话**。
- 如果代理不传上游会话 ID，连续切模型会被上游当成新会话，3 次后第 4 次 429。
- 同一会话必须复用上游 `x-ot-session-id` / `user-session-id`；不同会话仍受 3 会话额度限制。
- `/status`、`/models`、`/usage` 不占 chat 并发槽位。

## 10. 模型目录

- 内置 12 个模型，保留全部上游字段，包括 `model_desc`、`model_category`、`model_sku`、`provider`、`channel_source`、`credit`、`time_slots`、`intervals` 等。
- 优先实时 `/v1/model/builtin`，失败时使用静态目录和快照。
- 快照位置：`~/.config/opencode/opencode-codearts/models.json`。
- `ModelInfo.upstream` 不得丢弃原始字段；`limit.output` 同时用于 token 截断。

## 11. 插件与自启动

- V1 导出 `{ id, server }`，V2 导出 `{ id, setup }`。
- V2 provider 包使用 `@opencode/ai/providers/openai-compatible`；V1/独立 provider 配置保留 `@ai-sdk/openai-compatible`。
- 插件先探测 17228：已有 systemd/手动代理就复用；没有才在 opencode 进程内启动临时代理，进程退出即关闭。
- 主部署方式是 `opencode-codearts.service`（systemd user）。
- opencode 后台 service 的停用状态在 `~/.config/opencode/service.json`，不要误改 `opencode.json`。
- 不留下独立插件 daemon。

## 12. 开发流程

1. 先读 `package.json`、README、DESIGN 和相关实现，确认当前行为。
2. 修 bug 先复现并写回归测试；新增兼容行为先写失败用例。
3. 只做需求范围内的最小修改，不顺便重构，不引入未要求的新依赖。
4. 修改 `src/` 后必须执行：

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

5. `dist/` 变化要与源码一起提交。
6. 需要时重启服务并实测：

   ```bash
   systemctl --user restart opencode-codearts.service
   curl -s http://127.0.0.1:17228/status
   ```

7. 提交前检查 `git diff --check`、`git status` 和敏感信息。
- 不擅自提交、push、移动 tag 或创建 release；这些操作只在用户明确要求时执行。

## 13. 测试与实测要求

当前为 **107 项 Vitest 测试，12 个测试文件**。

除单元测试外，涉及客户端兼容时至少做以下实测：

- OpenAI 非流式与流式多轮，包含 assistant 历史。
- 工具调用、工具结果 follow-up。
- 同一上游会话连续切换 openpangu → glm → kimi → deepseek，确认无 429。
- openpangu reasoning-only 场景：正文非空、无 `<|message_end|>`、每个 SSE 事件可独立 JSON.parse。
- 大 `max_completion_tokens` 被截断到模型输出上限。
- opencode：基础对话、`shell` 工具调用、同会话多模型切换与上下文记忆。
- 12 模型矩阵：多轮、流式、工具调用和工具结果 follow-up。

实测结果要如实报告；provider 级测试与真实 UI 操作不要混为一谈。

## 14. 文档与发布

- 行为变化同步更新 `README.md` 和 `DESIGN.md`，测试数量保持准确。
- 常规发布流程：文档 → typecheck/test/build → commit → annotated tag → push main/tag → GitHub release。
- 重发同一版本只在用户明确要求时进行；不要擅自 force push 或移动 tag。
- 当前 `v1.1.1` 为 `/usage` 剩余额度版本；1.1.0 已包含 reasoning、finish、token、session 和 CLI 风控头修复。
- 修改仓库 Description/Topics 使用 `gh repo edit`，也属于外部写入，需用户明确要求。

## 15. 已知坑速查

| 现象 | 优先检查 |
| --- | --- |
| 思考区有回复、正文为空 | reasoning-only 回填是否生效，原始 SSE 是否含 `<|message_end|>` |
| 两个 JSON 拼接解析失败 | 补出的 SSE 块是否以 `\n\n` 分隔 |
| opencode 重试十次 | 上游是否漏发 `finish_reason` |
| 切 3 次模型后 429 | 是否转发 `x-session-id` 或 `prompt_cache_key` |
| `InferHub.001001005.400` | `max_tokens` 是否超过模型 `limit.output` |
| ZCode `/v1/chat/completions` 404 | 本地 base 应为 `/v2`，同时保留 `/v1` 等别名 |
| opencode 自动标题为空 | 已知轻微问题，不影响主对话和工具链 |
| 华为 TLS/连接异常 | 检查残留系统/KDE 代理，项目要求直连 |
| Anthropic 流解析失败 | 检查紧凑 `data:` 和 Anthropic 转换层，不要只改 OpenAI 路径 |

## 16. 完成定义（DoD）

- 回归测试覆盖问题，107 项或更新后的全部测试通过。
- typecheck/build 通过，`dist/` 同步。
- 文档、测试计数、故障排查说明同步。
- 服务已重启并完成必要的真实请求验证。
- 无敏感信息泄露，无无关文件改动。
- 未经用户明确要求，不提交、不推送、不发版。
