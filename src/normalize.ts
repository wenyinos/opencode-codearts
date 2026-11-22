// OpenAI-request normalisation for the shapes CodeArts' gateway rejects.
//
// The gateway accepts enum-shaped `tool_choice` values only; the OpenAI object
// form makes it reject the whole request. Likewise its message roles are an
// enum without "developer", and it only understands the older `max_tokens`.
// These rewrites mirror the ones opencode-deveco applies for DevEco.

import { log } from "./config.js"

export interface BodyNormalization {
  body: Record<string, unknown>
  changed: boolean
}

function forcedToolName(toolChoice: Record<string, unknown>): string | null {
  if (typeof toolChoice.function === "object" && toolChoice.function !== null) {
    const name = (toolChoice.function as Record<string, unknown>).name
    if (typeof name === "string" && name) return name
  }
  if (typeof toolChoice.name === "string" && toolChoice.name) return toolChoice.name
  return null
}

function narrowTools(tools: unknown, name: string): unknown[] | null {
  if (!Array.isArray(tools)) return null
  const narrowed = tools.filter((tool) => {
    if (!tool || typeof tool !== "object") return false
    const fn = (tool as Record<string, unknown>).function
    return !!fn && typeof fn === "object" && (fn as Record<string, unknown>).name === name
  })
  return narrowed.length > 0 ? narrowed : null
}

/** Rewrite the object form of tool_choice into the enum the gateway accepts. */
export function normalizeOpenAIToolChoice(body: Record<string, unknown>): BodyNormalization {
  const choice = body.tool_choice
  if (choice === undefined || typeof choice === "string") {
    return { body, changed: false }
  }
  if (typeof choice !== "object" || choice === null) {
    log.warn("dropping invalid tool_choice")
    const rest: Record<string, unknown> = { ...body }
    delete rest.tool_choice
    return { body: rest, changed: true }
  }

  const record = choice as Record<string, unknown>
  const type = typeof record.type === "string" ? record.type : ""
  if (type === "auto" || type === "none" || type === "required") {
    return { body: { ...body, tool_choice: type }, changed: true }
  }

  const name = forcedToolName(record)
  if (name) {
    const narrowed = narrowTools(body.tools, name)
    if (narrowed) {
      log.debug("tool_choice object -> required + narrowed tools", { name })
      return { body: { ...body, tool_choice: "required", tools: narrowed }, changed: true }
    }
    log.warn("forced tool not found in tools, falling back to tool_choice=auto", { name })
    return { body: { ...body, tool_choice: "auto" }, changed: true }
  }

  log.warn("unsupported tool_choice object, falling back to auto")
  return { body: { ...body, tool_choice: "auto" }, changed: true }
}

/** The gateway's Role enum has no "developer"; downgrade it to "system". */
export function normalizeOpenAIDeveloperRole(body: Record<string, unknown>): BodyNormalization {
  const messages = body.messages
  if (!Array.isArray(messages)) return { body, changed: false }

  let changed = false
  const rewritten = messages.map((message) => {
    if (!message || typeof message !== "object") return message
    const msg = message as Record<string, unknown>
    if (msg.role !== "developer") return message
    changed = true
    return { ...msg, role: "system" }
  })
  if (!changed) return { body, changed: false }

  log.debug("message role developer -> system")
  return { body: { ...body, messages: rewritten }, changed: true }
}

/** Translate the newer `max_completion_tokens` into `max_tokens`. */
export function normalizeOpenAIMaxTokens(body: Record<string, unknown>): BodyNormalization {
  const maxCompletion = body.max_completion_tokens
  if (maxCompletion === undefined) return { body, changed: false }

  const rest: Record<string, unknown> = { ...body }
  delete rest.max_completion_tokens
  if (typeof maxCompletion === "number" && rest.max_tokens === undefined) {
    rest.max_tokens = maxCompletion
  }
  log.debug("max_completion_tokens -> max_tokens", { maxCompletion })
  return { body: rest, changed: true }
}

/**
 * CodeArts' thinking models accept only low|high|max. OpenAI-style clients and
 * the Anthropic transform also speak none/minimal/medium/xhigh; snap those onto
 * the nearest supported tier (ties go to the stronger tier, like deveco).
 */
const EFFORT_ALIASES: Record<string, string> = {
  none: "low",
  minimal: "low",
  low: "low",
  medium: "high",
  high: "high",
  xhigh: "high",
  max: "max",
}

export function normalizeOpenAIReasoningEffort(
  body: Record<string, unknown>,
): BodyNormalization {
  const effort = body.reasoning_effort
  if (typeof effort !== "string") return { body, changed: false }
  const mapped = EFFORT_ALIASES[effort]
  if (!mapped || mapped === effort) return { body, changed: false }
  log.debug("reasoning_effort snapped to a CodeArts tier", { from: effort, to: mapped })
  return { body: { ...body, reasoning_effort: mapped }, changed: true }
}

/** Apply every CodeArts-side rewrite, in a stable order. */
export function normalizeOpenAIChatBody(body: Record<string, unknown>): BodyNormalization {
  let current = body
  let changed = false
  for (const normalize of [
    normalizeOpenAIDeveloperRole,
    normalizeOpenAIMaxTokens,
    normalizeOpenAIReasoningEffort,
    normalizeOpenAIToolChoice,
  ]) {
    const result = normalize(current)
    if (result.changed) {
      current = result.body
      changed = true
    }
  }
  return { body: current, changed }
}
