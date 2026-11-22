// Import a browser cookie into web-cookie.txt.
//
//   npm run signin:import-cookie
//   # paste a Cookie header, a copied cURL command, a Cookie-Editor /
//   # EditThisCookie JSON export, or a Netscape cookies.txt, then Ctrl-D
//
//   npm run signin:import-cookie -- --clipboard
//   # read the clipboard instead (wl-paste/xclip/pbpaste/Get-Clipboard)
//
// The input is normalized to a `name=value; ...` Cookie header and saved with
// mode 0600. Cookie values are never printed.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { extractCftk, normalizeCookie, webCookieFilePath } from "./signin.js";
function clipboardRead() {
    const candidates = process.platform === "darwin"
        ? [{ command: "pbpaste", args: [] }]
        : process.platform === "win32"
            ? [{ command: "powershell", args: ["-NoProfile", "-Command", "Get-Clipboard"] }]
            : [
                { command: "wl-paste", args: ["--no-newline"] },
                { command: "xclip", args: ["-selection", "clipboard", "-o"] },
                { command: "xsel", args: ["--clipboard", "--output"] },
            ];
    for (const candidate of candidates) {
        try {
            const value = execFileSync(candidate.command, candidate.args, {
                encoding: "utf8",
                timeout: 3_000,
            });
            if (value.trim())
                return value;
        }
        catch {
            /* try the next clipboard tool */
        }
    }
    return "";
}
function main() {
    const fromClipboard = process.argv.includes("--clipboard");
    let raw = fromClipboard ? clipboardRead() : "";
    if (!raw.trim()) {
        if (process.stdin.isTTY) {
            console.error("请粘贴 Cookie（支持 Cookie-Editor/EditThisCookie JSON、完整 cURL、Cookie 头、Netscape cookies.txt），然后按 Ctrl-D：");
        }
        try {
            raw = fs.readFileSync(0, "utf8");
        }
        catch {
            raw = "";
        }
    }
    const cookie = normalizeCookie(raw);
    if (!cookie) {
        console.error("没有读到 Cookie。");
        process.exitCode = 1;
        return;
    }
    const cftk = extractCftk(cookie);
    if (!cftk) {
        console.error("Cookie 中未找到 cftk（devclouddevuibjtcftk）。请确认导出的是 " +
            "https://devcloud.cn-north-4.huaweicloud.com 的 Cookie。");
        process.exitCode = 1;
        return;
    }
    const file = (process.env.CODEARTS_WEB_COOKIE_FILE ?? "").trim() || webCookieFilePath();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${cookie}\n`, { mode: 0o600 });
    try {
        fs.chmodSync(file, 0o600);
    }
    catch {
        /* best effort */
    }
    const count = cookie.split(";").filter((part) => part.trim()).length;
    console.log(`已导入 ${count} 个 Cookie，cftk 已找到。`);
    console.log(`保存到 ${file}（权限 600）。`);
    console.log("下一步：npm run signin");
}
main();
