// Model catalogue: the account's live list from /v1/model/builtin, a persisted
// snapshot for the next opencode start, and the static cold-start fallback.

import fs from "node:fs"
import path from "node:path"
import {
  CATALOG,
  MODEL_BUILTIN_URL,
  REQUEST_TIMEOUT_MS,
  type ModelInfo,
  log,
  modelInfoFromBuiltin,
  pluginDataDir,
} from "./config.js"
import type { CodeArtsCredentials } from "./credentials.js"
import { directFetch, type Fetcher } from "./http.js"
import { signRequestHuawei } from "./signing.js"

export interface RemoteModel {
  id: string
  name: string
  context: number
  output: number
  images: boolean
  /** The complete raw /v1/model/builtin record, untouched. */
  upstream: Record<string, unknown>
}

/** Drop the internal provider prefix the CLI uses (`huaweicloud-maas/...`). */
export function normalizeModelId(raw: unknown): string {
  if (typeof raw !== "string") return ""
  return raw.trim().replace(/^huaweicloud-maas\//, "")
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

/** Parse the signed /v1/model/builtin answer into the models opencode offers. */
export function parseBuiltinModels(payload: unknown): RemoteModel[] {
  const root = record(payload)
  const list = Array.isArray(root?.builtinModels) ? root.builtinModels : []
  const seen = new Set<string>()
  const models: RemoteModel[] = []

  for (const item of list) {
    const rec = record(item)
    if (!rec) continue
    if (rec.enable === false || rec.display_enabled === false) continue
    const id = normalizeModelId(rec.model_id)
    if (!id || seen.has(id)) continue
    seen.add(id)
    models.push({
      id,
      name: normalizeModelId(rec.model_name) || id,
      context: num(rec.context_window),
      output: num(rec.max_tokens),
      images: rec.supports_images === true,
      upstream: rec,
    })
  }
  return models
}

/** Fetch and parse the account's live model list. Throws on transport errors. */
export async function fetchRemoteModels(
  credentials: CodeArtsCredentials,
  fetcher: Fetcher = directFetch,
): Promise<RemoteModel[]> {
  const signed = await signRequestHuawei({
    ak: credentials.ak,
    sk: credentials.sk,
    securityToken: credentials.securityToken,
    method: "GET",
    url: MODEL_BUILTIN_URL,
    extraHeaders: {
      "content-type": "application/json",
      "agent-type": "PromptCenter",
      "x-language": "zh-cn",
    },
  })
  const response = await fetcher(MODEL_BUILTIN_URL, {
    headers: signed.headers,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`CodeArts model list failed: HTTP ${response.status}`)
  }
  return parseBuiltinModels(await response.json())
}

/** Convert the remote list into opencode's provider-model shape. */
export function catalogFromRemote(models: RemoteModel[]): Record<string, ModelInfo> {
  const catalog: Record<string, ModelInfo> = {}
  for (const model of models) {
    // Keep every upstream field; only the exposed name/limits/modalities are
    // normalised in case the gateway returns a prefixed id or dated name.
    catalog[model.id] = {
      ...modelInfoFromBuiltin(model.upstream),
      name: model.name,
      attachment: model.images,
      limit: { context: model.context, output: model.output },
      modalities: {
        input: model.images ? ["text", "image"] : ["text"],
        output: ["text"],
      },
      upstream: model.upstream,
    }
  }
  return catalog
}

/**
 * Merge the catalogue with whatever the user configured: the catalogue supplies
 * metadata, an explicit user entry still wins field by field.
 */
export function mergeModels(
  catalog: Record<string, ModelInfo>,
  userModels: unknown,
): Record<string, ModelInfo> {
  const merged: Record<string, ModelInfo> = { ...catalog }
  if (!userModels || typeof userModels !== "object") return merged
  for (const [id, userModel] of Object.entries(userModels as Record<string, unknown>)) {
    const base = merged[id]
    merged[id] =
      base && userModel && typeof userModel === "object"
        ? { ...base, ...(userModel as ModelInfo) }
        : (userModel as ModelInfo)
  }
  return merged
}

// ---------------------------------------------------------------------------
// Persisted snapshot (lets the next opencode start use the live list)
// ---------------------------------------------------------------------------

export function modelsFilePath(): string {
  return path.join(pluginDataDir(), "models.json")
}

interface PersistedShape {
  savedAt?: number
  models?: unknown
}

export function persistModels(
  models: Record<string, ModelInfo>,
  file: string = modelsFilePath(),
): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const payload = JSON.stringify({ savedAt: Date.now(), models }, null, 2)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, payload)
    fs.renameSync(tmp, file)
    return true
  } catch (err) {
    log.warn("failed to persist the model catalogue", { error: String(err) })
    return false
  }
}

export function loadPersistedModels(file: string = modelsFilePath()): Record<string, ModelInfo> | null {
  try {
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as PersistedShape
    const models = record(parsed?.models)
    if (!models) return null
    const valid: Record<string, ModelInfo> = {}
    for (const [id, value] of Object.entries(models)) {
      const info = record(value)
      if (!info) continue
      // Snapshots written by older versions lack the raw upstream metadata;
      // fill it (and any other missing defaults) from the static catalogue so
      // /models and print-provider always expose every field.
      const base = CATALOG[id]
      valid[id] = {
        ...(base ?? {}),
        ...(info as ModelInfo),
        name: typeof info.name === "string" && info.name ? info.name : id,
        upstream: (info.upstream as Record<string, unknown> | undefined) ?? base?.upstream,
      }
    }
    return Object.keys(valid).length > 0 ? valid : null
  } catch {
    return null
  }
}

export function clearPersistedModels(file: string = modelsFilePath()): void {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* best effort */
  }
}

/**
 * Fetch the live list and persist it. Used at plugin startup and by the proxy's
 * /models endpoint; failures keep the previous catalogue in place.
 */
export async function refreshModelCatalog(
  credentials: CodeArtsCredentials,
  fetcher: Fetcher = directFetch,
): Promise<Record<string, ModelInfo> | null> {
  try {
    const remote = await fetchRemoteModels(credentials, fetcher)
    if (remote.length === 0) return null
    const catalog = catalogFromRemote(remote)
    persistModels(catalog)
    return catalog
  } catch (err) {
    log.warn("model catalogue refresh failed", { error: String(err) })
    return null
  }
}
