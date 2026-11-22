// Map the account's /snap-manager/v1/statistics/plugin answer to the compact
// usage report the local proxy exposes at GET /usage.
//
// CodeArts reports package credits in several buckets (total, basic, on-demand,
// bonus). The total bucket is put first; empty buckets are dropped.

export interface UsageWindow {
  name: string
  /** Percentage used, 0-100. */
  used: number
  display: string
  /** Credits consumed. */
  amount: number
  limit: number
  unit: "credits"
}

export interface UsageReport {
  plan?: string
  windows: UsageWindow[]
  error?: string
}

const METRIC_LABELS: Record<string, string> = {
  usageTotalPackageCredit: "总积分",
  usageBasicPackageCredit: "基础积分包",
  usageOnDemandPackageCredit: "按需积分包",
  usageBonusPackageCredit: "赠送积分包",
}
const TOTAL_METRIC = "usageTotalPackageCredit"

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

function firstOf(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim()
  }
  return ""
}

function num(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return 0
}

const clamp = (value: number): number => Math.max(0, Math.min(100, value))

/** Compact credit counts for the display string (12345 → "1.2万"). */
export function formatCredit(value: number): string {
  const n = Math.max(0, Number.isFinite(value) ? value : 0)
  if (n >= 1e8) return `${(n / 1e8).toFixed(1)}亿`
  if (n >= 1e4) return `${(n / 1e4).toFixed(1)}万`
  return String(Math.round(n))
}

/** Build the usage report from the statistics payload. */
export function usageFromStatistics(raw: unknown): UsageReport {
  let data = raw
  const envelope = record(raw)
  if (envelope && typeof envelope.code === "number") {
    if (envelope.code !== 0) {
      return {
        error: firstOf(envelope.message, envelope.msg, `CodeArts code ${envelope.code}`),
        windows: [],
      }
    }
    data = envelope.data
  }

  const root = record(data)
  if (!root) return { error: "CodeArts usage response could not be parsed", windows: [] }

  const pkg = record(root.package)
  const plan = pkg
    ? firstOf(pkg.package_name_cn, pkg.package_name_en, pkg.spec_code)
    : ""
  const metrics = Array.isArray(root.metrics) ? root.metrics : []

  const windows: UsageWindow[] = []
  for (const item of metrics) {
    const metric = record(item)
    if (!metric) continue
    const name = METRIC_LABELS[String(metric.name ?? "")]
    if (!name) continue
    if (metric.show === false) continue

    const limit = num(metric.package_credit_amount)
    const remain = num(metric.package_credit_remain)
    const used = num(metric.package_credit_used) || Math.max(0, limit - remain)
    if (limit <= 0 && used <= 0) continue

    windows.push({
      name,
      used: clamp(limit > 0 ? (used / limit) * 100 : 0),
      display: `${formatCredit(used)} / ${formatCredit(limit)}`,
      amount: used,
      limit,
      unit: "credits",
    })
  }

  const totalLabel = METRIC_LABELS[TOTAL_METRIC]
  windows.sort((a, b) => {
    if (a.name === totalLabel) return -1
    if (b.name === totalLabel) return 1
    return 0
  })

  if (windows.length > 0) return { plan: plan || undefined, windows }
  return { plan: plan || undefined, windows, error: "该账号无积分额度" }
}
