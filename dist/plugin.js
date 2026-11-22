// opencode plugin entry (hybrid architecture, same shape as opencode-deveco).
//
//   1. On load, start a local proxy that holds no secrets itself: it reads
//      CODEARTS_CLI_AK / CODEARTS_CLI_SK from the environment and signs every
//      upstream request.
//   2. The config hook injects a `codearts` provider whose baseURL points at
//      that proxy. opencode then sends ordinary OpenAI-style requests here.
//
// There is no `auth` hook: credentials are environment variables, exactly like
// the CodeArts CLI. No browser flow, no token file.
import { CATALOG, OAUTH_DUMMY_KEY, PLUGIN_VERSION, PROXY_HOST, PROVIDER_ID, log, proxyPort, } from "./config.js";
import { credentialStatus, resolveCredentials } from "./credentials.js";
import { installDirectNetworkPolicy } from "./http.js";
import { loadPersistedModels, mergeModels, refreshModelCatalog } from "./models.js";
import { CodeArtsProxy } from "./proxy.js";
/** Base URL opencode should use; follows CODEARTS_PROXY_PORT. */
export function proxyBaseUrl() {
    return `http://${PROXY_HOST}:${proxyPort()}/v2`;
}
/** Convert one catalogue entry into the V2 model record the host expects. */
export function toV2Model(id, info) {
    return {
        id,
        modelID: id,
        providerID: PROVIDER_ID,
        name: info.name,
        capabilities: {
            tools: info.tool_call !== false,
            input: info.modalities?.input ?? ["text"],
            output: ["text"],
        },
        variants: [],
        time: { released: 0 },
        cost: [],
        status: "active",
        enabled: true,
        limit: {
            context: info.limit?.context ?? 0,
            output: info.limit?.output ?? 0,
        },
    };
}
/**
 * V2 setup: register the `codearts` provider in the host catalogue. The host
 * calls setup twice during activation (and on reload), so `add` is treated as
 * an upsert by the host.
 */
export async function codeArtsSetup(ctx) {
    // V1 hosts also call default.setup, but with a V1-shaped context that has no
    // provider domain. V1 is served by the `server` export above.
    if (!ctx?.provider || typeof ctx.provider.transform !== "function")
        return;
    installDirectNetworkPolicy();
    void startProxy().catch(() => {
        /* logged in startProxy */
    });
    const resolved = resolveCredentials();
    if (resolved.credentials)
        void refreshModelCatalog(resolved.credentials);
    const catalog = loadPersistedModels() ?? CATALOG;
    const models = Object.entries(catalog).map(([id, info]) => toV2Model(id, info));
    const api = proxyBaseUrl();
    await ctx.provider.transform((draft) => {
        draft.add({
            info: {
                id: PROVIDER_ID,
                name: "CodeArts",
                activation: "auto",
                // The V2 supervisor expects a provider package exporting
                // `model(modelID, settings)`. The internal wrapper is what every
                // built-in OpenAI-compatible provider uses on this host.
                package: "@opencode/ai/providers/openai-compatible",
                settings: { baseURL: api, apiKey: OAUTH_DUMMY_KEY },
            },
            models,
        });
    });
    log.info(`registered ${PROVIDER_ID} with ${models.length} models at ${api}`);
}
/**
 * Merge the catalogue into opencode's config without stealing a user-owned
 * provider entry: the entry keeps its own api/baseURL/options, only the model
 * list is filled in (and a missing name/npm).
 */
export function applyConfigHook(cfg) {
    try {
        if (!cfg || typeof cfg !== "object")
            return;
        cfg.provider ??= {};
        const catalog = loadPersistedModels() ?? CATALOG;
        const api = proxyBaseUrl();
        const existing = cfg.provider[PROVIDER_ID];
        if (!existing) {
            cfg.provider[PROVIDER_ID] = {
                name: "CodeArts",
                npm: "@ai-sdk/openai-compatible",
                api,
                env: [],
                options: { apiKey: OAUTH_DUMMY_KEY, baseURL: api },
                models: { ...catalog },
            };
            return;
        }
        if (typeof existing === "object") {
            const entry = existing;
            entry.name ??= "CodeArts";
            entry.npm ??= "@ai-sdk/openai-compatible";
            entry.models = mergeModels({ ...catalog }, entry.models);
        }
    }
    catch (err) {
        log.error("config hook failed", { error: String(err) });
    }
}
// Proxy lifecycle — started once on plugin load.
let proxyStarted = null;
/** Is the process already listening on `port` our own CodeArts proxy? */
async function proxyIsOurs(port) {
    try {
        const response = await fetch(`http://${PROXY_HOST}:${port}/status`, {
            signal: AbortSignal.timeout(1_500),
        });
        if (!response.ok)
            return false;
        const body = (await response.json());
        return body.provider === PROVIDER_ID;
    }
    catch {
        return false;
    }
}
function startProxy() {
    if (!proxyStarted) {
        proxyStarted = (async () => {
            const port = proxyPort();
            const proxy = new CodeArtsProxy({ port, hostname: PROXY_HOST });
            try {
                await proxy.start();
                return proxy;
            }
            catch (err) {
                // Another opencode server may already own the port (a background
                // service plus a --standalone CLI, for instance). Sharing our own
                // proxy is harmless; failing the plugin is not.
                if (await proxyIsOurs(port)) {
                    log.info(`using the existing CodeArts proxy on ${PROXY_HOST}:${port}`);
                    return proxy;
                }
                throw err;
            }
        })().catch((err) => {
            proxyStarted = null; // allow a later request/load to retry
            log.error("failed to start the CodeArts proxy", { error: String(err) });
            throw err;
        });
    }
    return proxyStarted;
}
export const CodeArtsPlugin = async (_input) => {
    installDirectNetworkPolicy();
    log.info(`opencode-codearts ${PLUGIN_VERSION} loading`);
    const status = credentialStatus();
    log.info(status.configured
        ? `CodeArts AK/SK found (${status.akPreview}${status.source === "profile" ? ` from ${status.sourceFile}` : ""})`
        : `CodeArts AK/SK missing: ${status.missing.join(", ")}; requests will return 401 until they are set`);
    void startProxy().catch(() => {
        /* logged in startProxy */
    });
    // Refresh the catalogue in the background so the next start's picker shows
    // the account's current models. The static/persisted list covers this start.
    const resolved = resolveCredentials();
    if (resolved.credentials)
        void refreshModelCatalog(resolved.credentials);
    return {
        config: async (cfg) => applyConfigHook(cfg),
        dispose: async () => {
            const proxy = await proxyStarted?.catch(() => null);
            await proxy?.stop();
            proxyStarted = null;
        },
    };
};
