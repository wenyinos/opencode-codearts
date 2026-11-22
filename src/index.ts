// Plugin entry. opencode has shipped two module shapes:
//
//   V1: { id, server: Plugin }            (read by older opencode builds)
//   V2: { id, setup(ctx) }                (read by the current PluginSupervisor)
//
// Export both so the same package works on either. V1 uses the config hook in
// `server`; V2 registers the provider through `ctx.provider.transform`.

import { CodeArtsPlugin, codeArtsSetup } from "./plugin.js"

const module = {
  id: "opencode-codearts",
  server: CodeArtsPlugin,
  setup: codeArtsSetup,
}

export default module
export { CodeArtsPlugin }
