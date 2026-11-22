// Print the opencode provider block for the standalone proxy.
//
// Usage:
//   npm run build
//   npm run print-provider
//
// Merge the output into ~/.config/opencode/opencode.json. No plugin entry is
// needed when the proxy runs by itself.

import {
  CATALOG,
  OAUTH_DUMMY_KEY,
  PROXY_HOST,
  PROVIDER_ID,
  proxyPort,
} from "./config.js"
import { loadPersistedModels } from "./models.js"

const api = `http://${PROXY_HOST}:${proxyPort()}/api/v2`
const provider = {
  [PROVIDER_ID]: {
    name: "CodeArts",
    npm: "@ai-sdk/openai-compatible",
    api,
    env: [],
    options: { apiKey: OAUTH_DUMMY_KEY, baseURL: api },
    // Prefer the live snapshot the proxy persisted; fall back to the static
    // 12-model catalogue on a cold machine.
    models: loadPersistedModels() ?? CATALOG,
  },
}

process.stdout.write(`${JSON.stringify({ provider }, null, 2)}\n`)
