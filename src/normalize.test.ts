import { describe, expect, it } from "vitest"
import {
  normalizeOpenAIChatBody,
  normalizeOpenAIDeveloperRole,
  normalizeOpenAIMaxTokens,
  normalizeOpenAIReasoningEffort,
  normalizeOpenAIToolChoice,
} from "./normalize.js"

describe("normalizeOpenAIToolChoice", () => {
  it("collapses enum-shaped objects to strings", () => {
    expect(normalizeOpenAIToolChoice({ tool_choice: { type: "auto" } })).toEqual({
      body: { tool_choice: "auto" },
      changed: true,
    })
  })

  it("turns a forced tool into required + narrowed tools", () => {
    const tools = [
      { type: "function", function: { name: "a" } },
      { type: "function", function: { name: "b" } },
    ]
    expect(
      normalizeOpenAIToolChoice({
        tools,
        tool_choice: { type: "function", function: { name: "b" } },
      }),
    ).toEqual({
      body: { tool_choice: "required", tools: [tools[1]] },
      changed: true,
    })
  })

  it("falls back to auto when the forced tool is not declared", () => {
    expect(
      normalizeOpenAIToolChoice({ tools: [], tool_choice: { type: "function", function: { name: "x" } } }),
    ).toEqual({ body: { tool_choice: "auto", tools: [] }, changed: true })
  })

  it("drops an invalid value", () => {
    expect(normalizeOpenAIToolChoice({ tool_choice: 42 })).toEqual({
      body: {},
      changed: true,
    })
  })
})

describe("normalizeOpenAIDeveloperRole", () => {
  it("downgrades developer messages to system", () => {
    expect(
      normalizeOpenAIDeveloperRole({
        messages: [{ role: "developer", content: "x" }, { role: "user", content: "y" }],
      }),
    ).toEqual({
      body: {
        messages: [{ role: "system", content: "x" }, { role: "user", content: "y" }],
      },
      changed: true,
    })
  })

  it("leaves other roles alone", () => {
    const body = { messages: [{ role: "user", content: "y" }] }
    expect(normalizeOpenAIDeveloperRole(body)).toEqual({ body, changed: false })
  })
})

describe("normalizeOpenAIMaxTokens", () => {
  it("maps max_completion_tokens to max_tokens", () => {
    expect(normalizeOpenAIMaxTokens({ max_completion_tokens: 128 })).toEqual({
      body: { max_tokens: 128 },
      changed: true,
    })
  })

  it("does not overwrite an explicit max_tokens", () => {
    expect(
      normalizeOpenAIMaxTokens({ max_completion_tokens: 128, max_tokens: 64 }),
    ).toEqual({ body: { max_tokens: 64 }, changed: true })
  })
})

describe("normalizeOpenAIReasoningEffort", () => {
  it("snaps unsupported tiers onto low|high|max", () => {
    expect(normalizeOpenAIReasoningEffort({ reasoning_effort: "none" }).body).toEqual({
      reasoning_effort: "low",
    })
    expect(normalizeOpenAIReasoningEffort({ reasoning_effort: "medium" }).body).toEqual({
      reasoning_effort: "high",
    })
    expect(normalizeOpenAIReasoningEffort({ reasoning_effort: "xhigh" }).body).toEqual({
      reasoning_effort: "high",
    })
  })

  it("leaves supported and unknown values alone", () => {
    expect(normalizeOpenAIReasoningEffort({ reasoning_effort: "low" })).toEqual({
      body: { reasoning_effort: "low" },
      changed: false,
    })
    expect(normalizeOpenAIReasoningEffort({ reasoning_effort: "max" })).toEqual({
      body: { reasoning_effort: "max" },
      changed: false,
    })
    expect(normalizeOpenAIReasoningEffort({ reasoning_effort: "custom" })).toEqual({
      body: { reasoning_effort: "custom" },
      changed: false,
    })
  })
})

describe("normalizeOpenAIChatBody", () => {
  it("combines every rewrite", () => {
    const result = normalizeOpenAIChatBody({
      messages: [{ role: "developer", content: "sys" }],
      max_completion_tokens: 32,
      tool_choice: { type: "auto" },
    })
    expect(result.changed).toBe(true)
    expect(result.body).toEqual({
      messages: [{ role: "system", content: "sys" }],
      max_tokens: 32,
      tool_choice: "auto",
    })
  })
})
