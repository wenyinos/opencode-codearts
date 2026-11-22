// CodeArts TUI web login (OAuth 2.0 + PKCE + DPoP).
//
// Mirrors the login flow built into the CodeArts CLI:
//   portal authorize -> loopback callback -> STS /v1/oauth2/tokens
// and keeps the complete token response, including any web user token, so the
// same login can be used for the daily benefit claim.
//
// This module only performs the browser/OAuth handshake. Persistence lives in
// web-auth.ts; model requests still prefer CODEARTS_CLI_AK / CODEARTS_CLI_SK.

import { spawn } from "node:child_process"
import http from "node:http"

export const OAUTH_CLIENT_ID = "CodeArts_Tui"
export const OAUTH_REDIRECT_PATH = "/oauth/callback"
export const PORTAL_AUTHORIZE_BASE = "https://codearts.huaweicloud.com/portal/authorize"
export const PORTAL_LOGIN_BASE = "https://codearts.huaweicloud.com/portal/login"
export const STS_TOKEN_ENDPOINT = "https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens"
export const LEGACY_TICKET_ENDPOINT =
  "https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/login/ticket"
export const OAUTH_LOCALE = "zh-cn"

export const TOKEN_TIMEOUT_MS = 60_000
export const OAUTH_CALLBACK_TIMEOUT_MS = 180_000
export const MIN_CALLBACK_PORT = 10_000
export const LEGACY_POLL_ATTEMPTS = 60

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Requested-With",
  "Access-Control-Max-Age": "86400",
}

export interface DpopKeyPair {
  privateKeyJwk: JsonWebKey
  publicKeyJwk: JsonWebKey
}

/** The full credential persisted after a successful web login. */
export interface WebCredential {
  access_key_id: string
  secret_access_key: string
  security_token: string
  expires_at: string
  refresh_token?: string
  code_verifier?: string
  dpop_private_key_jwk?: JsonWebKey
  /** Web user token (X-Auth-Token) when the portal/STS returns one. */
  user_token?: string
  token_type?: string
  domain_id?: string
  user_id?: string
  user_name?: string
}

export interface OAuthFlow {
  loginUrl: string
  result: Promise<{ credential: WebCredential; loginUrl: string }>
  close: () => Promise<void>
}

type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

// ---------------------------------------------------------------------------
// WebCrypto helpers
// ---------------------------------------------------------------------------

function subtle(): SubtleCrypto {
  const crypto = globalThis.crypto
  if (!crypto?.subtle) throw new Error("CodeArts login: WebCrypto is unavailable")
  return crypto.subtle
}

const typed = (value: Uint8Array): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(value.byteLength)
  out.set(value)
  return out
}
const utf8 = (value: string): Uint8Array<ArrayBuffer> => typed(new TextEncoder().encode(value))

const hex = (bytes: Uint8Array): string =>
  Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("")

const randomBytes = (n: number): Uint8Array => {
  const out = new Uint8Array(n)
  crypto.getRandomValues(out)
  return out
}

const randomHex = (n: number): string => hex(randomBytes(n))

function b64url(bytes: Uint8Array): string {
  let text = ""
  for (const b of bytes) text += String.fromCharCode(b)
  return btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

function firstOf(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

/** PKCE pair: random verifier + S256 challenge. */
export async function generatePkcePair(): Promise<{
  codeVerifier: string
  codeChallenge: string
}> {
  const codeVerifier = b64url(randomBytes(48))
  const digest = await subtle().digest("SHA-256", utf8(codeVerifier))
  return { codeVerifier, codeChallenge: b64url(new Uint8Array(digest)) }
}

/** Fresh ES256 (P-256) DPoP key pair as JWKs. */
export async function generateDpopKeyPair(): Promise<DpopKeyPair> {
  const pair = await subtle().generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )
  const jwk = (await subtle().exportKey("jwk", pair.privateKey)) as JsonWebKey
  return {
    privateKeyJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d },
    publicKeyJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
  }
}

export function keyPairFromStoredJwk(jwk: JsonWebKey): DpopKeyPair {
  return {
    privateKeyJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y, d: jwk.d },
    publicKeyJwk: { kty: "EC", crv: "P-256", x: jwk.x, y: jwk.y },
  }
}

/** Sign a `dpop+jwt` proof (htm=method, htu=URL). */
export async function signDpopJws(
  keyPair: DpopKeyPair,
  htm: string,
  htu: string,
): Promise<string> {
  const header = { alg: "ES256", typ: "dpop+jwt", jwk: keyPair.publicKeyJwk }
  const payload = {
    htm,
    htu,
    iat: Math.floor(Date.now() / 1000),
    jti: randomHex(32),
  }
  const signingInput = `${b64url(utf8(JSON.stringify(header)))}.${b64url(
    utf8(JSON.stringify(payload)),
  )}`
  const key = await subtle().importKey(
    "jwk",
    keyPair.privateKeyJwk,
    { name: "ECDSA", namedCurve: "P-256" },
    false,
    ["sign"],
  )
  const signature = await subtle().sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    utf8(signingInput),
  )
  return `${signingInput}.${b64url(new Uint8Array(signature))}`
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

/** Normalize the STS token response into the persisted web credential. */
export function credentialFromTokenResponse(
  token: unknown,
  codeVerifier: string,
  keyPair: DpopKeyPair,
): WebCredential {
  const root = record(token)
  const credentials = record(root.credentials)
  const userToken = firstOf(
    root.access_token,
    root.user_token,
    root.id_token,
    root.token,
    credentials.user_token,
    credentials.access_token,
  )
  return {
    access_key_id: firstOf(credentials.access_key_id, credentials.accessKeyId),
    secret_access_key: firstOf(credentials.secret_access_key, credentials.secretAccessKey),
    security_token: firstOf(credentials.security_token, credentials.securityToken),
    expires_at: firstOf(credentials.expiration, credentials.expires_at, credentials.expiresAt),
    refresh_token: firstOf(root.refresh_token) || undefined,
    code_verifier: codeVerifier,
    dpop_private_key_jwk: keyPair.privateKeyJwk,
    user_token: userToken || undefined,
    token_type: firstOf(root.token_type) || undefined,
    domain_id: firstOf(root.domain_id) || undefined,
    user_id: firstOf(root.user_id) || undefined,
    user_name: firstOf(root.user_name) || undefined,
  }
}

/** POST the STS token endpoint with a DPoP proof. */
export async function requestToken(
  body: Record<string, string>,
  keyPair: DpopKeyPair,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  const dpop = await signDpopJws(keyPair, "POST", STS_TOKEN_ENDPOINT)
  let response: Response
  try {
    response = await fetcher(STS_TOKEN_ENDPOINT, {
      method: "POST",
      headers: {
        DPoP: dpop,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams(body).toString(),
      signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
    })
  } catch (err) {
    throw new Error(`CodeArts token request network error: ${String(err)}`)
  }

  let data: Record<string, unknown> | null = null
  try {
    data = record(await response.json())
  } catch {
    data = null
  }
  if (!response.ok || !data?.credentials) {
    const message = `CodeArts token request failed: ${response.status}${
      data ? ` ${JSON.stringify(data)}` : ""
    }`
    const errorCode = String(data?.error_code ?? "")
    if (data?.error === "invalid_grant" || errorCode.includes("ExpiredRefreshToken")) {
      throw Object.assign(new Error(message), { signIn: "expired" })
    }
    throw new Error(message)
  }
  return data
}

export function exchangeAuthorizationCode(
  code: string,
  codeVerifier: string,
  port: number,
  keyPair: DpopKeyPair,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  return requestToken(
    {
      client_id: OAUTH_CLIENT_ID,
      code,
      code_verifier: codeVerifier,
      grant_type: "authorization_code",
      redirect_uri: `http://127.0.0.1:${port}${OAUTH_REDIRECT_PATH}`,
    },
    keyPair,
    fetcher,
  )
}

export function exchangeRefreshToken(
  refreshToken: string,
  codeVerifier: string,
  keyPair: DpopKeyPair,
  fetcher: Fetcher = fetch,
): Promise<Record<string, unknown>> {
  return requestToken(
    {
      client_id: OAUTH_CLIENT_ID,
      code_verifier: codeVerifier,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    },
    keyPair,
    fetcher,
  )
}

/** Refresh a stored web credential, reusing its verifier + DPoP key. */
export async function refreshWebCredential(
  cred: WebCredential,
  fetcher: Fetcher = fetch,
): Promise<WebCredential> {
  if (!cred.refresh_token || !cred.code_verifier || !cred.dpop_private_key_jwk) {
    throw new Error("CodeArts login: cannot refresh without refresh_token/code_verifier/DPoP key")
  }
  const keyPair = keyPairFromStoredJwk(cred.dpop_private_key_jwk)
  const token = await exchangeRefreshToken(cred.refresh_token, cred.code_verifier, keyPair, fetcher)
  const next = credentialFromTokenResponse(token, cred.code_verifier, keyPair)
  if (!next.refresh_token) next.refresh_token = cred.refresh_token
  for (const key of ["domain_id", "user_id", "user_name"] as const) {
    if (cred[key] && !next[key]) next[key] = cred[key]
  }
  return next
}

// ---------------------------------------------------------------------------
// Login URL + loopback callback
// ---------------------------------------------------------------------------

export function buildOAuthLoginUrl(
  port: number,
  pkce: { codeChallenge: string },
  ticketId: string,
): string {
  const params = new URLSearchParams({
    locale: OAUTH_LOCALE,
    client_id: OAUTH_CLIENT_ID,
    port: String(port),
    code_challenge: pkce.codeChallenge,
    code_challenge_method: "SHA-256",
    ticket_id: ticketId,
  })
  return `${PORTAL_AUTHORIZE_BASE}?${params.toString()}`
}

const buildPortalLoginResultUrl = (ok: boolean): string =>
  `${PORTAL_LOGIN_BASE}?login_succeed=${ok}&uri_scheme=${OAUTH_CLIENT_ID}&locale=${OAUTH_LOCALE}`

/** Normalize a legacy ticket/credential response. */
export function parseLegacyCredential(data: unknown): WebCredential | null {
  const root = record(data)
  const cred = record(root.credential)
  const ak = firstOf(cred.access, cred.access_key_id, cred.accessKeyId)
  const st = firstOf(cred.securitytoken, cred.securityToken, cred.security_token)
  if (ak && st) {
    return {
      access_key_id: ak,
      secret_access_key: firstOf(cred.secret, cred.secret_access_key, cred.secretAccessKey),
      security_token: st,
      expires_at: firstOf(cred.expires_at, cred.expiresAt, cred.expiration),
      user_token:
        firstOf(root.user_token, root.userToken, cred.user_token, cred.userToken) || undefined,
      token_type: firstOf(root.token_type) || undefined,
      domain_id: firstOf(root.domain_id) || undefined,
      user_id: firstOf(root.user_id) || undefined,
      user_name: firstOf(root.user_name) || undefined,
    }
  }
  const result = record(root.result)
  const resultAk = firstOf(result.accessKeyId, result.access_key_id)
  const resultSt = firstOf(result.securityToken, result.security_token)
  if (resultAk && resultSt) {
    return {
      access_key_id: resultAk,
      secret_access_key: firstOf(result.secretAccessKey, result.secret_access_key),
      security_token: resultSt,
      expires_at: firstOf(result.expiration, result.expiresAt, result.expires_at),
      user_token:
        firstOf(root.user_token, root.userToken, result.user_token, result.userToken) ||
        undefined,
      token_type: firstOf(root.token_type) || undefined,
    }
  }
  return null
}

/** Poll the legacy ticket endpoint until a credential arrives. */
export async function pollForCredential(
  ticketId: string,
  secret: string,
  fetcher: Fetcher = fetch,
): Promise<WebCredential> {
  const url = `${LEGACY_TICKET_ENDPOINT}?ticket_id=${encodeURIComponent(
    ticketId,
  )}&secret=${encodeURIComponent(secret)}`
  for (let i = 0; i < LEGACY_POLL_ATTEMPTS; i++) {
    if (i > 0) await new Promise((resolve) => setTimeout(resolve, 1000))
    let response: Response
    try {
      response = await fetcher(url, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json;charset=UTF-8",
        },
        signal: AbortSignal.timeout(TOKEN_TIMEOUT_MS),
      })
    } catch {
      continue
    }
    if (!response.ok) continue
    let data: unknown
    try {
      data = await response.json()
    } catch {
      continue
    }
    const credential = parseLegacyCredential(data)
    if (credential) return credential
  }
  throw new Error("CodeArts login timed out")
}

/** Listen on 127.0.0.1, retrying with a random port >= 10000 if needed. */
function listenOnCallbackPort(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    const tryListen = (port: number): void => {
      server.once("error", reject)
      server.listen(port, "127.0.0.1", () => {
        const address = server.address()
        const assigned = typeof address === "object" && address ? address.port : 0
        if (assigned >= MIN_CALLBACK_PORT) {
          resolve(assigned)
          return
        }
        server.close(() => {
          tryListen(
            Math.floor(Math.random() * (65_536 - MIN_CALLBACK_PORT)) + MIN_CALLBACK_PORT,
          )
        })
      })
    }
    tryListen(0)
  })
}

/** Start the loopback callback server. */
async function startCallbackServer(
  ticketId: string,
  pkce: { codeVerifier: string; codeChallenge: string },
  keyPair: DpopKeyPair,
  fetcher: Fetcher,
): Promise<{
  port: number
  server: http.Server
  result: Promise<WebCredential>
}> {
  let resolveResult!: (credential: WebCredential) => void
  let rejectResult!: (error: unknown) => void
  const result = new Promise<WebCredential>((resolve, reject) => {
    resolveResult = resolve
    rejectResult = reject
  })

  const server = http.createServer((request, response) => {
    const url = new URL(request.url ?? "/", `http://127.0.0.1:${request.socket.localPort}`)
    if (url.pathname !== OAUTH_REDIRECT_PATH && !url.pathname.startsWith(OAUTH_REDIRECT_PATH)) {
      response.writeHead(404).end("Not found")
      return
    }
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS_HEADERS).end()
      return
    }

    const callbackSecret = url.searchParams.get("secret")
    if (callbackSecret) {
      const redirectTo = url.searchParams.get("redirect") ?? buildPortalLoginResultUrl(true)
      response.writeHead(307, { ...CORS_HEADERS, Location: redirectTo }).end()
      void pollForCredential(ticketId, callbackSecret, fetcher).then(resolveResult, rejectResult)
      return
    }

    const code = url.searchParams.get("code")
    if (code) {
      const port = request.socket.localPort ?? 0
      void exchangeAuthorizationCode(code, pkce.codeVerifier, port, keyPair, fetcher).then(
        (token) => {
          response
            .writeHead(307, { ...CORS_HEADERS, Location: buildPortalLoginResultUrl(true) })
            .end()
          resolveResult(credentialFromTokenResponse(token, pkce.codeVerifier, keyPair))
        },
        (error) => {
          response
            .writeHead(307, { ...CORS_HEADERS, Location: buildPortalLoginResultUrl(false) })
            .end()
          rejectResult(error)
        },
      )
      return
    }

    response.writeHead(400).end("Missing authorization code or secret")
  })

  const port = await listenOnCallbackPort(server)
  return { port, server, result }
}

/**
 * Start the web login flow. The caller can open `loginUrl` in a browser; the
 * result resolves after the loopback callback and STS exchange.
 */
export async function startOAuthFlow(fetcher: Fetcher = fetch): Promise<OAuthFlow> {
  const ticketId = randomHex(32)
  const pkce = await generatePkcePair()
  const keyPair = await generateDpopKeyPair()
  const { port, server, result } = await startCallbackServer(ticketId, pkce, keyPair, fetcher)
  const loginUrl = buildOAuthLoginUrl(port, pkce, ticketId)

  let closed = false
  const close = async (): Promise<void> => {
    if (closed) return
    closed = true
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  const resultWithUrl = Promise.race([
    result,
    new Promise<never>((_, reject) => {
      const timer = setTimeout(
        () => reject(new Error("CodeArts OAuth login timed out")),
        OAUTH_CALLBACK_TIMEOUT_MS,
      )
      timer.unref?.()
    }),
  ]).then((credential) => ({ credential, loginUrl }))

  resultWithUrl.catch(() => {}).finally(() => {
    void close()
  })

  return { loginUrl, result: resultWithUrl, close }
}

/** Open a URL in the user's browser; failures are non-fatal. */
export function openBrowser(url: string): boolean {
  try {
    const platform = process.platform
    const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open"
    const args = platform === "win32" ? ["/c", "start", "", url] : [url]
    const child = spawn(command, args, { detached: true, stdio: "ignore" })
    child.on("error", () => {})
    child.unref()
    return true
  } catch {
    return false
  }
}
