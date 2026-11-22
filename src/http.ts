// Outgoing HTTP policy: CodeArts is always reached directly.
//
// The CodeArts CLI honours the OS/KDE proxy configuration, and in practice a
// stale local Clash-style proxy (127.0.0.1:7890) resets the TLS handshake to
// Huawei Cloud, so every request has to bypass it. This plugin never consults
// the OS proxy settings. Bun's fetch, however, reads HTTP(S)_PROXY from the
// environment, so when such a variable exists we pin NO_PROXY for this process.

import { log } from "./config.js"

export type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const PROXY_ENV_KEYS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "ALL_PROXY",
  "http_proxy",
  "https_proxy",
  "all_proxy",
] as const

/**
 * Ensure fetch() goes direct. Called once when the plugin (or standalone
 * proxy) loads. NO_PROXY="*" is honoured by Bun; Node's fetch ignores proxy
 * environment variables unless NODE_USE_ENV_PROXY is set, so this is a no-op
 * there.
 */
export function installDirectNetworkPolicy(env: NodeJS.ProcessEnv = process.env): void {
  const configured = PROXY_ENV_KEYS.filter((key) => (env[key] ?? "").trim() !== "")
  if (configured.length === 0) return
  env.NO_PROXY = "*"
  env.no_proxy = "*"
  log.warn(
    `proxy environment detected (${configured.join(", ")}); CodeArts uses a direct connection (NO_PROXY=*)`,
  )
}

/** fetch() without an explicit proxy agent; used by every outgoing call. */
export const directFetch: Fetcher = (input, init) => fetch(input, init)
