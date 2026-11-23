// Web login CLI: `npm run login`.
//
// Opens the CodeArts portal (or prints the URL), waits for the loopback
// callback, and saves the credential to
// ~/.config/opencode/opencode-codearts/web-auth.json (mode 0600).
//
// The model API still prefers CODEARTS_CLI_AK / CODEARTS_CLI_SK; this login is
// the fallback for model calls.

import fs from "node:fs"
import { startWebLogin } from "./web-auth.js"

const URL_FILE = "/tmp/opencode-codearts-login-url.txt"

async function main(): Promise<void> {
  const started = await startWebLogin({ open: true })
  try {
    fs.writeFileSync(URL_FILE, `${started.loginUrl}\n`)
  } catch {
    /* best effort */
  }

  console.log("Open this URL to sign in to Huawei Cloud CodeArts:")
  console.log("")
  console.log(started.loginUrl)
  console.log("")
  console.log("Waiting for the browser callback (up to 3 minutes)...")

  const credential = await started.result
  console.log("")
  console.log(
    `Logged in${credential.user_name ? ` as ${credential.user_name}` : ""}.`,
  )
  console.log(`Web user token: ${credential.user_token ? "yes" : "no"}`)
  console.log(`Credentials expire at: ${credential.expires_at || "unknown"}`)
  console.log("Saved to ~/.config/opencode/opencode-codearts/web-auth.json")
}

main().catch((err) => {
  console.error("CodeArts web login failed:", err instanceof Error ? err.message : String(err))
  process.exit(1)
})
