import fs from "node:fs"
import http from "node:http"
import type { AddressInfo } from "node:net"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { MODEL_BUILTIN_URL, STATISTICS_URL } from "./config.js"
import type { Fetcher } from "./http.js"
import { CodeArtsProxy, type CodeArtsProxyOptions } from "./proxy.js"

const ENV: NodeJS.ProcessEnv = {
  CODEARTS_CLI_AK: "AKIDEXAMPLE",
  CODEARTS_CLI_SK: "SECRET",
}

const BUILTIN = {
  count: 1,
  builtinModels: [
    {
      model_id: "GLM-5.2",
      model_name: "GLM-5.2",
      model_desc: "flagship",
      model_category: "文本生成",
      model_sku: null,
      provider: "internal",
      channel_source: "codearts",
      context_window: 202752,
      max_tokens: 65536,
      supports_images: false,
      enable: true,
      display_enabled: true,
      credit: [{ input_price: "8", output_price: "28", ratio_display: "0.7x" }],
      time_slots: { off_peak: { timezone: "Asia/Shanghai", duration: 11 } },
      intervals: [],
    },
  ],
}

const STATS = {
  package: { package_name_cn: "体验版" },
  metrics: [
    {
      name: "usageTotalPackageCredit",
      package_credit_amount: 14600,
      package_credit_used: 137.87,
      package_credit_remain: 14462.13,
    },
  ],
}

const closers: Array<() => Promise<void>> = []

afterEach(async () => {
  while (closers.length > 0) {
    const close = closers.pop()
    if (close) await close()
  }
})

beforeEach(() => {
  process.env.OPENCODE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-proxy-"))
})

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  return (server.address() as AddressInfo).port
}

async function closeServer(server: http.Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()))
}

async function startProxy(
  options: Omit<CodeArtsProxyOptions, "port">,
): Promise<CodeArtsProxy> {
  const proxy = new CodeArtsProxy({ port: 0, ...options })
  await proxy.start()
  closers.push(() => proxy.stop())
  return proxy
}

const baseOf = (proxy: CodeArtsProxy): string => `http://127.0.0.1:${proxy.getPort()}`

describe("CodeArtsProxy", () => {
  it("reports credential status without leaking the secret", async () => {
    const proxy = await startProxy({ env: ENV })
    const status = (await (await fetch(`${baseOf(proxy)}/status`)).json()) as Record<string, unknown>
    expect(status).toMatchObject({
      ok: true,
      provider: "codearts",
      configured: true,
      ak: "AKID****LE",
      missing: [],
    })
    expect(status.base_url).toBe(`${baseOf(proxy)}/api/v2`)
    expect(JSON.stringify(status)).not.toContain("SECRET")
  })

  it("reports missing credentials and refuses a chat request", async () => {
    const proxy = await startProxy({ env: {} })
    const status = (await (await fetch(`${baseOf(proxy)}/status`)).json()) as Record<string, unknown>
    expect(status.configured).toBe(false)
    expect(status.missing).toEqual(["CODEARTS_CLI_AK", "CODEARTS_CLI_SK"])

    const response = await fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    expect(response.status).toBe(401)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("codearts_missing_credentials")
  })

  it("has no web login", async () => {
    const proxy = await startProxy({ env: ENV })
    const response = await fetch(`${baseOf(proxy)}/login`, { redirect: "manual" })
    expect(response.status).toBe(410)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("codearts_env_credentials_required")
  })

  it("forwards a chat request with a valid signature", async () => {
    const captured: Array<{ headers: http.IncomingHttpHeaders; body: string }> = []
    const upstream = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      captured.push({ headers: req.headers, body: Buffer.concat(chunks).toString("utf8") })
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ id: "mock", object: "chat.completion", choices: [] }))
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
    })
    const response = await fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({
        model: "glm-5.3-flash",
        messages: [{ role: "user", content: "hi" }],
        stream: false,
      }),
    })

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: "mock" })
    expect(captured).toHaveLength(1)
    expect(captured[0].headers.authorization).toMatch(
      /^SDK-HMAC-SHA256 Access=AKIDEXAMPLE,/,
    )
    expect(captured[0].headers["x-sdk-date"]).toBeTruthy()
    expect(captured[0].headers["x-security-token"]).toBeUndefined()
    expect(captured[0].body).toContain("glm-5.3-flash")
  })

  it("serialises chat turns beyond the concurrency limit", async () => {
    let active = 0
    let maxActive = 0
    const upstream = http.createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* drain */
      }
      active++
      maxActive = Math.max(maxActive, active)
      await new Promise((resolve) => setTimeout(resolve, 60))
      active--
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ id: "mock", object: "chat.completion", choices: [] }))
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
      maxConcurrency: 1,
      maxQueue: 1,
      queueCooldownMs: 0,
    })
    const chat = (): Promise<Response> =>
      fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-5.3-flash", messages: [], stream: false }),
      })

    const first = chat()
    await new Promise((resolve) => setTimeout(resolve, 15))
    const second = chat()
    const responses = await Promise.all([first, second])

    expect(responses.map((r) => r.status)).toEqual([200, 200])
    expect(maxActive).toBe(1)
  })

  it("answers 429 when the queue is full", async () => {
    const upstream = http.createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* drain */
      }
      await new Promise((resolve) => setTimeout(resolve, 120))
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ id: "mock", choices: [] }))
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
      maxConcurrency: 1,
      maxQueue: 0,
      queueCooldownMs: 0,
    })
    const chat = (): Promise<Response> =>
      fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model: "glm-5.3-flash", messages: [], stream: false }),
      })

    const first = chat()
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = await chat()
    expect(second.status).toBe(429)
    const body = (await second.json()) as { error: { code: string } }
    expect(body.error.code).toBe("codearts_queue_full")
    expect(second.headers.get("retry-after")).toBe("1")
    expect((await first).status).toBe(200)
  })

  it("rewrites the upstream 3-session rejection to 429", async () => {
    const upstream = http.createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* drain */
      }
      res.writeHead(400, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          error_code: "TM.00001041",
          error_msg: "并发会话数已达上限(3个)，请关闭部分会话后重试。",
        }),
      )
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
      maxConcurrency: 3,
      maxQueue: 0,
      queueCooldownMs: 0,
    })
    const response = await fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "glm-5.3-flash", messages: [], stream: false }),
    })
    expect(response.status).toBe(429)
    const body = (await response.json()) as { error: { code: string } }
    expect(body.error.code).toBe("codearts_concurrency_limit")
  })

  it("serves non-streaming Anthropic Messages requests", async () => {
    const captured: Array<Record<string, unknown>> = []
    const upstream = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      captured.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(
        JSON.stringify({
          id: "chatcmpl",
          object: "chat.completion",
          model: "glm-5.3-flash",
          choices: [
            { index: 0, message: { role: "assistant", content: "hello from codearts" }, finish_reason: "stop" },
          ],
          usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 },
        }),
      )
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
    })
    const response = await fetch(`${baseOf(proxy)}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json", "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: "claude-sonnet-4-5",
        max_tokens: 64,
        messages: [{ role: "user", content: "hi" }],
      }),
    })

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      type: string
      model: string
      content: Array<{ type: string; text: string }>
      usage: { input_tokens: number; output_tokens: number }
    }
    expect(body.type).toBe("message")
    expect(body.model).toBe("glm-5.3-flash")
    expect(body.content[0]).toEqual({ type: "text", text: "hello from codearts" })
    expect(body.usage).toMatchObject({ input_tokens: 5, output_tokens: 3 })
    expect(captured[0].model).toBe("glm-5.3-flash")
  })

  it("serves streaming Anthropic Messages requests", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write(
        `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { role: "assistant", content: "hel" } }] })}\n\n`,
      )
      res.write(
        `data: ${JSON.stringify({ id: "x", choices: [{ index: 0, delta: { content: "lo" }, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 2 } })}\n\n`,
      )
      res.end("data: [DONE]\n\n")
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
    })
    const response = await fetch(`${baseOf(proxy)}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GLM-5.2",
        max_tokens: 64,
        stream: true,
        messages: [{ role: "user", content: "hi" }],
      }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const text = await response.text()
    expect(text).toContain('"type":"message_start"')
    expect(text).toContain('"text":"hel"')
    expect(text).toContain('"text":"lo"')
    expect(text).toContain('"type":"message_stop"')
  })

  it("returns Anthropic-shaped errors for missing credentials", async () => {
    const proxy = await startProxy({ env: {} })
    const response = await fetch(`${baseOf(proxy)}/anthropic/v1/messages`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    })
    expect(response.status).toBe(401)
    const body = (await response.json()) as {
      type: string
      error: { type: string; message: string }
    }
    expect(body.type).toBe("error")
    expect(body.error.type).toBe("authentication_error")
  })

  it("reroutes an image turn from a text-only model to the vision model", async () => {
    const captured: Array<Record<string, unknown>> = []
    const upstream = http.createServer(async (req, res) => {
      const chunks: Buffer[] = []
      for await (const chunk of req) chunks.push(Buffer.from(chunk))
      captured.push(JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>)
      res.writeHead(200, { "content-type": "application/json" })
      res.end(JSON.stringify({ id: "mock", choices: [] }))
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
    })
    const response = await fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: "GLM-5.2",
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "what is this" },
              { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } },
            ],
          },
        ],
        stream: false,
      }),
    })
    expect(response.status).toBe(200)
    expect(captured[0].model).toBe("glm-5.3-flash")
  })

  it("annotates a context-length rejection with the model's window", async () => {
    const upstream = http.createServer(async (req, res) => {
      for await (const _chunk of req) {
        /* drain */
      }
      res.writeHead(400, { "content-type": "application/json" })
      res.end(JSON.stringify({ error: { message: "maximum context length exceeded" } }))
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
    })
    const response = await fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ model: "GLM-5.2", messages: [], stream: false }),
    })
    expect(response.status).toBe(400)
    const body = (await response.json()) as { error: { code: string; message: string } }
    expect(body.error.code).toBe("codearts_context_limit")
    expect(body.error.message).toContain("202,752")
  })

  it("passes a streaming response through untouched", async () => {
    const upstream = http.createServer((_req, res) => {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write('data: {"choices":[{"delta":{"content":"A"}}]}\n\n')
      setTimeout(() => {
        res.write('data: {"choices":[{"delta":{"content":"B"}}]}\n\n')
        res.end("data: [DONE]\n\n")
      }, 10)
    })
    const upstreamPort = await listen(upstream)
    closers.push(() => closeServer(upstream))

    const proxy = await startProxy({
      env: ENV,
      upstreamBase: `http://127.0.0.1:${upstreamPort}/api/v2`,
    })
    const response = await fetch(`${baseOf(proxy)}/api/v2/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ model: "glm-5.3-flash", messages: [], stream: true }),
    })
    expect(response.status).toBe(200)
    expect(response.headers.get("content-type")).toContain("text/event-stream")
    const text = await response.text()
    expect(text).toContain('"A"')
    expect(text).toContain('"B"')
    expect(text).toContain("[DONE]")
  })

  it("serves the live model list when the signed fetch succeeds", async () => {
    const fetcher: Fetcher = async (input) => {
      if (String(input) === MODEL_BUILTIN_URL) {
        return new Response(JSON.stringify(BUILTIN), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response("unexpected", { status: 500 })
    }
    const proxy = await startProxy({ env: ENV, fetcher })
    const body = (await (await fetch(`${baseOf(proxy)}/models`)).json()) as {
      live: boolean
      data: Array<Record<string, unknown>>
    }
    expect(body.live).toBe(true)
    expect(body.data).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "GLM-5.2",
          name: "GLM-5.2",
          context_length: 202752,
          max_output_tokens: 65536,
          model_desc: "flagship",
          model_category: "文本生成",
          credit: expect.arrayContaining([
            expect.objectContaining({ input_price: "8", output_price: "28" }),
          ]),
          time_slots: expect.objectContaining({
            off_peak: expect.objectContaining({ duration: 11 }),
          }),
          upstream: expect.objectContaining({ model_id: "GLM-5.2" }),
        }),
      ]),
    )
  })

  it("serves one model with every upstream field", async () => {
    const proxy = await startProxy({ env: {} })
    const response = await fetch(`${baseOf(proxy)}/models/GLM-5.2`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    expect(body).toMatchObject({
      id: "GLM-5.2",
      name: "GLM-5.2",
      context_length: 202752,
      max_output_tokens: 65536,
      model_desc: expect.any(String),
      model_category: "文本生成",
    })
    expect(Array.isArray(body.credit)).toBe(true)
    expect(body.upstream).toMatchObject({ model_id: "GLM-5.2" })

    const missing = await fetch(`${baseOf(proxy)}/models/no-such-model`)
    expect(missing.status).toBe(404)
  })

  it("serves credit usage", async () => {
    const fetcher: Fetcher = async (input) => {
      if (String(input) === STATISTICS_URL) {
        return new Response(JSON.stringify(STATS), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      }
      return new Response("unexpected", { status: 500 })
    }
    const proxy = await startProxy({ env: ENV, fetcher })
    const body = (await (await fetch(`${baseOf(proxy)}/usage`)).json()) as {
      plan: string
      windows: Array<{ name: string }>
    }
    expect(body.plan).toBe("体验版")
    expect(body.windows[0].name).toBe("总积分")
  })
})
