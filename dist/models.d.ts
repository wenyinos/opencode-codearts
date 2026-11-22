import { type ModelInfo } from "./config.js";
import type { CodeArtsCredentials } from "./credentials.js";
import { type Fetcher } from "./http.js";
export interface RemoteModel {
    id: string;
    name: string;
    context: number;
    output: number;
    images: boolean;
    /** The complete raw /v1/model/builtin record, untouched. */
    upstream: Record<string, unknown>;
}
/** Drop the internal provider prefix the CLI uses (`huaweicloud-maas/...`). */
export declare function normalizeModelId(raw: unknown): string;
/** Parse the signed /v1/model/builtin answer into the models opencode offers. */
export declare function parseBuiltinModels(payload: unknown): RemoteModel[];
/** Fetch and parse the account's live model list. Throws on transport errors. */
export declare function fetchRemoteModels(credentials: CodeArtsCredentials, fetcher?: Fetcher): Promise<RemoteModel[]>;
/** Convert the remote list into opencode's provider-model shape. */
export declare function catalogFromRemote(models: RemoteModel[]): Record<string, ModelInfo>;
/**
 * Merge the catalogue with whatever the user configured: the catalogue supplies
 * metadata, an explicit user entry still wins field by field.
 */
export declare function mergeModels(catalog: Record<string, ModelInfo>, userModels: unknown): Record<string, ModelInfo>;
export declare function modelsFilePath(): string;
export declare function persistModels(models: Record<string, ModelInfo>, file?: string): boolean;
export declare function loadPersistedModels(file?: string): Record<string, ModelInfo> | null;
export declare function clearPersistedModels(file?: string): void;
/**
 * Fetch the live list and persist it. Used at plugin startup and by the proxy's
 * /models endpoint; failures keep the previous catalogue in place.
 */
export declare function refreshModelCatalog(credentials: CodeArtsCredentials, fetcher?: Fetcher): Promise<Record<string, ModelInfo> | null>;
