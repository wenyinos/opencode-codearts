import { describe, expect, it } from "vitest"
import { describeNetworkError } from "./network-error.js"

describe("describeNetworkError", () => {
  it("names the host for DNS and connection failures", () => {
    const dns = describeNetworkError(
      Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" }),
      "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions",
    )
    expect(dns).toContain("snap-access.cn-north-4.myhuaweicloud.com")
    expect(dns).toContain("DNS")

    const reset = describeNetworkError(
      Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }),
    )
    expect(reset).toContain("CodeArts gateway")
    expect(reset).toContain("interrupted")
  })

  it("walks the cause chain", () => {
    const wrapped = new Error("fetch failed", {
      cause: Object.assign(new Error("connect ETIMEDOUT"), { code: "ETIMEDOUT" }),
    })
    expect(describeNetworkError(wrapped)).toContain("timed out")
  })

  it("returns null for non-network errors", () => {
    expect(describeNetworkError(new Error("invalid json"))).toBeNull()
    expect(describeNetworkError(undefined)).toBeNull()
  })
})
