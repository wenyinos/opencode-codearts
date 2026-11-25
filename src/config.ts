// Centralised constants and defaults for the opencode-codearts plugin.
//
// CodeArts' model gateway is OpenAI-compatible, but every request must be
// signed with Huawei's SDK-HMAC-SHA256 scheme using a permanent AK/SK pair.
// The CLI reads that pair from CODEARTS_CLI_AK / CODEARTS_CLI_SK; this plugin
// does exactly the same and never performs a browser OAuth flow.

import { createRequire } from "node:module"
import os from "node:os"
import path from "node:path"
import { BUILTIN_MODELS } from "./builtin-models.js"

const require = createRequire(import.meta.url)
const packageJson = require("../package.json") as { version?: string }

/** Plugin version, read from package.json (also used in the User-Agent). */
export const PLUGIN_VERSION =
  typeof packageJson.version === "string" && packageJson.version ? packageJson.version : "0.0.0"

// ---------------------------------------------------------------------------
// Provider identity
// ---------------------------------------------------------------------------

/** Provider id in opencode config and in model ids (`codearts/<model>`). */
export const PROVIDER_ID = "codearts"

// Mirror the CodeArts CLI's risk-control/telemetry headers. Values observed
// from `codearts run --print-logs --log-level DEBUG` on CLI 26.11.21.
export const CODEARTS_CLIENT_TYPE = "CLI"
export const CODEARTS_CLIENT_VERSION = "26.11.21"
export const CODEARTS_CLIENT_FUNCTION = "agent-tui"
export const CODEARTS_ORIGIN_URL = "https://github.com/wenyinos/opencode-codearts"

/**
 * Placeholder apiKey. opencode requires *some* apiKey before it instantiates an
 * OpenAI-compatible provider; the real autentication is the signed request the
 * local proxy sends upstream. The sentinel is never forwarded.
 */
export const OAUTH_DUMMY_KEY = "opencode-oauth-dummy-key"

// ---------------------------------------------------------------------------
// CodeArts endpoints (fixed to Huawei Cloud cn-north-4, like the CLI)
// ---------------------------------------------------------------------------

export const CODEARTS_SNAP_BASE = "https://snap-access.cn-north-4.myhuaweicloud.com"

/** OpenAI-compatible Chat Completions base. */
export const CHAT_API_BASE = `${CODEARTS_SNAP_BASE}/api/v2`

/** Built-in model catalogue (signed GET, AK/SK works without a security token). */
export const MODEL_BUILTIN_URL = `${CODEARTS_SNAP_BASE}/v1/model/builtin`

/** Credit / package usage for the signed-in account. */
export const STATISTICS_URL = `${CODEARTS_SNAP_BASE}/snap-manager/v1/statistics/plugin`

/** Account identity (used by the optional status endpoint). */
export const CURRENT_USER_URL = `${CODEARTS_SNAP_BASE}/snap-manager/v1/current/user`

/**
 * Claude Code / Anthropic clients ask for Claude model ids. The proxy maps
 * those to a CodeArts model; override with CODEARTS_ANTHROPIC_MODEL.
 */
export const DEFAULT_ANTHROPIC_MODEL = "glm-5.3-flash"
export const ANTHROPIC_MODEL_ENV = "CODEARTS_ANTHROPIC_MODEL"

// ---------------------------------------------------------------------------
// Credentials (environment variables, exactly like the CodeArts CLI)
// ---------------------------------------------------------------------------

export const AK_ENV = "CODEARTS_CLI_AK"
export const SK_ENV = "CODEARTS_CLI_SK"
/** Optional: temporary credentials created through STS carry a security token. */
export const SECURITY_TOKEN_ENV = "CODEARTS_CLI_SECURITY_TOKEN"

// ---------------------------------------------------------------------------
// Local proxy
// ---------------------------------------------------------------------------

/**
 * Default port for the local proxy. Deliberately different from
 * opencode-deveco's 17128 so both plugins can run side by side.
 */
export const DEFAULT_PROXY_PORT = 17228
export const PROXY_HOST = "127.0.0.1"
export const PROXY_BASE_URL = `http://${PROXY_HOST}:${DEFAULT_PROXY_PORT}/v2`

/** Timeout for metadata requests (model list, usage, status). */
export const REQUEST_TIMEOUT_MS = 30_000

/** How long the upstream may stay silent before a streaming turn is aborted. */
export const UPSTREAM_IDLE_TIMEOUT_MS = 120_000

/** Resolve the proxy port from CODEARTS_PROXY_PORT, falling back to 17228. */
export function proxyPort(): number {
  const raw = Number(process.env.CODEARTS_PROXY_PORT)
  return Number.isInteger(raw) && raw > 0 && raw < 65_536 ? raw : DEFAULT_PROXY_PORT
}

// ---------------------------------------------------------------------------
// Upstream concurrency
// ---------------------------------------------------------------------------

/**
 * CodeArts allows 3 concurrent sessions per account; the fourth is rejected
 * with HTTP 400 `TM.00001041`. The proxy keeps chat turns at that limit by
 * default. Override with CODEARTS_MAX_CONCURRENCY.
 */
export const DEFAULT_MAX_CONCURRENCY = 3

/** How many requests may wait for a slot; beyond that the proxy answers 429. */
export const DEFAULT_MAX_QUEUE = 3

/** Seconds a queued turn waits before starting, so the gateway can free a slot. */
export const DEFAULT_QUEUE_COOLDOWN_SEC = 1

export function maxConcurrency(env: NodeJS.ProcessEnv = process.env): number {
  const raw = Number(env.CODEARTS_MAX_CONCURRENCY)
  return Number.isInteger(raw) && raw >= 1 ? raw : DEFAULT_MAX_CONCURRENCY
}

export function maxQueue(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEARTS_MAX_QUEUE
  if (raw === undefined || raw.trim() === "") return DEFAULT_MAX_QUEUE
  const n = Number(raw)
  return Number.isInteger(n) && n >= 0 ? n : DEFAULT_MAX_QUEUE
}

export function queueCooldownMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.CODEARTS_QUEUE_COOLDOWN_SEC
  if (raw === undefined || raw.trim() === "") return DEFAULT_QUEUE_COOLDOWN_SEC * 1000
  const sec = Number(raw)
  return Number.isFinite(sec) && sec >= 0
    ? Math.round(sec * 1000)
    : DEFAULT_QUEUE_COOLDOWN_SEC * 1000
}

// ---------------------------------------------------------------------------
// Model catalogue
// ---------------------------------------------------------------------------

export interface ModelLimit {
  context: number
  output: number
}

export interface ModelModalities {
  input: Array<"text" | "image">
  output: Array<"text">
}

export interface ModelInfo {
  name: string
  reasoning?: boolean
  tool_call?: boolean
  /** opencode's flag for image input; mirrors supports_images. */
  attachment?: boolean
  limit?: ModelLimit
  modalities?: ModelModalities
  /** The complete raw /v1/model/builtin record, untouched. */
  upstream?: Record<string, unknown>
  [key: string]: unknown
}

/** Build an opencode model entry from a raw builtin record. */
export function modelInfoFromBuiltin(raw: Record<string, unknown>): ModelInfo {
  const context = typeof raw.context_window === "number" ? raw.context_window : 0
  const output = typeof raw.max_tokens === "number" ? raw.max_tokens : 0
  const images = raw.supports_images === true
  const id = typeof raw.model_id === "string" ? raw.model_id : ""
  const rawName = typeof raw.model_name === "string" ? raw.model_name : ""
  return {
    name: rawName || id,
    tool_call: true,
    attachment: images,
    limit: { context, output },
    modalities: {
      input: images ? ["text", "image"] : ["text"],
      output: ["text"],
    },
    upstream: raw,
  }
}

/**
 * Cold-start catalogue, built from the full /v1/model/builtin snapshot in
 * builtin-models.ts. The live list replaces it whenever the proxy can reach the
 * gateway, but every upstream field is already present here.
 */
export const CATALOG: Record<string, ModelInfo> = Object.fromEntries(
  BUILTIN_MODELS.filter(
    (raw) =>
      raw.enable !== false &&
      raw.display_enabled !== false &&
      typeof raw.model_id === "string" &&
      raw.model_id !== "",
  ).map((raw) => [raw.model_id as string, modelInfoFromBuiltin(raw)]),
)

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** opencode's config directory, with the same override order opencode uses. */
export function opencodeConfigDir(): string {
  if (process.env.OPENCODE_CONFIG_DIR) return process.env.OPENCODE_CONFIG_DIR
  const base = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), ".config")
  return path.join(base, "opencode")
}

/** Directory for this plugin's own state (no credentials are stored here). */
export function pluginDataDir(): string {
  return path.join(opencodeConfigDir(), "opencode-codearts")
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

type LogLevel = "debug" | "info" | "warn" | "error"
const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

function currentLevel(): number {
  const raw = (process.env.CODEARTS_LOG_LEVEL ?? "info").toLowerCase()
  return LEVEL_ORDER[raw as LogLevel] ?? LEVEL_ORDER.info
}

function stringify(value: unknown): string {
  if (typeof value === "string") return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function format(level: LogLevel, args: unknown[]): string {
  return `[codearts][${level}] ${args.map(stringify).join(" ")}`
}

export const log = {
  debug(...args: unknown[]): void {
    if (currentLevel() <= LEVEL_ORDER.debug) process.stdout.write(format("debug", args) + "\n")
  },
  info(...args: unknown[]): void {
    if (currentLevel() <= LEVEL_ORDER.info) process.stdout.write(format("info", args) + "\n")
  },
  warn(...args: unknown[]): void {
    if (currentLevel() <= LEVEL_ORDER.warn) process.stderr.write(format("warn", args) + "\n")
  },
  error(...args: unknown[]): void {
    if (currentLevel() <= LEVEL_ORDER.error) process.stderr.write(format("error", args) + "\n")
  },
}
