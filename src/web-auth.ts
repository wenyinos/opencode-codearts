// Persist the CodeArts web login (OAuth credentials + optional web token).
//
// This is deliberately separate from the AK/SK path: model requests prefer
// CODEARTS_CLI_AK / CODEARTS_CLI_SK, while the web login is used as a fallback
// for the model API and as the login state for the daily benefit claim.
//
// File: ~/.config/opencode/opencode-codearts/web-auth.json (mode 0600).

import fs from "node:fs"
import path from "node:path"
import { log, pluginDataDir } from "./config.js"
import {
  openBrowser,
  refreshWebCredential,
  startOAuthFlow,
  type WebCredential,
} from "./oauth.js"

const WEB_AUTH_FILE = "web-auth.json"

export interface WebAuthState {
  credential: WebCredential
  saved_at: number
}

export interface WebAuthStatus {
  available: boolean
  expires_at?: string
  has_user_token: boolean
  has_refresh_token: boolean
  source: "web-auth" | "none"
}

export function webAuthFilePath(): string {
  return path.join(pluginDataDir(), WEB_AUTH_FILE)
}

function ensureDir(file: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
}

export function saveWebAuth(state: WebAuthState, file: string = webAuthFilePath()): boolean {
  try {
    ensureDir(file)
    const tmp = `${file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 })
    fs.renameSync(tmp, file)
    try {
      fs.chmodSync(file, 0o600)
    } catch {
      /* best effort */
    }
    return true
  } catch (err) {
    log.error("failed to save the web login", { error: String(err) })
    return false
  }
}

export function loadWebAuth(file: string = webAuthFilePath()): WebAuthState | null {
  try {
    if (!fs.existsSync(file)) return null
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as unknown
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null
    const root = parsed as Record<string, unknown>
    const credential = root.credential
    if (!credential || typeof credential !== "object" || Array.isArray(credential)) return null
    const cred = credential as Record<string, unknown>
    if (typeof cred.access_key_id !== "string" || !cred.access_key_id) return null
    return {
      credential: credential as WebCredential,
      saved_at: typeof root.saved_at === "number" ? root.saved_at : 0,
    }
  } catch {
    return null
  }
}

export function clearWebAuth(file: string = webAuthFilePath()): void {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* best effort */
  }
}

export function webAuthStatus(file: string = webAuthFilePath()): WebAuthStatus {
  const state = loadWebAuth(file)
  if (!state) {
    return { available: false, has_user_token: false, has_refresh_token: false, source: "none" }
  }
  return {
    available: true,
    expires_at: state.credential.expires_at || undefined,
    has_user_token: Boolean(state.credential.user_token),
    has_refresh_token: Boolean(state.credential.refresh_token),
    source: "web-auth",
  }
}

export function isWebCredentialExpired(credential: WebCredential, leadMs = 60_000): boolean {
  const expires = Date.parse(credential.expires_at || "")
  return Number.isFinite(expires) && expires <= Date.now() + leadMs
}

export interface StartedWebLogin {
  loginUrl: string
  /** Resolves with the saved credential once the browser callback completes. */
  result: Promise<WebCredential>
}

/**
 * Start a web login and return its URL immediately. The callback result is
 * persisted in the background; errors are logged and never escape.
 */
export async function startWebLogin(options: { open?: boolean } = {}): Promise<StartedWebLogin> {
  const flow = await startOAuthFlow()
  if (options.open !== false) openBrowser(flow.loginUrl)
  const result = flow.result
    .then(({ credential }) => {
      saveWebAuth({ credential, saved_at: Date.now() })
      log.info("CodeArts web login completed", {
        user: credential.user_name || credential.user_id || undefined,
        hasUserToken: Boolean(credential.user_token),
      })
      return credential
    })
    .catch((err) => {
      log.warn("CodeArts web login failed", { error: String(err) })
      throw err
    })
    .finally(() => {
      void flow.close()
    })
  result.catch(() => {})
  return { loginUrl: flow.loginUrl, result }
}

/** Run a complete login and return the credential (for the CLI). */
export async function loginWeb(options: { open?: boolean } = {}): Promise<WebCredential> {
  const started = await startWebLogin(options)
  return started.result
}

/**
 * Refresh the stored web login. Returns null when there is no refresh token or
 * the refresh failed (the caller can ask the user to log in again).
 */
export async function refreshWebLogin(): Promise<WebCredential | null> {
  const state = loadWebAuth()
  if (!state) return null
  try {
    const next = await refreshWebCredential(state.credential)
    saveWebAuth({ credential: next, saved_at: Date.now() })
    log.info("CodeArts web login refreshed")
    return next
  } catch (err) {
    log.warn("CodeArts web login refresh failed", { error: String(err) })
    return null
  }
}

/** The current web credential, refreshing it when it is about to expire. */
export async function currentWebCredential(): Promise<WebCredential | null> {
  const state = loadWebAuth()
  if (!state) return null
  if (!isWebCredentialExpired(state.credential)) return state.credential
  return refreshWebLogin()
}
