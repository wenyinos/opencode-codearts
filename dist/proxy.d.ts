import { type Fetcher } from "./http.js";
/** Is this upstream error the account's 3-concurrent-session rejection? */
export declare function isConcurrencyLimit(bodyText: string): boolean;
/** Is this upstream error a prompt-too-long rejection? */
export declare function isContextLimit(bodyText: string): boolean;
/**
 * Normalize the local API prefix. `/v2` is the documented base (same as
 * opencode-deveco); bare paths and the legacy `/api/v2` / `/v1` prefixes used
 * by older client configs are accepted too.
 */
export declare function normalizeProxyPath(pathname: string): string;
export interface CodeArtsProxyOptions {
    port?: number;
    hostname?: string;
    /** Override only for tests; defaults to the real CodeArts API base. */
    upstreamBase?: string;
    /** Injectable fetch, used by tests to capture signed requests. */
    fetcher?: Fetcher;
    /** Injectable environment, used by tests. */
    env?: NodeJS.ProcessEnv;
    /** Concurrency gate overrides, used by tests. */
    maxConcurrency?: number;
    maxQueue?: number;
    queueCooldownMs?: number;
}
export declare class CodeArtsProxy {
    private readonly hostname;
    private port;
    private readonly upstreamBase;
    private readonly fetcher;
    private readonly env;
    private readonly gate;
    private server;
    constructor(options?: CodeArtsProxyOptions);
    start(): Promise<void>;
    stop(): Promise<void>;
    getPort(): number;
    private handle;
    private status;
    private models;
    /** One model, including every raw /v1/model/builtin field. */
    private modelRecord;
    private modelInfo;
    private usage;
    private forwardChat;
    /** Pick the CodeArts model for an Anthropic request. */
    private anthropicModel;
    private anthropicError;
    private forwardAnthropic;
    private copyResponseHeaders;
    private detachClientGone;
    private requireCredentials;
    private collectBody;
    private json;
}
