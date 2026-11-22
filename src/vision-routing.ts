// Image fallback for text-only CodeArts models.
//
// Several catalogue entries declare `modalities.input: ["text"]`; sending an
// image to one of them fails upstream. When the newest user turn carries an
// image the request is rerouted to a vision-capable model (same idea as
// opencode-deveco's vision routing). Images left in *history* are replaced by
// a text placeholder instead, so a later text-only turn still works.

import { CATALOG, type ModelInfo, log } from "./config.js"
import { loadPersistedModels } from "./models.js"

export const DEFAULT_VISION_MODEL = "glm-5.3-flash"
export const VISION_MODEL_ENV = "CODEARTS_VISION_MODEL"

export interface ImageRoutingResult {
  body: Record<string, unknown>
  upstreamModel: string
  rerouted: boolean
  imagesStripped: boolean
}

function catalog(): Record<string, ModelInfo> {
  return loadPersistedModels() ?? CATALOG
}

/** Resolve the fallback vision model id (env override wins). */
export function visionModelId(env: NodeJS.ProcessEnv = process.env): string {
  const configured = (env[VISION_MODEL_ENV] ?? "").trim().replace(/^codearts\//, "")
  return configured || DEFAULT_VISION_MODEL
}

/** True when the model is known and declares image input. */
export function modelSupportsImages(
  model: string,
  models: Record<string, ModelInfo> = catalog(),
): boolean {
  return models[model]?.modalities?.input?.includes("image") === true
}

function isImageBlock(block: unknown): boolean {
  if (!block || typeof block !== "object") return false
  const type = (block as Record<string, unknown>).type
  return type === "image_url" || type === "image" || type === "input_image"
}

/** Does one message carry an image part? */
export function messageHasImage(message: unknown): boolean {
  if (!message || typeof message !== "object") return false
  const content = (message as Record<string, unknown>).content
  if (Array.isArray(content)) return content.some(isImageBlock)
  // Some clients put a single image object straight into `content`.
  return isImageBlock(content)
}

export function anyMessageHasImage(messages: unknown): boolean {
  return Array.isArray(messages) && messages.some(messageHasImage)
}

/** Does the newest user message carry an image? */
export function newestUserMessageHasImage(messages: unknown): boolean {
  if (!Array.isArray(messages)) return false
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    if (!message || typeof message !== "object") continue
    if ((message as Record<string, unknown>).role !== "user") continue
    return messageHasImage(message)
  }
  return false
}

/** Replace image parts with a text placeholder, keeping every other part. */
export function stripImages(messages: unknown): unknown[] {
  if (!Array.isArray(messages)) return []
  return messages.map((message) => {
    if (!message || typeof message !== "object") return message
    const record = message as Record<string, unknown>
    if (!Array.isArray(record.content)) return message
    return {
      ...record,
      content: record.content.map((block) =>
        isImageBlock(block)
          ? { type: "text", text: "[image omitted: model does not support image input]" }
          : block,
      ),
    }
  })
}

/**
 * Apply the fallback. Returns null when no rewrite is needed (known vision
 * model, unknown model, or no images at all).
 */
export function applyVisionRouting(
  body: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): ImageRoutingResult | null {
  const model = typeof body.model === "string" ? body.model : ""
  if (!model) return null
  const models = catalog()
  if (!models[model]) return null
  if (modelSupportsImages(model, models)) return null

  const messages = body.messages
  if (!anyMessageHasImage(messages)) return null

  if (newestUserMessageHasImage(messages)) {
    const vision = visionModelId(env)
    if (vision === model || !models[vision]) {
      log.warn(`text-only model ${model} received an image and no vision model is available`)
      return null
    }
    log.warn(`text-only model ${model} received an image; rerouting to ${vision}`)
    return {
      body: { ...body, model: vision },
      upstreamModel: vision,
      rerouted: true,
      imagesStripped: false,
    }
  }

  log.warn(`text-only model ${model}: dropping historical images`)
  return {
    body: { ...body, messages: stripImages(messages) },
    upstreamModel: model,
    rerouted: false,
    imagesStripped: true,
  }
}
