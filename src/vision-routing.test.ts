import { describe, expect, it } from "vitest"
import {
  anyMessageHasImage,
  applyVisionRouting,
  messageHasImage,
  newestUserMessageHasImage,
  stripImages,
} from "./vision-routing.js"

const image = { type: "image_url", image_url: { url: "data:image/png;base64,AAA" } }

describe("vision routing primitives", () => {
  it("detects image parts in array and object content", () => {
    expect(messageHasImage({ role: "user", content: [{ type: "text", text: "x" }, image] })).toBe(true)
    expect(messageHasImage({ role: "user", content: image })).toBe(true)
    expect(messageHasImage({ role: "user", content: "plain" })).toBe(false)
  })

  it("finds images only in the newest user message for the reroute check", () => {
    const messages = [
      { role: "user", content: [image] },
      { role: "assistant", content: "ok" },
      { role: "user", content: "follow up" },
    ]
    expect(anyMessageHasImage(messages)).toBe(true)
    expect(newestUserMessageHasImage(messages)).toBe(false)
    expect(newestUserMessageHasImage([{ role: "user", content: [image] }])).toBe(true)
  })

  it("replaces images with a text placeholder", () => {
    const stripped = stripImages([
      { role: "user", content: [{ type: "text", text: "look" }, image] },
    ]) as Array<{ content: Array<{ type: string; text?: string }> }>
    expect(stripped[0].content).toEqual([
      { type: "text", text: "look" },
      { type: "text", text: "[image omitted: model does not support image input]" },
    ])
  })
})

describe("applyVisionRouting", () => {
  it("reroutes an image turn from a text-only model to the vision model", () => {
    const result = applyVisionRouting({
      model: "GLM-5.2",
      messages: [{ role: "user", content: [{ type: "text", text: "what is this" }, image] }],
    })
    expect(result).toMatchObject({
      upstreamModel: "glm-5.3-flash",
      rerouted: true,
      imagesStripped: false,
    })
    expect(result?.body.model).toBe("glm-5.3-flash")
  })

  it("strips historical images when the newest turn is text", () => {
    const result = applyVisionRouting({
      model: "GLM-5.2",
      messages: [
        { role: "user", content: [image] },
        { role: "assistant", content: "seen" },
        { role: "user", content: "and now?" },
      ],
    })
    expect(result).toMatchObject({ upstreamModel: "GLM-5.2", rerouted: false, imagesStripped: true })
    expect(JSON.stringify(result?.body)).toContain("[image omitted")
  })

  it("does nothing for vision models, unknown models, or text-only turns", () => {
    expect(
      applyVisionRouting({
        model: "glm-5.3-flash",
        messages: [{ role: "user", content: [image] }],
      }),
    ).toBeNull()
    expect(
      applyVisionRouting({
        model: "not-a-codearts-model",
        messages: [{ role: "user", content: [image] }],
      }),
    ).toBeNull()
    expect(
      applyVisionRouting({ model: "GLM-5.2", messages: [{ role: "user", content: "hi" }] }),
    ).toBeNull()
  })
})
