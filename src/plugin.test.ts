import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import type { ModelInfo } from "./config.js"
import { persistModels } from "./models.js"
import { applyConfigHook, proxyBaseUrl } from "./plugin.js"

beforeEach(() => {
  process.env.OPENCODE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-plugin-"))
  delete process.env.CODEARTS_PROXY_PORT
})

describe("applyConfigHook", () => {
  it("injects the codearts provider pointing at the local proxy", () => {
    const cfg: { provider?: Record<string, unknown> } = {}
    applyConfigHook(cfg)

    const provider = cfg.provider!.codearts as Record<string, unknown>
    expect(provider).toMatchObject({
      name: "CodeArts",
      npm: "@ai-sdk/openai-compatible",
      api: "http://127.0.0.1:17228/v2",
      env: [],
    })
    const options = provider.options as Record<string, unknown>
    expect(options.apiKey).toBe("opencode-oauth-dummy-key")
    expect(options.baseURL).toBe("http://127.0.0.1:17228/v2")

    const models = provider.models as Record<string, ModelInfo>
    expect(Object.keys(models)).toHaveLength(12)
    expect(models["GLM-5.2"].limit).toEqual({ context: 202752, output: 65536 })
  })

  it("keeps a user-owned entry's api and options, merging only models", () => {
    const cfg = {
      provider: {
        codearts: {
          api: "http://example.test/v1",
          options: { apiKey: "user-key" },
          models: { "GLM-5.2": { name: "Mine" } },
        },
      },
    }
    applyConfigHook(cfg)

    const provider = cfg.provider.codearts as {
      api: string
      options: { apiKey: string }
      models: Record<string, ModelInfo>
    }
    expect(provider.api).toBe("http://example.test/v1")
    expect(provider.options.apiKey).toBe("user-key")
    expect(provider.models["GLM-5.2"].name).toBe("Mine")
    expect(provider.models["glm-5.3"]).toBeTruthy()
  })

  it("prefers the persisted live catalogue over the static snapshot", () => {
    persistModels({
      "new-live-model": {
        name: "New Live Model",
        tool_call: true,
        limit: { context: 123, output: 45 },
      },
    })
    const cfg: { provider?: Record<string, unknown> } = {}
    applyConfigHook(cfg)
    const models = (cfg.provider!.codearts as { models: Record<string, ModelInfo> }).models
    expect(models["new-live-model"]).toMatchObject({ name: "New Live Model" })
    expect(models["GLM-5.2"]).toBeUndefined()
  })

  it("follows CODEARTS_PROXY_PORT", () => {
    process.env.CODEARTS_PROXY_PORT = "18080"
    expect(proxyBaseUrl()).toBe("http://127.0.0.1:18080/v2")
    const cfg: { provider?: Record<string, unknown> } = {}
    applyConfigHook(cfg)
    expect((cfg.provider!.codearts as { api: string }).api).toBe(
      "http://127.0.0.1:18080/v2",
    )
  })
})
