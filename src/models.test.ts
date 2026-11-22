import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { beforeEach, describe, expect, it } from "vitest"
import { MODEL_BUILTIN_URL, type ModelInfo } from "./config.js"
import {
  catalogFromRemote,
  fetchRemoteModels,
  loadPersistedModels,
  mergeModels,
  normalizeModelId,
  parseBuiltinModels,
  persistModels,
} from "./models.js"

const BUILTIN = {
  count: 3,
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
    {
      model_id: "glm-5.3-flash",
      model_name: "GLM-5.3-Flash",
      context_window: 1048576,
      max_tokens: 65536,
      supports_images: true,
      enable: true,
      display_enabled: true,
    },
    {
      model_id: "hidden",
      model_name: "Hidden",
      context_window: 1000,
      max_tokens: 100,
      enable: false,
    },
    {
      model_id: "GLM-5.2",
      model_name: "Duplicate",
      context_window: 1,
      max_tokens: 1,
      enable: true,
    },
  ],
}

describe("model catalogue", () => {
  beforeEach(() => {
    process.env.OPENCODE_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "codearts-models-"))
  })

  it("normalizes the CLI's provider prefix", () => {
    expect(normalizeModelId("huaweicloud-maas/GLM-5.2")).toBe("GLM-5.2")
    expect(normalizeModelId(" GLM-5.2 ")).toBe("GLM-5.2")
    expect(normalizeModelId(undefined)).toBe("")
  })

  it("parses enabled, de-duplicated models with limits and modalities", () => {
    const models = parseBuiltinModels(BUILTIN)
    expect(models).toHaveLength(2)
    expect(models[0]).toMatchObject({
      id: "GLM-5.2",
      name: "GLM-5.2",
      context: 202752,
      output: 65536,
      images: false,
    })
    expect(models[0].upstream).toMatchObject({
      model_id: "GLM-5.2",
      model_desc: "flagship",
      model_category: "文本生成",
      credit: [{ input_price: "8" }],
      time_slots: { off_peak: { duration: 11 } },
    })
    expect(models[1]).toMatchObject({ id: "glm-5.3-flash", images: true })
  })

  it("signs the builtin-model request and parses the answer", async () => {
    const seen: Headers[] = []
    const models = await fetchRemoteModels(
      { ak: "AKID", sk: "SECRET" },
      async (input, init) => {
        expect(String(input)).toBe(MODEL_BUILTIN_URL)
        seen.push(new Headers(init?.headers))
        return new Response(JSON.stringify(BUILTIN), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      },
    )
    expect(models).toHaveLength(2)
    expect(seen[0].get("authorization")).toMatch(/^SDK-HMAC-SHA256 Access=AKID,/)
    expect(seen[0].get("x-sdk-date")).toBeTruthy()
  })

  it("converts remote models into opencode's provider shape", () => {
    const catalog = catalogFromRemote(parseBuiltinModels(BUILTIN))
    expect(catalog["GLM-5.2"]).toMatchObject({
      name: "GLM-5.2",
      tool_call: true,
      attachment: false,
      limit: { context: 202752, output: 65536 },
      modalities: { input: ["text"], output: ["text"] },
    })
    expect(catalog["GLM-5.2"].upstream).toMatchObject({
      model_desc: "flagship",
      credit: [{ input_price: "8" }],
      time_slots: { off_peak: { duration: 11 } },
    })
    expect(catalog["glm-5.3-flash"].modalities?.input).toEqual(["text", "image"])
    expect(catalog["glm-5.3-flash"].attachment).toBe(true)
  })

  it("merges a user override field by field", () => {
    const catalog: Record<string, ModelInfo> = {
      "GLM-5.2": { name: "GLM-5.2", limit: { context: 1, output: 1 } },
    }
    const merged = mergeModels(catalog, {
      "GLM-5.2": { name: "Mine" },
      extra: { name: "Extra" },
    })
    expect(merged["GLM-5.2"]).toEqual({
      name: "Mine",
      limit: { context: 1, output: 1 },
    })
    expect(merged.extra).toEqual({ name: "Extra" })
  })

  it("persists and reloads the catalogue", () => {
    const file = path.join(process.env.OPENCODE_CONFIG_DIR!, "models.json")
    const catalog = catalogFromRemote(parseBuiltinModels(BUILTIN))
    expect(persistModels(catalog, file)).toBe(true)
    expect(loadPersistedModels(file)).toEqual(catalog)
  })

  it("fills missing upstream metadata from the static catalogue", () => {
    const file = path.join(process.env.OPENCODE_CONFIG_DIR!, "models.json")
    fs.writeFileSync(
      file,
      JSON.stringify({
        savedAt: 1,
        models: { "GLM-5.2": { name: "Stale", limit: { context: 1, output: 1 } } },
      }),
    )
    const loaded = loadPersistedModels(file)
    expect(loaded?.["GLM-5.2"]).toMatchObject({
      name: "Stale",
      limit: { context: 1, output: 1 },
      attachment: false,
    })
    expect(loaded?.["GLM-5.2"].upstream).toMatchObject({ model_id: "GLM-5.2" })
  })

  it("ignores a corrupt snapshot", () => {
    const file = path.join(process.env.OPENCODE_CONFIG_DIR!, "models.json")
    fs.writeFileSync(file, "{not json")
    expect(loadPersistedModels(file)).toBeNull()
  })
})
