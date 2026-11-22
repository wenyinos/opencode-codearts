import { describe, expect, it } from "vitest"
import { formatCredit, usageFromStatistics } from "./usage.js"

const STATS = {
  package: {
    spec_code: "codearts.agent.individual.trial",
    package_name_en: "Trial",
    package_name_cn: "体验版",
  },
  metrics: [
    {
      name: "usageTotalPackageCredit",
      package_credit_amount: 14600.0,
      package_credit_used: 137.87,
      package_credit_remain: 14462.13,
      show: true,
    },
    {
      name: "usageBasicPackageCredit",
      package_credit_amount: 500.0,
      package_credit_used: 0,
      package_credit_remain: 500.0,
      show: true,
    },
    {
      name: "usageOnDemandPackageCredit",
      package_credit_amount: 0,
      package_credit_used: 0,
      package_credit_remain: 0,
      show: true,
    },
    {
      name: "usageTokenChatMessages",
      package_credit_amount: 0,
      package_credit_used: 0,
      package_credit_remain: 0,
      show: true,
    },
  ],
}

describe("usageFromStatistics", () => {
  it("maps credit buckets, keeps the total first, and drops empty buckets", () => {
    const report = usageFromStatistics(STATS)
    expect(report.plan).toBe("体验版")
    expect(report.windows.map((w) => w.name)).toEqual(["总积分", "基础积分包"])
    expect(report.windows[0]).toMatchObject({
      display: "138 / 1.5万",
      amount: 137.87,
      limit: 14600,
      unit: "credits",
    })
    expect(report.windows[0].used).toBeCloseTo(0.944, 2)
  })

  it("falls back to limit - remain when the used field is absent", () => {
    const report = usageFromStatistics({
      metrics: [
        {
          name: "usageTotalPackageCredit",
          package_credit_amount: 100,
          package_credit_remain: 40,
        },
      ],
    })
    expect(report.windows[0]).toMatchObject({ amount: 60, used: 60 })
  })

  it("reports an empty account", () => {
    const report = usageFromStatistics({ package: { package_name_cn: "体验版" }, metrics: [] })
    expect(report.windows).toEqual([])
    expect(report.error).toBe("该账号无积分额度")
  })

  it("surfaces a business error code", () => {
    const report = usageFromStatistics({ code: 4003, message: "用户禁用" })
    expect(report).toEqual({ error: "用户禁用", windows: [] })
  })

  it("formats large credit counts", () => {
    expect(formatCredit(999)).toBe("999")
    expect(formatCredit(12345)).toBe("1.2万")
    expect(formatCredit(123_456_789)).toBe("1.2亿")
  })
})
