import { createECDH, createHash, randomBytes } from "node:crypto"
import { describe, expect, it } from "vitest"
import { sm4 } from "sm-crypto-v2"
import {
  decryptResponseStream,
  encryptChatBody,
  isEncryptedResponse,
  negotiateSessionKey,
  sessionKeyUsable,
  transportEncryptEnabled,
  type SessionKey,
} from "./transport-security.js"

const PATH = "/api/v2/chat/completions"

function sessionKey(): SessionKey {
  return {
    keyId: "key-test-1",
    key: new Uint8Array(randomBytes(16)),
    expiresAt: Date.now() + 3_600_000,
  }
}

function encryptedFrame(key: SessionKey, plain: string, index: number): string {
  const iv = new Uint8Array(randomBytes(12))
  const aad = new TextEncoder().encode(`${key.keyId}|${index}`)
  const result = sm4.encrypt(new TextEncoder().encode(plain), key.key, {
    mode: "gcm",
    output: "array",
    iv,
    associatedData: aad,
  })
  return [
    Buffer.from(iv).toString("base64"),
    Buffer.from(result.tag).toString("base64"),
    Buffer.from(result.output).toString("base64"),
  ].join(":")
}

describe("transport security", () => {
  it("reads the opt-in switch from the environment", () => {
    expect(transportEncryptEnabled({})).toBe(false)
    expect(transportEncryptEnabled({ CODEARTS_TRANSPORT_ENCRYPT: "0" })).toBe(false)
    expect(transportEncryptEnabled({ CODEARTS_TRANSPORT_ENCRYPT: "1" })).toBe(true)
    expect(transportEncryptEnabled({ CODEARTS_TRANSPORT_ENCRYPT: " TRUE " })).toBe(true)
  })

  it("treats keys within five minutes of expiry as unusable", () => {
    const now = Date.now()
    expect(sessionKeyUsable(null, now)).toBe(false)
    expect(sessionKeyUsable({ ...sessionKey(), expiresAt: now + 301_000 }, now)).toBe(true)
    expect(sessionKeyUsable({ ...sessionKey(), expiresAt: now + 299_000 }, now)).toBe(false)
  })

  it("encrypts a request body with the CLI's AAD layout", () => {
    const key = sessionKey()
    const encrypted = encryptChatBody('{"model":"glm-5.3-flash"}', key, "POST", PATH)
    expect(encrypted.headers["x-encrypt-algo"]).toBe("sm4-gcm")
    expect(encrypted.headers["x-encrypt-key-id"]).toBe(key.keyId)
    const iv = Buffer.from(encrypted.headers["x-encrypt-iv"], "base64")
    const tag = new Uint8Array(Buffer.from(encrypted.headers["x-encrypt-tag"], "base64"))
    const aad = new TextEncoder().encode(
      `POST|${PATH}|${encrypted.headers["x-encrypt-ts"]}`,
    )
    const plain = sm4.decrypt(new Uint8Array(Buffer.from(encrypted.body, "base64")), key.key, {
      mode: "gcm",
      output: "array",
      iv,
      associatedData: aad,
      tag,
    })
    expect(new TextDecoder().decode(plain)).toBe('{"model":"glm-5.3-flash"}')
  })

  it("negotiates a P-256 session key over a signed request", async () => {
    const server = createECDH("prime256v1")
    const serverPublicKey = server.generateKeys().toString("base64")
    let expected: Uint8Array | null = null
    let requestBody: Record<string, unknown> | null = null
    let requestHeaders: Headers | null = null

    const key = await negotiateSessionKey(
      { ak: "AKID", sk: "SECRET" },
      async (input, init) => {
        expect(String(input)).toBe(
          "http://127.0.0.1:19999/api/v1/security/key-exchange",
        )
        requestHeaders = new Headers(init?.headers)
        requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>
        const clientPublicKey = Buffer.from(String(requestBody.clientPublicKey), "base64")
        const shared = server.computeSecret(clientPublicKey)
        expected = new Uint8Array(createHash("sha256").update(shared).digest()).slice(0, 16)
        return new Response(
          JSON.stringify({ serverPublicKey, keyId: "k-9", expiresIn: 600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        )
      },
      "http://127.0.0.1:19999",
    )

    expect(requestHeaders!.get("authorization")).toMatch(
      /^SDK-HMAC-SHA256 Access=AKID,/,
    )
    expect(requestBody!.sessionId).toMatch(/^[0-9a-f]{32}$/)
    expect(typeof requestBody!.timestamp).toBe("number")
    expect(key.keyId).toBe("k-9")
    expect(key.expiresAt).toBeGreaterThan(Date.now() + 500_000)
    expect(Buffer.from(key.key).equals(Buffer.from(expected!))).toBe(true)
  })

  it("decrypts an encrypted SSE stream frame by frame", async () => {
    const key = sessionKey()
    const response = new Response(
      `${encryptedFrame(key, 'data: {"id":"a"}', 0)}\n\n${encryptedFrame(key, "data: [DONE]", 1)}\n\n`,
      {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-encrypt-algo": "sm4-gcm",
          "x-encrypt-key-id": key.keyId,
        },
      },
    )
    expect(isEncryptedResponse(response)).toBe(true)
    const decrypted = decryptResponseStream(response, key)
    expect(decrypted.headers.get("x-encrypt-algo")).toBeNull()
    expect(await decrypted.text()).toBe('data: {"id":"a"}\n\ndata: [DONE]\n\n')
  })

  it("leaves a plaintext response untouched", async () => {
    const response = new Response("data: [DONE]\n\n", {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })
    expect(isEncryptedResponse(response)).toBe(false)
  })
})
