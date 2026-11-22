// Standalone proxy entry: `npm run start:proxy` (or `node dist/proxy-cli.js`).
// Useful for debugging without opencode: point any OpenAI-compatible client at
// http://127.0.0.1:17228/v2.

import { credentialStatus } from "./credentials.js"
import { CodeArtsProxy } from "./proxy.js"

const proxy = new CodeArtsProxy()

async function main(): Promise<void> {
  await proxy.start()
  const status = credentialStatus()
  if (!status.configured) {
    console.error(
      `[codearts] missing ${status.missing.join(", ")}; set them and restart to serve requests.`,
    )
  }
}

const shutdown = async (): Promise<void> => {
  await proxy.stop()
  process.exit(0)
}

process.on("SIGINT", () => void shutdown())
process.on("SIGTERM", () => void shutdown())

main().catch((err) => {
  console.error("[codearts] proxy failed to start:", err)
  process.exit(1)
})
