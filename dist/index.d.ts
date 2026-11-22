import { CodeArtsPlugin, codeArtsSetup } from "./plugin.js";
declare const module: {
    id: string;
    server: import("@opencode-ai/plugin").Plugin;
    setup: typeof codeArtsSetup;
};
export default module;
export { CodeArtsPlugin };
