// Optional CodeArts transport security, mirroring CLI 26.11.21.
//
// The CLI negotiates a session key with the gateway (P-256 ECDH despite the
// "SM2" naming), encrypts `/api/v2/chat/completions` bodies with SM4-GCM and
// decrypts an encrypted SSE response. Requests stay signed plaintext when any
// step fails, and the gateway still accepts plaintext, so this layer is purely
// additive.
//
// Wire format observed from `codearts run --print-logs --log-level DEBUG`:
//   request  body : SM4-GCM ciphertext, AAD = `${METHOD}|${pathname}|${ts}`
//   request  head : x-encrypt-algo / key-id / iv / tag / ts (base64 iv+tag)
//   response body : SSE frames of `base64(iv):base64(ciphertext):base64(tag)`,
//                   AAD = `${keyId}|${frameIndex}`

import { createECDH, createHash, randomBytes } from "node:crypto"
import { sm4 } from "sm-crypto-v2"
import { log } from "./config.js"
import type { Fetcher } from "./http.js"
import { signRequestHuawei } from "./signing.js"

export const KEY_EXCHANGE_PATH = "/api/v1/security/key-exchange"
export const ENCRYPT_ALGO = "sm4-gcm"

const KEY_BYTES = 16
const IV_BYTES = 12
const KEY_REFRESH_MARGIN_MS = 5 * 60_000
const DEFAULT_KEY_TTL_MS = 60 * 60_000
const KEY_EXCHANGE_TIMEOUT_MS = 30_000
const SSE_SEPARATOR = "\n\n"

export interface TransportCredentials {
  ak: string
  sk: string
  securityToken?: string
}

export interface SessionKey {
  keyId: string
  key: Uint8Array
  expiresAt: number
}

/** Opt-in switch; plaintext remains the default. */
export function transportEncryptEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env.CODEARTS_TRANSPORT_ENCRYPT
  if (!raw) return false
  return ["1", "true", "yes", "on"].includes(raw.trim().toLowerCase())
}

/** Cached keys are refreshed five minutes before the server-side expiry. */
export function sessionKeyUsable(key: SessionKey | null, now: number = Date.now()): boolean {
  return Boolean(key && now < key.expiresAt - KEY_REFRESH_MARGIN_MS)
}

/**
 * One P-256 ECDH exchange; SHA-256 of the shared secret, truncated to 16 bytes,
 * is the SM4 key. Matches the CLI's `getOrNegotiateKey` request shape.
 */
export async function negotiateSessionKey(
  credentials: TransportCredentials,
  fetcher: Fetcher,
  baseUrl: string,
): Promise<SessionKey> {
  const ecdh = createECDH("prime256v1")
  const clientPublicKey = ecdh.generateKeys().toString("base64")
  const sessionId = randomBytes(16).toString("hex")
  const timestamp = Date.now()
  const body = JSON.stringify({ clientPublicKey, sessionId, timestamp })
  const url = `${baseUrl.replace(/\/+$/, "")}${KEY_EXCHANGE_PATH}`
  const signed = await signRequestHuawei({
    ak: credentials.ak,
    sk: credentials.sk,
    securityToken: credentials.securityToken,
    method: "POST",
    url,
    body: new TextEncoder().encode(body),
    extraHeaders: { "content-type": "application/json" },
  })
  const response = await fetcher(url, {
    method: "POST",
    headers: signed.headers,
    body,
    signal: AbortSignal.timeout(KEY_EXCHANGE_TIMEOUT_MS),
  })
  if (!response.ok) {
    throw new Error(`CodeArts key exchange failed: HTTP ${response.status}`)
  }
  const payload = (await response.json()) as Record<string, unknown>
  const serverPublicKey = typeof payload.serverPublicKey === "string" ? payload.serverPublicKey : ""
  const keyId = typeof payload.keyId === "string" ? payload.keyId : ""
  if (!serverPublicKey || !keyId) {
    throw new Error("CodeArts key exchange response missing serverPublicKey/keyId")
  }
  const shared = ecdh.computeSecret(Buffer.from(serverPublicKey, "base64"))
  const digest = new Uint8Array(createHash("sha256").update(shared).digest())
  const key = digest.slice(0, KEY_BYTES)
  const ttlSeconds =
    typeof payload.expiresIn === "number" && payload.expiresIn > 0
      ? payload.expiresIn
      : DEFAULT_KEY_TTL_MS / 1000
  return { keyId, key, expiresAt: Date.now() + ttlSeconds * 1000 }
}

/**
 * SM4-GCM encrypt one request body; AAD mirrors the CLI: method|path|timestamp.
 * The wire body is base64 text (the CLI sends `base64(ciphertext)`).
 */
export function encryptChatBody(
  body: string,
  key: SessionKey,
  method: string,
  pathname: string,
): { body: string; headers: Record<string, string> } {
  const timestamp = Date.now()
  const iv = new Uint8Array(randomBytes(IV_BYTES))
  const encoder = new TextEncoder()
  const aad = `${method.toUpperCase()}|${pathname}|${timestamp}`
  const result = sm4.encrypt(encoder.encode(body), key.key, {
    mode: "gcm",
    output: "array",
    iv,
    associatedData: encoder.encode(aad),
  })
  return {
    body: Buffer.from(result.output).toString("base64"),
    headers: {
      "x-encrypt-algo": ENCRYPT_ALGO,
      "x-encrypt-key-id": key.keyId,
      "x-encrypt-iv": Buffer.from(iv).toString("base64"),
      "x-encrypt-tag": Buffer.from(result.tag).toString("base64"),
      "x-encrypt-ts": String(timestamp),
    },
  }
}

function decryptFrame(frame: string, key: SessionKey, index: number): string {
  const parts = frame.split(":")
  if (parts.length !== 3) {
    throw new Error(`Invalid encrypted SSE frame: expected 3 fields, got ${parts.length}`)
  }
  // The CLI emits base64(iv):base64(tag):base64(ciphertext).
  const iv = Buffer.from(parts[0], "base64")
  const tag = new Uint8Array(Buffer.from(parts[1], "base64"))
  const ciphertext = new Uint8Array(Buffer.from(parts[2], "base64"))
  const aad = new TextEncoder().encode(`${key.keyId}|${index}`)
  const plain = sm4.decrypt(ciphertext, key.key, {
    mode: "gcm",
    output: "array",
    iv,
    associatedData: aad,
    tag,
  })
  return new TextDecoder().decode(plain)
}

/** Does this upstream response carry an SM4-GCM encrypted body? */
export function isEncryptedResponse(response: Response): boolean {
  return response.headers.get("x-encrypt-algo") === ENCRYPT_ALGO
}

/**
 * Wrap an encrypted upstream response in a plaintext stream. Frames are
 * authenticated individually; a bad frame fails the stream instead of yielding
 * corrupted SSE to the client.
 */
export function decryptResponseStream(response: Response, key: SessionKey): Response {
  const source = response.body
  if (!source) return response
  const reader = source.getReader()
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  let buffer = ""
  let index = 0
  const emit = (text: string): Uint8Array => encoder.encode(`${text}${SSE_SEPARATOR}`)
  const drain = (controller: ReadableStreamDefaultController<Uint8Array>): void => {
    let separator = buffer.indexOf(SSE_SEPARATOR)
    while (separator !== -1) {
      const frame = buffer.slice(0, separator).trim()
      buffer = buffer.slice(separator + SSE_SEPARATOR.length)
      if (frame) {
        controller.enqueue(emit(decryptFrame(frame, key, index)))
        index++
      }
      separator = buffer.indexOf(SSE_SEPARATOR)
    }
  }
  const stream = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          buffer += decoder.decode()
          drain(controller)
          const rest = buffer.trim()
          if (rest) {
            controller.enqueue(emit(decryptFrame(rest, key, index)))
            index++
          }
          controller.close()
          return
        }
        buffer += decoder.decode(value, { stream: true })
        drain(controller)
      } catch (err) {
        controller.error(err)
      }
    },
    cancel(reason) {
      void reader.cancel(reason)
    },
  })
  const headers = new Headers(response.headers)
  headers.delete("x-encrypt-algo")
  headers.delete("x-encrypt-key-id")
  log.debug("decrypting encrypted CodeArts response", {
    keyId: key.keyId,
    status: response.status,
  })
  return new Response(stream, {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}
