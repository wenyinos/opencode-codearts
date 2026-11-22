// Daily check-in CLI: `npm run signin`.
//
// Reads the browser cookie from
// ~/.config/opencode/opencode-codearts/web-cookie.txt (or CODEARTS_WEB_COOKIE),
// asks the welfare delivery endpoint for the daily campaigns, and claims the
// ones that are currently eligible. Ended campaigns are logged and skipped.

import { claimDailyBenefit, type CampaignResult } from "./signin.js"
import { currentWebCredential } from "./web-auth.js"

function describe(campaign: CampaignResult): string {
  const amount = campaign.amount ? ` +${campaign.amount} ${campaign.unit ?? "CREDIT"}` : ""
  switch (campaign.outcome) {
    case "claimed":
      return `签到成功：${campaign.title}${amount}`
    case "already":
      return `今日已领取：${campaign.title}`
    case "expired":
      return `活动已结束，跳过：${campaign.title}`
    case "unavailable":
      return `暂不可领取：${campaign.title}${campaign.message ? `（${campaign.message}）` : ""}`
    default:
      return `领取失败：${campaign.title} — ${campaign.message ?? "unknown error"}`
  }
}

async function main(): Promise<void> {
  const credential = await currentWebCredential()
  const result = await claimDailyBenefit({ credential })

  for (const campaign of result.campaigns ?? []) {
    console.log(describe(campaign))
  }
  if ((result.campaigns?.length ?? 0) === 0 && result.message) {
    console.log(result.message)
  }

  if (result.authExpired) {
    console.error(result.error || "网页登录已失效，请重新导出 Cookie。")
    process.exitCode = 1
    return
  }
  if (!result.ok) {
    console.error(result.error || "签到失败。")
    process.exitCode = 1
    return
  }
  if (result.alreadyClaimed) console.log("今日签到已完成（无需重复领取）。")
}

main().catch((err) => {
  console.error("签到失败:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
