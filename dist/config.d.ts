/** Plugin version, read from package.json (also used in the User-Agent). */
export declare const PLUGIN_VERSION: string;
/** Provider id in opencode config and in model ids (`codearts/<model>`). */
export declare const PROVIDER_ID = "codearts";
export declare const CODEARTS_CLIENT_TYPE = "CLI";
export declare const CODEARTS_CLIENT_VERSION = "26.11.21";
export declare const CODEARTS_CLIENT_FUNCTION = "agent-tui";
export declare const CODEARTS_ORIGIN_URL = "https://github.com/wenyinos/opencode-codearts";
/**
 * Placeholder apiKey. opencode requires *some* apiKey before it instantiates an
 * OpenAI-compatible provider; the real autentication is the signed request the
 * local proxy sends upstream. The sentinel is never forwarded.
 */
export declare const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key";
export declare const CODEARTS_SNAP_BASE = "https://snap-access.cn-north-4.myhuaweicloud.com";
/** OpenAI-compatible Chat Completions base. */
export declare const CHAT_API_BASE = "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2";
/** Built-in model catalogue (signed GET, AK/SK works without a security token). */
export declare const MODEL_BUILTIN_URL = "https://snap-access.cn-north-4.myhuaweicloud.com/v1/model/builtin";
/** Credit / package usage for the signed-in account. */
export declare const STATISTICS_URL = "https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/statistics/plugin";
/** Account identity (used by the optional status endpoint). */
export declare const CURRENT_USER_URL = "https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/current/user";
/**
 * Claude Code / Anthropic clients ask for Claude model ids. The proxy maps
 * those to a CodeArts model; override with CODEARTS_ANTHROPIC_MODEL.
 */
export declare const DEFAULT_ANTHROPIC_MODEL = "glm-5.3-flash";
export declare const ANTHROPIC_MODEL_ENV = "CODEARTS_ANTHROPIC_MODEL";
export declare const AK_ENV = "CODEARTS_CLI_AK";
export declare const SK_ENV = "CODEARTS_CLI_SK";
/** Optional: temporary credentials created through STS carry a security token. */
export declare const SECURITY_TOKEN_ENV = "CODEARTS_CLI_SECURITY_TOKEN";
/**
 * Default port for the local proxy. Deliberately different from
 * opencode-deveco's 17128 so both plugins can run side by side.
 */
export declare const DEFAULT_PROXY_PORT = 17228;
export declare const PROXY_HOST = "127.0.0.1";
export declare const PROXY_BASE_URL = "http://127.0.0.1:17228/v2";
/** Timeout for metadata requests (model list, usage, status). */
export declare const REQUEST_TIMEOUT_MS = 30000;
/** How long the upstream may stay silent before a streaming turn is aborted. */
export declare const UPSTREAM_IDLE_TIMEOUT_MS = 120000;
/** Resolve the proxy port from CODEARTS_PROXY_PORT, falling back to 17228. */
export declare function proxyPort(): number;
/**
 * CodeArts allows 3 concurrent sessions per account; the fourth is rejected
 * with HTTP 400 `TM.00001041`. The proxy keeps chat turns at that limit by
 * default. Override with CODEARTS_MAX_CONCURRENCY.
 */
export declare const DEFAULT_MAX_CONCURRENCY = 3;
/** How many requests may wait for a slot; beyond that the proxy answers 429. */
export declare const DEFAULT_MAX_QUEUE = 3;
/** Seconds a queued turn waits before starting, so the gateway can free a slot. */
export declare const DEFAULT_QUEUE_COOLDOWN_SEC = 1;
export declare function maxConcurrency(env?: NodeJS.ProcessEnv): number;
export declare function maxQueue(env?: NodeJS.ProcessEnv): number;
export declare function queueCooldownMs(env?: NodeJS.ProcessEnv): number;
export interface ModelLimit {
    context: number;
    output: number;
}
export interface ModelModalities {
    input: Array<"text" | "image">;
    output: Array<"text">;
}
export interface ModelInfo {
    name: string;
    reasoning?: boolean;
    tool_call?: boolean;
    /** opencode's flag for image input; mirrors supports_images. */
    attachment?: boolean;
    limit?: ModelLimit;
    modalities?: ModelModalities;
    /** The complete raw /v1/model/builtin record, untouched. */
    upstream?: Record<string, unknown>;
    [key: string]: unknown;
}
/** Build an opencode model entry from a raw builtin record. */
export declare function modelInfoFromBuiltin(raw: Record<string, unknown>): ModelInfo;
/**
 * Cold-start catalogue, built from the full /v1/model/builtin snapshot in
 * builtin-models.ts. The live list replaces it whenever the proxy can reach the
 * gateway, but every upstream field is already present here.
 */
export declare const CATALOG: Record<string, ModelInfo>;
/** opencode's config directory, with the same override order opencode uses. */
export declare function opencodeConfigDir(): string;
/** Directory for this plugin's own state (no credentials are stored here). */
export declare function pluginDataDir(): string;
export declare const log: {
    debug(...args: unknown[]): void;
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
};
