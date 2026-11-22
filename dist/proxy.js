// Local OpenAI-compatible proxy that bridges opencode to CodeArts.
//
// Why a proxy: the published opencode binary does not always load external
// plugins' auth hooks, so the plugin cannot inject a custom fetch. opencode
// talks to this proxy as if it were an OpenAI endpoint; the proxy reads the
// AK/SK environment variables, signs every request with SDK-HMAC-SHA256 and
// forwards it to CodeArts.
//
// Endpoints (all on http://127.0.0.1:17228 by default):
//   POST /v2/chat/completions     — signed forward (streaming passthrough)
//   GET  /models                   — live model list (or the cached catalogue)
//   GET  /usage                    — credit-package usage
//   GET  /status                   — { configured, ak, missing, ... }
//   GET  /health                   — liveness
//
// There is deliberately no /login: credentials come from CODEARTS_CLI_AK and
// CODEARTS_CLI_SK, exactly like the CodeArts CLI.
import http from "node:http";
import { ANTHROPIC_MODEL_ENV, CATALOG, CHAT_API_BASE, DEFAULT_ANTHROPIC_MODEL, PLUGIN_VERSION, PROXY_HOST, PROVIDER_ID, REQUEST_TIMEOUT_MS, STATISTICS_URL, UPSTREAM_IDLE_TIMEOUT_MS, log, maxConcurrency, maxQueue, proxyPort, queueCooldownMs, } from "./config.js";
import { anthropicToOpenaiChat, openaiChatStreamToAnthropic, openaiChatToAnthropic, } from "./anthropic-transform.js";
import { credentialStatus, resolveCredentials, } from "./credentials.js";
import { ConcurrencyGate } from "./gate.js";
import { directFetch, installDirectNetworkPolicy } from "./http.js";
import { catalogFromRemote, fetchRemoteModels, loadPersistedModels, persistModels, } from "./models.js";
import { describeNetworkError } from "./network-error.js";
import { normalizeOpenAIChatBody } from "./normalize.js";
import { claimDailyBenefit, readWebCookie } from "./signin.js";
import { signRequestHuawei } from "./signing.js";
import { clearWebAuth, currentWebCredential, startWebLogin, webAuthStatus, } from "./web-auth.js";
import { usageFromStatistics } from "./usage.js";
import { applyVisionRouting } from "./vision-routing.js";
const CREDENTIALS_DOC = "https://support.huaweicloud.com/usermanual-cli/codeartsagent_cli_0026.html";
const QUEUE_FULL_MESSAGE = "CodeArts 并发会话已满（默认最多 3 个），请稍后重试或关闭部分会话。";
const CONCURRENCY_LIMIT_PATTERNS = [
    /TM\.00001041/,
    /并发会话数已达上限/,
    /concurrent session limit/i,
];
/** Is this upstream error the account's 3-concurrent-session rejection? */
export function isConcurrencyLimit(bodyText) {
    return CONCURRENCY_LIMIT_PATTERNS.some((pattern) => pattern.test(bodyText));
}
const CONTEXT_LIMIT_PATTERNS = [
    /context length/i,
    /context window/i,
    /maximum context/i,
    /too many tokens/i,
    /input length/i,
    /OverLimitRequestBody/i,
];
/** Is this upstream error a prompt-too-long rejection? */
export function isContextLimit(bodyText) {
    return CONTEXT_LIMIT_PATTERNS.some((pattern) => pattern.test(bodyText));
}
/** A readable hint with the model's declared context window. */
function contextLimitHint(model) {
    const info = (loadPersistedModels() ?? CATALOG)[model];
    const limit = info?.limit?.context;
    return limit
        ? `CodeArts rejected the prompt as too long (model context: ${limit.toLocaleString("en-US")} tokens). Reduce the prompt and retry.`
        : "CodeArts rejected the prompt as too long. Reduce the prompt and retry.";
}
const MESSAGE_END = "<|message_end|>";
/** Remove CodeArts' raw end-of-message control token from model output. */
function stripMessageEnd(text) {
    return text.split(MESSAGE_END).join("");
}
/**
 * Some CodeArts models (notably openpangu-2.1-pro) occasionally put the final
 * answer in reasoning_content and leave content empty. Promote that text so
 * OpenAI clients still receive a reply instead of an empty message.
 */
function normalizeChatCompletionBody(text) {
    try {
        const json = JSON.parse(text);
        const choices = json.choices;
        if (Array.isArray(choices)) {
            for (const choice of choices) {
                if (!choice || typeof choice !== "object")
                    continue;
                const record = choice;
                const message = record.message;
                if (!message || typeof message !== "object")
                    continue;
                const msg = message;
                if (typeof msg.content === "string") {
                    msg.content = stripMessageEnd(msg.content);
                }
                if (typeof msg.reasoning_content === "string") {
                    msg.reasoning_content = stripMessageEnd(msg.reasoning_content);
                }
                const content = typeof msg.content === "string" ? msg.content : "";
                const reasoning = typeof msg.reasoning_content === "string" ? msg.reasoning_content : "";
                const tools = Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0;
                if (!content.trim() &&
                    reasoning.trim() &&
                    !tools &&
                    record.finish_reason === "stop") {
                    msg.content = reasoning;
                }
            }
        }
        return JSON.stringify(json);
    }
    catch {
        return text;
    }
}
/** Validate a client-supplied conversation/session id before using it upstream. */
function sanitizeSessionId(value) {
    if (typeof value !== "string")
        return "";
    const clean = value.trim();
    return /^[A-Za-z0-9._:-]{1,128}$/.test(clean) ? clean : "";
}
/** Map the client's conversation id to the upstream session headers. */
function clientSessionId(req) {
    const raw = req.headers["x-session-id"] ??
        req.headers["x-ot-session-id"] ??
        req.headers["user-session-id"];
    const value = Array.isArray(raw) ? raw[0] : raw;
    return sanitizeSessionId(value);
}
/**
 * Apply CodeArts-side request rewrites and the vision fallback. Keeps the
 * original bytes on a malformed body and reports the outbound model id.
 */
function prepareOpenAIBody(input) {
    try {
        const parsed = JSON.parse(new TextDecoder().decode(input));
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            return { body: input, model: "", sessionId: "" };
        }
        let current = parsed;
        let changed = false;
        const normalized = normalizeOpenAIChatBody(current);
        if (normalized.changed) {
            current = normalized.body;
            changed = true;
        }
        const routing = applyVisionRouting(current);
        if (routing) {
            current = routing.body;
            changed = true;
        }
        const model = typeof current.model === "string" ? current.model : "";
        const persisted = loadPersistedModels();
        const info = persisted?.[model] ?? CATALOG[model];
        const cap = info?.limit?.output ?? CATALOG[model]?.limit?.output;
        if (typeof current.max_tokens === "number" && cap && current.max_tokens > cap) {
            current = { ...current, max_tokens: cap };
            changed = true;
            log.debug("max_tokens capped to the model output limit", { model, cap });
        }
        return {
            body: changed ? new TextEncoder().encode(JSON.stringify(current)) : input,
            model,
            sessionId: sanitizeSessionId(current.prompt_cache_key),
        };
    }
    catch {
        return { body: input, model: "", sessionId: "" };
    }
}
/**
 * Normalize the local API prefix. `/v2` is the documented base (same as
 * opencode-deveco); bare paths and the legacy `/api/v2` / `/v1` prefixes used
 * by older client configs are accepted too.
 */
export function normalizeProxyPath(pathname) {
    const route = pathname
        .replace(/^\/api\/v2(?=\/|$)/, "")
        .replace(/^\/v2(?=\/|$)/, "")
        .replace(/^\/v1(?=\/|$)/, "");
    return route || "/";
}
/** Combine abort signals (AbortSignal.any is not available on every runtime). */
function mergeAbortSignals(...signals) {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            break;
        }
        signal.addEventListener("abort", () => controller.abort(signal.reason), { once: true });
    }
    return controller.signal;
}
export class CodeArtsProxy {
    hostname;
    port;
    upstreamBase;
    fetcher;
    env;
    gate;
    server = null;
    constructor(options = {}) {
        this.port = options.port ?? proxyPort();
        this.hostname = options.hostname ?? PROXY_HOST;
        this.upstreamBase = (options.upstreamBase ?? CHAT_API_BASE).replace(/\/$/, "");
        this.fetcher = options.fetcher ?? directFetch;
        this.env = options.env ?? process.env;
        this.gate = new ConcurrencyGate(options.maxConcurrency ?? maxConcurrency(this.env), options.queueCooldownMs ?? queueCooldownMs(this.env), options.maxQueue ?? maxQueue(this.env));
    }
    async start() {
        installDirectNetworkPolicy(this.env);
        // If there is no usable env/profile AK/SK, renew an expired web login in
        // the background so it stays a usable fallback for model requests.
        if (!resolveCredentials(this.env).credentials) {
            void currentWebCredential().catch(() => { });
        }
        const status = credentialStatus(this.env);
        if (status.configured) {
            log.info(`CodeArts credentials loaded (${status.akPreview})`);
        }
        else {
            log.warn(`CodeArts credentials missing: ${status.missing.join(", ")}`);
        }
        this.server = http.createServer((req, res) => {
            req.on("error", (err) => log.debug("request socket error", { error: String(err) }));
            res.on("error", (err) => log.debug("response socket error", { error: String(err) }));
            this.handle(req, res).catch((err) => {
                const message = err instanceof Error ? err.message : String(err);
                log.error("proxy request failed", { error: message });
                this.json(res, 500, { error: { message, type: "proxy_error" } });
            });
        });
        try {
            await new Promise((resolve, reject) => {
                this.server.once("error", reject);
                this.server.listen(this.port, this.hostname, () => resolve());
            });
        }
        catch (err) {
            const server = this.server;
            this.server = null;
            if (server)
                await new Promise((resolve) => server.close(() => resolve()));
            throw err;
        }
        const address = this.server.address();
        if (address && typeof address === "object")
            this.port = address.port;
        log.info(`opencode-codearts proxy listening on http://${this.hostname}:${this.port}`);
        log.info(`  chat:  POST /v2/chat/completions`);
        log.info(`  info:  GET  /status  /models  /usage`);
    }
    async stop() {
        const server = this.server;
        if (!server)
            return;
        this.server = null;
        await new Promise((resolve) => {
            const force = setTimeout(() => {
                log.warn("proxy shutdown timed out; closing remaining connections");
                server.closeAllConnections?.();
                resolve();
            }, 5_000);
            server.close(() => {
                clearTimeout(force);
                resolve();
            });
            server.closeIdleConnections?.();
        });
    }
    getPort() {
        return this.port;
    }
    // -------------------------------------------------------------------------
    // Routing
    // -------------------------------------------------------------------------
    async handle(req, res) {
        const url = new URL(req.url ?? "/", `http://${req.headers.host ?? `${this.hostname}:${this.port}`}`);
        const pathname = url.pathname;
        // Accept /v2/... (the documented base), bare /..., and the legacy
        // /api/v2/... and /v1/... prefixes used by older client configs.
        const route = normalizeProxyPath(pathname);
        if (route === "/" || route === "/health") {
            return this.json(res, 200, { ok: true, provider: PROVIDER_ID, version: PLUGIN_VERSION });
        }
        if (route === "/status")
            return this.status(res);
        if (route === "/models") {
            return this.models(res);
        }
        const modelPrefix = route.startsWith("/models/") ? "/models/" : null;
        if (modelPrefix) {
            let id;
            try {
                id = decodeURIComponent(route.slice(modelPrefix.length));
            }
            catch {
                return this.json(res, 400, {
                    error: { message: "invalid model id encoding", type: "invalid_request_error" },
                });
            }
            return this.modelInfo(res, id);
        }
        if (route === "/usage")
            return this.usage(res);
        if (route === "/login") {
            try {
                const started = await startWebLogin({ open: false });
                return this.json(res, 200, {
                    login_url: started.loginUrl,
                    instructions: "Open login_url in a browser. The proxy saves the credential when the callback completes; poll GET /status.",
                    status_url: "/status",
                });
            }
            catch (err) {
                return this.json(res, 502, {
                    error: {
                        message: `Could not start the CodeArts web login: ${err instanceof Error ? err.message : String(err)}`,
                        type: "login_error",
                    },
                });
            }
        }
        if (route === "/logout") {
            clearWebAuth();
            return this.json(res, 200, { ok: true });
        }
        if (route === "/signin") {
            const credential = await currentWebCredential();
            const result = await claimDailyBenefit({
                cookie: readWebCookie(this.env),
                credential,
                fetcher: this.fetcher,
                env: this.env,
            });
            const status = result.ok ? 200 : result.authExpired ? 401 : 502;
            return this.json(res, status, result);
        }
        if (route === "/anthropic/v1/messages" && req.method === "POST") {
            return this.forwardAnthropic(req, res);
        }
        if (route === "/chat/completions" && req.method === "POST") {
            return this.forwardChat(req, res);
        }
        return this.json(res, 404, {
            error: { message: `not found: ${req.method ?? "GET"} ${pathname}`, type: "not_found" },
        });
    }
    status(res) {
        const status = credentialStatus(this.env);
        const cached = loadPersistedModels() ?? CATALOG;
        this.json(res, 200, {
            ok: true,
            provider: PROVIDER_ID,
            version: PLUGIN_VERSION,
            configured: status.configured,
            ak: status.akPreview,
            source: status.source,
            source_file: status.sourceFile ?? null,
            missing: status.missing,
            base_url: `http://${this.hostname}:${this.port}/v2`,
            anthropic_base_url: `http://${this.hostname}:${this.port}/anthropic`,
            upstream: this.upstreamBase,
            models: Object.keys(cached).length,
            web_auth: webAuthStatus(),
            web_cookie: Boolean(readWebCookie(this.env)),
            doc: CREDENTIALS_DOC,
        });
    }
    async models(res) {
        const credentials = resolveCredentials(this.env).credentials;
        let catalog = loadPersistedModels() ?? CATALOG;
        let live = false;
        if (credentials) {
            try {
                const remote = await fetchRemoteModels(credentials, this.fetcher);
                if (remote.length > 0) {
                    catalog = catalogFromRemote(remote);
                    persistModels(catalog);
                    live = true;
                }
            }
            catch (err) {
                log.warn("live model list failed; serving the cached catalogue", {
                    error: String(err),
                });
            }
        }
        const data = Object.entries(catalog).map(([id, info]) => this.modelRecord(id, info));
        this.json(res, 200, { object: "list", data, live });
    }
    /** One model, including every raw /v1/model/builtin field. */
    modelRecord(id, info) {
        const upstream = info.upstream ?? CATALOG[id]?.upstream ?? {};
        return {
            ...upstream,
            id,
            object: "model",
            created: 0,
            owned_by: PROVIDER_ID,
            name: info.name,
            context_length: info.limit?.context ?? 0,
            max_output_tokens: info.limit?.output ?? 0,
            supports_images: info.modalities?.input?.includes("image") ?? false,
            upstream,
        };
    }
    modelInfo(res, id) {
        const catalog = loadPersistedModels() ?? CATALOG;
        const info = catalog[id];
        if (!info) {
            return this.json(res, 404, {
                error: { message: `unknown model: ${id}`, type: "not_found" },
            });
        }
        this.json(res, 200, this.modelRecord(id, info));
    }
    async usage(res) {
        const credentials = this.requireCredentials(res);
        if (!credentials)
            return;
        try {
            const signed = await signRequestHuawei({
                ak: credentials.ak,
                sk: credentials.sk,
                securityToken: credentials.securityToken,
                method: "GET",
                url: STATISTICS_URL,
                extraHeaders: {
                    "content-type": "application/json",
                    "agent-type": "PromptCenter",
                    "x-language": "zh-cn",
                },
            });
            const response = await this.fetcher(STATISTICS_URL, {
                headers: signed.headers,
                signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            });
            if (!response.ok) {
                return this.json(res, 502, {
                    error: {
                        message: `CodeArts usage request failed: HTTP ${response.status}`,
                        type: "upstream_error",
                    },
                });
            }
            this.json(res, 200, usageFromStatistics(await response.json()));
        }
        catch (err) {
            this.json(res, 502, {
                error: {
                    message: `CodeArts usage request failed: ${err instanceof Error ? err.message : String(err)}`,
                    type: "upstream_error",
                },
            });
        }
    }
    // -------------------------------------------------------------------------
    // Chat forwarding
    // -------------------------------------------------------------------------
    async forwardChat(req, res) {
        const credentials = this.requireCredentials(res);
        if (!credentials)
            return;
        const prepared = prepareOpenAIBody(await this.collectBody(req));
        const body = prepared.body;
        const target = `${this.upstreamBase}/chat/completions`;
        const model = prepared.model;
        // Arm the client-gone signal before queuing: a caller that hangs up while
        // waiting for a slot must not be admitted later.
        const clientGone = new AbortController();
        const onClientGone = () => clientGone.abort();
        res.on("close", onClientGone);
        req.on("aborted", onClientGone);
        const outcome = await this.gate.acquire(`chat ${model || "unknown"}`, clientGone.signal);
        if (outcome === "queue-full") {
            res.setHeader("retry-after", "1");
            this.json(res, 429, {
                error: {
                    message: QUEUE_FULL_MESSAGE,
                    code: "codearts_queue_full",
                    type: "rate_limit_error",
                },
            });
            this.detachClientGone(req, res, onClientGone);
            return;
        }
        if (outcome === "abandoned") {
            this.detachClientGone(req, res, onClientGone);
            return;
        }
        if (clientGone.signal.aborted) {
            this.gate.release();
            this.detachClientGone(req, res, onClientGone);
            return;
        }
        const idle = new AbortController();
        let idleTimer = null;
        const armIdle = () => {
            if (idleTimer)
                clearTimeout(idleTimer);
            idleTimer = setTimeout(() => idle.abort(new Error("upstream silent")), UPSTREAM_IDLE_TIMEOUT_MS);
            idleTimer.unref?.();
        };
        const signal = mergeAbortSignals(clientGone.signal, idle.signal);
        try {
            armIdle();
            // Sign after admission: a long queue wait must not age the signature.
            const sessionId = clientSessionId(req) || prepared.sessionId;
            const signed = await signRequestHuawei({
                ak: credentials.ak,
                sk: credentials.sk,
                securityToken: credentials.securityToken,
                method: "POST",
                url: target,
                body,
                extraHeaders: {
                    "content-type": "application/json",
                    ...(sessionId
                        ? { "x-ot-session-id": sessionId, "user-session-id": sessionId }
                        : {}),
                },
            });
            const headers = new Headers(signed.headers);
            const accept = req.headers.accept;
            if (typeof accept === "string" && accept)
                headers.set("accept", accept);
            headers.set("user-agent", `opencode-codearts/${PLUGIN_VERSION}`);
            let upstream;
            try {
                upstream = await this.fetcher(target, { method: "POST", headers, body, signal });
            }
            catch (err) {
                if (clientGone.signal.aborted)
                    return;
                if (!res.headersSent) {
                    const hint = describeNetworkError(err, target);
                    this.json(res, 502, {
                        error: {
                            message: hint ??
                                `CodeArts upstream request failed: ${err instanceof Error ? err.message : String(err)}`,
                            type: "upstream_error",
                        },
                    });
                }
                return;
            }
            if (!upstream.ok) {
                const text = await upstream.text();
                if (isConcurrencyLimit(text)) {
                    log.warn("upstream reports 3 concurrent sessions; returning 429 to the client");
                    this.json(res, 429, {
                        error: {
                            message: QUEUE_FULL_MESSAGE,
                            code: "codearts_concurrency_limit",
                            type: "rate_limit_error",
                        },
                    });
                    return;
                }
                if (isContextLimit(text)) {
                    this.json(res, upstream.status, {
                        error: {
                            message: `${text.slice(0, 500)}\n\n${contextLimitHint(model)}`,
                            code: "codearts_context_limit",
                            type: "invalid_request_error",
                        },
                    });
                    return;
                }
                res.statusCode = upstream.status;
                this.copyResponseHeaders(res, upstream);
                res.end(text);
                return;
            }
            res.statusCode = upstream.status;
            this.copyResponseHeaders(res, upstream);
            res.flushHeaders();
            if (!upstream.body) {
                res.end();
                return;
            }
            const contentType = upstream.headers.get("content-type") ?? "";
            if (!contentType.includes("text/event-stream")) {
                try {
                    res.end(normalizeChatCompletionBody(await upstream.text()));
                }
                catch (err) {
                    if (!clientGone.signal.aborted) {
                        log.warn("chat response ended early", {
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                    if (!res.writableEnded)
                        res.end();
                }
                return;
            }
            const state = {
                base: null,
                content: "",
                reasoning: "",
                toolCalls: false,
                fallback: false,
                sawFinish: false,
            };
            const shouldFallback = () => !state.fallback &&
                !state.content.trim() &&
                Boolean(state.reasoning.trim()) &&
                !state.toolCalls;
            const write = async (text) => {
                if (res.writableEnded || res.destroyed)
                    return;
                if (!res.write(text)) {
                    await new Promise((resolve) => {
                        res.once("drain", resolve);
                        res.once("close", resolve);
                    });
                }
            };
            const fallbackChunk = (finish) => {
                const chunk = {
                    ...(state.base ?? {}),
                    choices: [
                        {
                            index: 0,
                            delta: { content: state.reasoning },
                            finish_reason: finish,
                        },
                    ],
                };
                return `data: ${JSON.stringify(chunk)}\n\n`;
            };
            const finishChunk = (reason) => {
                const chunk = {
                    ...(state.base ?? {}),
                    choices: [{ index: 0, delta: {}, finish_reason: reason }],
                };
                return `data: ${JSON.stringify(chunk)}\n\n`;
            };
            const processData = async (line) => {
                const payload = line.slice(5).trimStart();
                if (payload.trim() === "[DONE]") {
                    if (!state.sawFinish) {
                        if (shouldFallback()) {
                            await write(fallbackChunk(null));
                            state.fallback = true;
                        }
                        await write(finishChunk(state.toolCalls ? "tool_calls" : "stop"));
                        state.sawFinish = true;
                    }
                    await write(`${line}\n`);
                    return;
                }
                let json;
                try {
                    json = JSON.parse(payload);
                }
                catch {
                    await write(`${line}\n`);
                    return;
                }
                state.base = json;
                const choices = json.choices;
                const choice = Array.isArray(choices) ? choices[0] : undefined;
                if (choice && typeof choice === "object") {
                    const record = choice;
                    const delta = record.delta;
                    if (delta && typeof delta === "object") {
                        const d = delta;
                        if (typeof d.reasoning_content === "string") {
                            const cleaned = stripMessageEnd(d.reasoning_content);
                            d.reasoning_content = cleaned;
                            state.reasoning += cleaned;
                        }
                        if (typeof d.content === "string") {
                            const cleaned = stripMessageEnd(d.content);
                            d.content = cleaned;
                            state.content += cleaned;
                        }
                        if (Array.isArray(d.tool_calls) && d.tool_calls.length > 0) {
                            state.toolCalls = true;
                        }
                    }
                    const finish = record.finish_reason;
                    if (typeof finish === "string" && finish) {
                        state.sawFinish = true;
                        if (finish === "stop" && shouldFallback()) {
                            await write(fallbackChunk(null));
                            state.fallback = true;
                        }
                    }
                }
                await write(`data: ${JSON.stringify(json)}\n`);
            };
            const reader = upstream.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            try {
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done)
                        break;
                    armIdle();
                    if (res.writableEnded || res.destroyed) {
                        idle.abort();
                        break;
                    }
                    buffer += decoder.decode(value, { stream: true });
                    const lines = buffer.split("\n");
                    buffer = lines.pop() ?? "";
                    for (const line of lines) {
                        if (line.startsWith("data:"))
                            await processData(line);
                        else
                            await write(`${line}\n`);
                    }
                }
                buffer += decoder.decode();
                if (buffer) {
                    if (buffer.startsWith("data:"))
                        await processData(buffer);
                    else
                        await write(buffer);
                }
                if (!state.sawFinish) {
                    if (shouldFallback()) {
                        await write(fallbackChunk(null));
                        state.fallback = true;
                    }
                    await write(finishChunk(state.toolCalls ? "tool_calls" : "stop"));
                    state.sawFinish = true;
                }
            }
            catch (err) {
                if (!clientGone.signal.aborted) {
                    log.warn("chat stream ended early", {
                        error: err instanceof Error ? err.message : String(err),
                    });
                }
            }
            finally {
                if (!res.writableEnded)
                    res.end();
            }
        }
        finally {
            if (idleTimer)
                clearTimeout(idleTimer);
            this.detachClientGone(req, res, onClientGone);
            this.gate.release();
        }
    }
    // -------------------------------------------------------------------------
    // Anthropic Messages compatibility (Claude Code and other Anthropic clients)
    // -------------------------------------------------------------------------
    /** Pick the CodeArts model for an Anthropic request. */
    anthropicModel(requested) {
        const catalog = loadPersistedModels() ?? CATALOG;
        const clean = requested.trim().replace(/^codearts\//, "");
        if (clean && catalog[clean])
            return clean;
        const configured = (this.env[ANTHROPIC_MODEL_ENV] ??
            process.env[ANTHROPIC_MODEL_ENV] ??
            "")
            .trim()
            .replace(/^codearts\//, "");
        return configured || DEFAULT_ANTHROPIC_MODEL;
    }
    anthropicError(res, status, type, message) {
        this.json(res, status, { type: "error", error: { type, message } });
    }
    async forwardAnthropic(req, res) {
        const credentials = resolveCredentials(this.env).credentials;
        if (!credentials) {
            this.anthropicError(res, 401, "authentication_error", "CodeArts 未配置 AK/SK。请设置 CODEARTS_CLI_AK / CODEARTS_CLI_SK。");
            return;
        }
        const raw = await this.collectBody(req);
        let anthropicReq;
        try {
            anthropicReq = JSON.parse(new TextDecoder().decode(raw));
        }
        catch {
            this.anthropicError(res, 400, "invalid_request_error", "Invalid JSON in request body");
            return;
        }
        const requestedModel = typeof anthropicReq.model === "string" ? anthropicReq.model : "";
        const upstreamModel = this.anthropicModel(requestedModel);
        const isStream = anthropicReq.stream === true;
        anthropicReq.model = upstreamModel;
        const openaiReq = anthropicToOpenaiChat(anthropicReq);
        const normalized = normalizeOpenAIChatBody(openaiReq);
        const routing = applyVisionRouting(normalized.body);
        const outbound = routing?.body ?? normalized.body;
        const body = new TextEncoder().encode(JSON.stringify(outbound));
        const target = `${this.upstreamBase}/chat/completions`;
        const clientGone = new AbortController();
        const onClientGone = () => clientGone.abort();
        res.on("close", onClientGone);
        req.on("aborted", onClientGone);
        const outcome = await this.gate.acquire(`anthropic ${requestedModel || upstreamModel}`, clientGone.signal);
        if (outcome === "queue-full") {
            res.setHeader("retry-after", "1");
            this.anthropicError(res, 429, "rate_limit_error", QUEUE_FULL_MESSAGE);
            this.detachClientGone(req, res, onClientGone);
            return;
        }
        if (outcome === "abandoned") {
            this.detachClientGone(req, res, onClientGone);
            return;
        }
        if (clientGone.signal.aborted) {
            this.gate.release();
            this.detachClientGone(req, res, onClientGone);
            return;
        }
        const idle = new AbortController();
        let idleTimer = null;
        const armIdle = () => {
            if (idleTimer)
                clearTimeout(idleTimer);
            idleTimer = setTimeout(() => idle.abort(new Error("upstream silent")), UPSTREAM_IDLE_TIMEOUT_MS);
            idleTimer.unref?.();
        };
        const signal = mergeAbortSignals(clientGone.signal, idle.signal);
        try {
            armIdle();
            const sessionId = clientSessionId(req);
            const signed = await signRequestHuawei({
                ak: credentials.ak,
                sk: credentials.sk,
                securityToken: credentials.securityToken,
                method: "POST",
                url: target,
                body,
                extraHeaders: {
                    "content-type": "application/json",
                    ...(sessionId
                        ? { "x-ot-session-id": sessionId, "user-session-id": sessionId }
                        : {}),
                },
            });
            const headers = new Headers(signed.headers);
            headers.set("accept", isStream ? "text/event-stream" : "application/json");
            headers.set("user-agent", `opencode-codearts/${PLUGIN_VERSION}`);
            const anthropicVersion = req.headers["anthropic-version"];
            if (typeof anthropicVersion === "string" && anthropicVersion) {
                headers.set("anthropic-version", anthropicVersion);
            }
            let upstream;
            try {
                upstream = await this.fetcher(target, { method: "POST", headers, body, signal });
            }
            catch (err) {
                if (clientGone.signal.aborted)
                    return;
                if (!res.headersSent) {
                    const hint = describeNetworkError(err, target);
                    this.anthropicError(res, 502, "api_error", hint ??
                        `CodeArts upstream request failed: ${err instanceof Error ? err.message : String(err)}`);
                }
                return;
            }
            if (!upstream.ok) {
                const text = await upstream.text();
                if (isConcurrencyLimit(text)) {
                    log.warn("anthropic upstream reports 3 concurrent sessions; returning 429");
                    this.anthropicError(res, 429, "rate_limit_error", QUEUE_FULL_MESSAGE);
                    return;
                }
                if (isContextLimit(text)) {
                    this.anthropicError(res, upstream.status, "invalid_request_error", `${text.slice(0, 500)}\n\n${contextLimitHint(upstreamModel)}`);
                    return;
                }
                const type = upstream.status === 401 || upstream.status === 403
                    ? "authentication_error"
                    : upstream.status === 400
                        ? "invalid_request_error"
                        : "api_error";
                this.anthropicError(res, upstream.status, type, `Upstream returned HTTP ${upstream.status}: ${text.slice(0, 500)}`);
                return;
            }
            if (isStream) {
                if (!upstream.body) {
                    this.anthropicError(res, 502, "api_error", "Upstream returned no body for stream");
                    return;
                }
                const stream = openaiChatStreamToAnthropic(upstream.body, requestedModel || upstreamModel, armIdle);
                res.writeHead(200, {
                    "content-type": "text/event-stream",
                    "cache-control": "no-cache",
                    connection: "keep-alive",
                });
                const reader = stream.getReader();
                try {
                    for (;;) {
                        const { done, value } = await reader.read();
                        if (done)
                            break;
                        armIdle();
                        if (res.writableEnded || res.destroyed) {
                            idle.abort();
                            break;
                        }
                        if (!res.write(Buffer.from(value))) {
                            await new Promise((resolve) => {
                                res.once("drain", resolve);
                                res.once("close", resolve);
                            });
                        }
                    }
                }
                catch (err) {
                    if (!clientGone.signal.aborted) {
                        log.warn("anthropic stream ended early", {
                            error: err instanceof Error ? err.message : String(err),
                        });
                    }
                }
                finally {
                    await reader.cancel().catch(() => { });
                    if (!res.writableEnded)
                        res.end();
                }
                return;
            }
            const openaiResponse = await upstream.json();
            const anthropicResponse = openaiChatToAnthropic(openaiResponse, requestedModel || upstreamModel);
            this.json(res, 200, anthropicResponse);
        }
        finally {
            if (idleTimer)
                clearTimeout(idleTimer);
            this.detachClientGone(req, res, onClientGone);
            this.gate.release();
        }
    }
    copyResponseHeaders(res, upstream) {
        const contentType = upstream.headers.get("content-type");
        if (contentType)
            res.setHeader("content-type", contentType);
        res.setHeader("cache-control", upstream.headers.get("cache-control") ?? "no-store");
        res.setHeader("x-codearts-upstream-status", String(upstream.status));
        const requestId = upstream.headers.get("x-request-id");
        if (requestId)
            res.setHeader("x-request-id", requestId);
    }
    detachClientGone(req, res, handler) {
        res.off("close", handler);
        req.off("aborted", handler);
    }
    // -------------------------------------------------------------------------
    // Helpers
    // -------------------------------------------------------------------------
    requireCredentials(res) {
        const credentials = resolveCredentials(this.env).credentials;
        if (credentials)
            return credentials;
        this.json(res, 401, {
            error: {
                message: "CodeArts 未配置 AK/SK。请设置环境变量 CODEARTS_CLI_AK 和 CODEARTS_CLI_SK，然后重启 opencode。",
                code: "codearts_missing_credentials",
                type: "authentication_error",
                doc: CREDENTIALS_DOC,
            },
        });
        return null;
    }
    async collectBody(req) {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const merged = Buffer.concat(chunks);
        const out = new Uint8Array(merged.byteLength);
        out.set(merged);
        return out;
    }
    json(res, status, body) {
        if (res.headersSent) {
            if (!res.writableEnded)
                res.end();
            return;
        }
        const payload = JSON.stringify(body);
        res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "content-length": Buffer.byteLength(payload),
            "cache-control": "no-store",
        });
        res.end(payload);
    }
}
