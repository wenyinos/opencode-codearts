import { describe, expect, it } from "vitest"
import { ConcurrencyGate } from "./gate.js"

describe("ConcurrencyGate", () => {
  it("admits up to the limit and queues the rest", async () => {
    const gate = new ConcurrencyGate(1, 0, 2)
    expect(await gate.acquire("first")).toBe("admitted")

    let outcome: string | undefined
    const queued = gate.acquire("second").then((value) => {
      outcome = value
    })
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(outcome).toBeUndefined()

    gate.release()
    await queued
    expect(outcome).toBe("admitted")
    gate.release()
  })

  it("refuses when the queue is full", async () => {
    const gate = new ConcurrencyGate(1, 0, 0)
    expect(await gate.acquire("first")).toBe("admitted")
    expect(await gate.acquire("second")).toBe("queue-full")
    gate.release()
  })

  it("abandons a queued waiter whose client goes away", async () => {
    const gate = new ConcurrencyGate(1, 0, 1)
    expect(await gate.acquire("first")).toBe("admitted")
    const controller = new AbortController()
    const queued = gate.acquire("second", controller.signal)
    controller.abort()
    expect(await queued).toBe("abandoned")
    gate.release()
  })

  it("applies the cooldown before admitting the next waiter", async () => {
    const gate = new ConcurrencyGate(1, 25, 1)
    expect(await gate.acquire("first")).toBe("admitted")
    const started = Date.now()
    const queued = gate.acquire("second")
    gate.release()
    expect(await queued).toBe("admitted")
    expect(Date.now() - started).toBeGreaterThanOrEqual(20)
    gate.release()
  })
})
