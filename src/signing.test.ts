import { describe, expect, it } from "vitest"
import {
  buildCanonicalRequest,
  formatDateStamp,
  hmacSha256Hex,
  sha256Hex,
  signRequestHuawei,
  utf8,
} from "./signing.js"

describe("webcrypto helpers", () => {
  it("sha256Hex matches the known SHA-256 of the empty string", async () => {
    expect(await sha256Hex(new Uint8Array())).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    )
  })

  it("hmacSha256Hex matches RFC 4231 test case 2", async () => {
    expect(await hmacSha256Hex(utf8("Jefe"), utf8("what do ya want for nothing?"))).toBe(
      "5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843",
    )
  })

  it("formats the SDK date stamp as YYYYMMDDTHHMMSSZ", () => {
    expect(formatDateStamp(new Date("2026-11-22T12:34:56.789Z"))).toBe("20261122T123456Z")
  })
})

describe("canonical request", () => {
  it("lays out the sections exactly like the Huawei SDK", () => {
    const headers = new Map<string, string>([
      ["content-type", "application/json"],
      ["host", "snap-access.cn-north-4.myhuaweicloud.com"],
      ["x-sdk-date", "20261122T120000Z"],
    ])
    expect(buildCanonicalRequest("GET", "/v1/model/builtin/", "", headers, "abc")).toBe(
      [
        "GET",
        "/v1/model/builtin/",
        "",
        "content-type:application/json",
        "host:snap-access.cn-north-4.myhuaweicloud.com",
        "x-sdk-date:20261122T120000Z",
        "",
        "content-type;host;x-sdk-date",
        "abc",
      ].join("\n"),
    )
  })
})

describe("signRequestHuawei", () => {
  const body = utf8('{"model":"glm-5.3-flash"}')
  const url = "https://snap-access.cn-north-4.myhuaweicloud.com/api/v2/chat/completions"

  it("signs a POST with the expected headers and no security token by default", async () => {
    const signed = await signRequestHuawei({
      ak: "AKID",
      sk: "SECRET",
      method: "POST",
      url,
      body,
      dateStamp: "20261122T120000Z",
    })

    expect(signed.headers["x-sdk-date"]).toBe("20261122T120000Z")
    expect(signed.headers["x-sdk-content-sha256"]).toBe(await sha256Hex(body))
    expect(signed.headers["content-type"]).toBe("application/json")
    expect(signed.headers.authorization).toMatch(
      /^SDK-HMAC-SHA256 Access=AKID,SignedHeaders=content-type;host;x-sdk-content-sha256;x-sdk-date,Signature=[0-9a-f]{64}$/,
    )
    expect(signed.headers["x-security-token"]).toBeUndefined()
    expect(signed.headers.host).toBeUndefined()
  })

  it("is deterministic for a fixed date stamp", async () => {
    const a = await signRequestHuawei({
      ak: "AKID",
      sk: "SECRET",
      method: "POST",
      url,
      body,
      dateStamp: "20261122T120000Z",
    })
    const b = await signRequestHuawei({
      ak: "AKID",
      sk: "SECRET",
      method: "POST",
      url,
      body,
      dateStamp: "20261122T120000Z",
    })
    expect(a.signature).toBe(b.signature)
  })

  it("includes X-Security-Token for temporary credentials", async () => {
    const signed = await signRequestHuawei({
      ak: "AKID",
      sk: "SECRET",
      securityToken: "ST",
      method: "GET",
      url: "https://snap-access.cn-north-4.myhuaweicloud.com/v1/model/builtin",
      extraHeaders: { "content-type": "application/json" },
      dateStamp: "20261122T120000Z",
    })
    expect(signed.headers["x-security-token"]).toBe("ST")
    expect(signed.headers.authorization).toContain("x-security-token")
  })
})
