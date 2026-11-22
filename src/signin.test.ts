import { describe, expect, it } from "vitest"
import type { Fetcher } from "./http.js"
import {
  CLAIM_URL,
  DELIVERY_URL,
  claimDailyBenefit,
  extractCftk,
  normalizeCookie,
  readWebCookie,
} from "./signin.js"

const COOKIE = "devclouddevuibjtcftk=CFTK123; devclouddevuibjJ_SESSION_ID=SESSION456"

function deliveryPayload(items: unknown[], ended: unknown[] = []) {
  return { code: 0, message: "ok", data: { channel: "WEB", items, endedCampaigns: ended } }
}

function campaign(id: number, title: string, extra: Record<string, unknown> = {}) {
  return {
    campaignId: id,
    title,
    type: "USER_LOGIN",
    status: "ELIGIBLE",
    claimable: true,
    benefitAmount: id === 34 ? 100 : 1000,
    benefitUnit: "CREDIT",
    triggerMode: "MANUAL_CLAIM",
    ...extra,
  }
}

function harness(options: {
  delivery?: unknown
  claim?: unknown
  claimStatus?: number
  claimHeaders?: Record<string, string>
}) {
  const deliveryCalls: Headers[] = []
  const claimCalls: Array<{ headers: Headers; body: Record<string, unknown> }> = []
  const fetcher: Fetcher = async (input, init) => {
    const url = String(input)
    if (url === DELIVERY_URL) {
      deliveryCalls.push(new Headers(init?.headers))
      return new Response(JSON.stringify(options.delivery), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    }
    if (url === CLAIM_URL) {
      claimCalls.push({
        headers: new Headers(init?.headers),
        body: JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>,
      })
      return new Response(JSON.stringify(options.claim ?? { code: 0, message: "ok", data: {} }), {
        status: options.claimStatus ?? 200,
        headers: { "content-type": "application/json", ...(options.claimHeaders ?? {}) },
      })
    }
    return new Response("unexpected", { status: 500 })
  }
  return { fetcher, deliveryCalls, claimCalls }
}

describe("cookie input", () => {
  it("normalizes an inline Cookie header and finds cftk", () => {
    const cookie = readWebCookie({ CODEARTS_WEB_COOKIE: `Cookie: ${COOKIE}` })
    expect(cookie).toBe(COOKIE)
    expect(extractCftk(cookie)).toBe("CFTK123")
  })

  it("extracts a Cookie from a copied cURL command", () => {
    const raw = `curl 'https://devcloud.example/x' -H 'Cookie: ${COOKIE}'`
    expect(readWebCookie({ CODEARTS_WEB_COOKIE: raw })).toBe(COOKIE)
  })

  it("parses a browser-extension JSON array and filters by domain", () => {
    const json = JSON.stringify([
      { domain: ".devcloud.cn-north-4.huaweicloud.com", name: "devclouddevuibjtcftk", value: "A" },
      { domain: ".huaweicloud.com", name: "SessionID", value: "B" },
      { domain: ".example.com", name: "other", value: "C" },
    ])
    expect(normalizeCookie(json)).toBe("devclouddevuibjtcftk=A; SessionID=B")
  })

  it("parses Playwright-style { cookies: [...] }", () => {
    const json = JSON.stringify({
      cookies: [{ domain: "devcloud.cn-north-4.huaweicloud.com", name: "x", value: "1" }],
    })
    expect(normalizeCookie(json)).toBe("x=1")
  })

  it("parses a Netscape cookies.txt export", () => {
    const netscape = [
      "# Netscape HTTP Cookie File",
      ".devcloud.cn-north-4.huaweicloud.com\tTRUE\t/\tTRUE\t0\tcftk\tNET",
      ".example.com\tTRUE\t/\tTRUE\t0\tother\tNO",
    ].join("\n")
    expect(normalizeCookie(netscape)).toBe("cftk=NET")
  })

  it("prefers the devcloud cftk cookie over console_cftk", () => {
    expect(
      extractCftk("console_cftk=WRONG; devclouddevuibjtcftk=CORRECT; other=1"),
    ).toBe("CORRECT")
  })

  it("returns empty when nothing is configured", () => {
    expect(readWebCookie({ CODEARTS_WEB_COOKIE: "", CODEARTS_WEB_COOKIE_FILE: "/nope" })).toBe("")
  })
})

describe("claimDailyBenefit", () => {
  it("claims both daily check-in campaigns", async () => {
    const { fetcher, claimCalls } = harness({
      delivery: deliveryPayload([
        campaign(34, "每日签到领100积分"),
        campaign(40, "Skill创新赛每日签到礼"),
        campaign(42, "Skill创新赛报名礼", { status: "CONFIRMED", claimable: false }),
      ]),
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.campaigns?.map((c) => [c.campaignId, c.outcome])).toEqual([
      [34, "claimed"],
      [40, "claimed"],
    ])
    expect(claimCalls.map((call) => call.body.campaignId)).toEqual([34, 40])
    expect(claimCalls[0].body).toMatchObject({ channel: "WEB" })
    expect(String(claimCalls[0].body.idempotentKey)).toMatch(/^daily-34-\d{8}$/)
    expect(claimCalls[0].headers.get("cftk")).toBe("CFTK123")
    expect(claimCalls[0].headers.get("cookie")).toBe(COOKIE)
  })

  it("skips campaigns that are already confirmed today", async () => {
    const { fetcher, claimCalls } = harness({
      delivery: deliveryPayload([
        campaign(34, "每日签到领100积分", { status: "CONFIRMED", claimable: false }),
        campaign(40, "Skill创新赛每日签到礼", { status: "CONFIRMED", claimable: false }),
      ]),
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.alreadyClaimed).toBe(true)
    expect(result.campaigns?.map((c) => c.outcome)).toEqual(["already", "already"])
    expect(claimCalls).toHaveLength(0)
  })

  it("trusts claimable=true even if the status is still CONFIRMED", async () => {
    const { fetcher, claimCalls } = harness({
      delivery: deliveryPayload([
        campaign(34, "每日签到领100积分", { status: "CONFIRMED", claimable: true }),
      ]),
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.campaigns?.[0].outcome).toBe("claimed")
    expect(claimCalls).toHaveLength(1)
  })

  it("treats 40001 (not refreshed yet) as already claimed", async () => {
    const { fetcher } = harness({
      delivery: deliveryPayload([campaign(34, "每日签到领100积分")]),
      claim: { code: 40001, message: "尚未到达权益刷新时间，暂时无法领取", data: null },
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.alreadyClaimed).toBe(true)
    expect(result.campaigns?.[0]).toMatchObject({ campaignId: 34, outcome: "already" })
  })

  it("skips an ended campaign without failing the other one", async () => {
    const { fetcher, claimCalls } = harness({
      delivery: deliveryPayload(
        [
          campaign(34, "每日签到领100积分"),
          campaign(40, "Skill创新赛每日签到礼"),
        ],
        [{ campaignId: 40, title: "Skill创新赛每日签到礼" }],
      ),
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.campaigns?.map((c) => [c.campaignId, c.outcome])).toEqual([
      [34, "claimed"],
      [40, "expired"],
    ])
    expect(claimCalls.map((call) => call.body.campaignId)).toEqual([34])
  })

  it("treats an ended claim response as expired, not an error", async () => {
    const { fetcher } = harness({
      delivery: deliveryPayload([campaign(34, "每日签到领100积分")]),
      claim: { code: 40004, message: "活动已结束", data: null },
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.campaigns?.[0]).toMatchObject({ outcome: "expired" })
  })

  it("reports the known daily campaigns as expired when they only exist in endedCampaigns", async () => {
    const { fetcher, claimCalls } = harness({
      delivery: deliveryPayload([], [
        { campaignId: 34 },
        { campaignId: 40 },
        { campaignId: 99 },
      ]),
    })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.alreadyClaimed).toBe(true)
    expect(result.campaigns?.map((c) => [c.campaignId, c.outcome])).toEqual([
      [34, "expired"],
      [40, "expired"],
    ])
    expect(claimCalls).toHaveLength(0)
  })

  it("treats no active daily campaigns as already done", async () => {
    const { fetcher } = harness({ delivery: deliveryPayload([], []) })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(true)
    expect(result.alreadyClaimed).toBe(true)
    expect(result.campaigns).toEqual([])
    expect(result.message).toContain("未找到进行中的每日签到活动")
  })

  it("detects an expired web session", async () => {
    const fetcher: Fetcher = async () =>
      new Response("", {
        status: 200,
        headers: { "hw-ajax-redirect": "https://auth.huaweicloud.com/authui/login?service=" },
      })
    const result = await claimDailyBenefit({ cookie: COOKIE, fetcher })
    expect(result.ok).toBe(false)
    expect(result.authExpired).toBe(true)
  })

  it("refuses to call the API without a cookie or user token", async () => {
    let called = false
    const fetcher: Fetcher = async () => {
      called = true
      return new Response("{}")
    }
    const result = await claimDailyBenefit({ cookie: "", fetcher })
    expect(result.ok).toBe(false)
    expect(result.authExpired).toBe(true)
    expect(called).toBe(false)
  })

  it("sends a web user token as x-auth-token", async () => {
    const { fetcher, deliveryCalls } = harness({
      delivery: deliveryPayload([campaign(34, "每日签到领100积分", { status: "CONFIRMED" })]),
    })
    await claimDailyBenefit({
      cookie: "",
      credential: {
        access_key_id: "AK",
        secret_access_key: "SK",
        security_token: "ST",
        expires_at: "",
        user_token: "USER_TOKEN",
      },
      fetcher,
    })
    expect(deliveryCalls[0].get("x-auth-token")).toBe("USER_TOKEN")
  })
})
