import type { Plugin } from "@opencode-ai/plugin";
import { type ModelInfo } from "./config.js";
/** Base URL opencode should use; follows CODEARTS_PROXY_PORT. */
export declare function proxyBaseUrl(): string;
/** The subset of the V2 provider/model records this plugin touches. */
export interface V2ProviderInfo {
    id: string;
    name: string;
    activation?: string;
    package: string;
    settings: Record<string, unknown>;
}
export interface V2ModelInfo {
    id: string;
    modelID: string;
    providerID: string;
    name: string;
    capabilities: {
        tools: boolean;
        input: string[];
        output: string[];
    };
    variants: unknown[];
    time: {
        released: number;
    };
    cost: unknown[];
    status: "active";
    enabled: boolean;
    limit: {
        context: number;
        output: number;
    };
}
export interface V2ProviderDraft {
    get(id: string): {
        provider: V2ProviderInfo;
        models: Map<string, V2ModelInfo>;
    } | undefined;
    add(record: {
        info: V2ProviderInfo;
        models: V2ModelInfo[];
    }): void;
}
export interface V2PluginContext {
    provider: {
        transform(callback: (draft: V2ProviderDraft) => void): Promise<unknown> | unknown;
    };
}
/** Convert one catalogue entry into the V2 model record the host expects. */
export declare function toV2Model(id: string, info: ModelInfo): V2ModelInfo;
/**
 * V2 setup: register the `codearts` provider in the host catalogue. The host
 * calls setup twice during activation (and on reload), so `add` is treated as
 * an upsert by the host.
 */
export declare function codeArtsSetup(ctx: V2PluginContext): Promise<void>;
/**
 * Merge the catalogue into opencode's config without stealing a user-owned
 * provider entry: the entry keeps its own api/baseURL/options, only the model
 * list is filled in (and a missing name/npm).
 */
export declare function applyConfigHook(cfg: {
    provider?: Record<string, unknown>;
    small_model?: string;
}): void;
export declare const CodeArtsPlugin: Plugin;
