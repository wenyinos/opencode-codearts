export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/**
 * Ensure fetch() goes direct. Called once when the plugin (or standalone
 * proxy) loads. NO_PROXY="*" is honoured by Bun; Node's fetch ignores proxy
 * environment variables unless NODE_USE_ENV_PROXY is set, so this is a no-op
 * there.
 */
export declare function installDirectNetworkPolicy(env?: NodeJS.ProcessEnv): void;
/** fetch() without an explicit proxy agent; used by every outgoing call. */
export declare const directFetch: Fetcher;
