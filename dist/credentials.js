// AK/SK credentials, read from the same environment variables the CodeArts CLI
// uses (CODEARTS_CLI_AK / CODEARTS_CLI_SK).
//
// opencode's background service is sometimes started before the user's shell
// profile exports those variables, so when the process environment is missing
// a half we fall back to the user's shell profile (or CODEARTS_ENV_FILE). The
// profile is only read, never executed, and only the two named assignments are
// extracted. Nothing is persisted by the plugin.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AK_ENV, SECURITY_TOKEN_ENV, SK_ENV } from "./config.js";
import { isWebCredentialExpired, loadWebAuth } from "./web-auth.js";
/** Read a trimmed, non-empty environment value. */
function envValue(env, key) {
    const value = env[key];
    return typeof value === "string" ? value.trim() : "";
}
/**
 * The credential pair from the process environment, or null when either half
 * is absent. Both halves are required for signing.
 */
export function credentialsFromEnv(env = process.env) {
    const ak = envValue(env, AK_ENV);
    const sk = envValue(env, SK_ENV);
    if (!ak || !sk)
        return null;
    const securityToken = envValue(env, SECURITY_TOKEN_ENV);
    return securityToken ? { ak, sk, securityToken } : { ak, sk };
}
/** The user's login shell name, e.g. "zsh", "bash", "fish". */
export function shellName(env = process.env) {
    const shell = (env.SHELL ?? process.env.SHELL ?? "").trim();
    if (!shell)
        return "";
    return path.basename(shell).toLowerCase().replace(/^-/, "");
}
/**
 * Where to look for a shell profile fallback, ordered for the current shell.
 * Every list still ends with the other common profiles: opencode's background
 * service may run under a different shell than the terminal that exported the
 * variables, so stopping at the first shell would miss them.
 */
export function profileFiles(env = process.env) {
    const explicit = (env.CODEARTS_ENV_FILE ?? process.env.CODEARTS_ENV_FILE ?? "").trim();
    if (explicit)
        return [explicit];
    const home = (env.HOME ?? process.env.HOME ?? os.homedir()).trim();
    if (!home)
        return [];
    const byShell = {
        zsh: [".zshenv", ".zprofile", ".zshrc", ".zlogin", ".profile", ".bash_profile", ".bashrc"],
        bash: [".bash_profile", ".bashrc", ".profile", ".zshrc", ".zshenv"],
        fish: [path.join(".config", "fish", "config.fish"), ".profile", ".bashrc", ".zshrc"],
        sh: [".profile", ".bash_profile", ".bashrc", ".zshrc", ".zshenv"],
        dash: [".profile", ".bash_profile", ".bashrc", ".zshrc", ".zshenv"],
    };
    const common = [".profile", ".bash_profile", ".bashrc", ".zshrc", ".zshenv"];
    const files = byShell[shellName(env)] ?? common;
    return [...new Set(files)].map((name) => path.join(home, name));
}
/**
 * Extract an assignment from a profile file:
 *   export KEY=value        (sh/zsh/bash)
 *   KEY=value               (sh/zsh/bash)
 *   set -gx KEY value       (fish)
 * Quotes are stripped; a trailing ` # comment` is dropped for unquoted values.
 */
export function readProfileAssignment(file, key) {
    let text;
    try {
        text = fs.readFileSync(file, "utf8");
    }
    catch {
        return "";
    }
    const posixPattern = new RegExp(`^[ \\t]*(?:export[ \\t]+)?${key}[ \\t]*=[ \\t]*(.+?)[ \\t]*$`, "m");
    // fish: set -gx / -Ux / -x / --export
    const fishPattern = new RegExp(`^[ \\t]*set[ \\t]+(?:-[A-Za-z]*x[A-Za-z]*|--export)[ \\t]+${key}[ \\t]+(.+?)[ \\t]*$`, "m");
    const match = text.match(posixPattern) ?? text.match(fishPattern);
    if (!match)
        return "";
    let value = match[1].trim();
    if ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
    }
    else {
        const comment = value.indexOf(" #");
        if (comment >= 0)
            value = value.slice(0, comment).trim();
    }
    return value.trim();
}
/**
 * Resolve the credential pair: process environment first, then the first
 * profile file that carries the missing half. Set CODEARTS_DISABLE_PROFILE=1
 * to disable the fallback (tests do this).
 */
export function resolveCredentials(env = process.env) {
    let ak = envValue(env, AK_ENV);
    let sk = envValue(env, SK_ENV);
    let securityToken = envValue(env, SECURITY_TOKEN_ENV);
    let source = ak || sk ? "env" : "none";
    let sourceFile;
    const disabled = env.CODEARTS_DISABLE_PROFILE === "1" || process.env.CODEARTS_DISABLE_PROFILE === "1";
    if ((!ak || !sk || !securityToken) && !disabled) {
        for (const file of profileFiles(env)) {
            if (!fs.existsSync(file))
                continue;
            let used = false;
            if (!ak) {
                const value = readProfileAssignment(file, AK_ENV);
                if (value) {
                    ak = value;
                    used = true;
                }
            }
            if (!sk) {
                const value = readProfileAssignment(file, SK_ENV);
                if (value) {
                    sk = value;
                    used = true;
                }
            }
            if (!securityToken) {
                const value = readProfileAssignment(file, SECURITY_TOKEN_ENV);
                if (value)
                    securityToken = value;
            }
            if (used) {
                source = "profile";
                sourceFile = file;
            }
            if (ak && sk)
                break;
        }
    }
    // Web login fallback: only when the AK/SK pair is absent from the process
    // environment and the shell profile. A web login that has expired is not
    // used; run `npm run login` (or GET /login) to refresh it.
    if (!ak || !sk) {
        const state = loadWebAuth();
        if (state && !isWebCredentialExpired(state.credential)) {
            ak = state.credential.access_key_id;
            sk = state.credential.secret_access_key;
            securityToken = state.credential.security_token || securityToken;
            source = "web";
            sourceFile = undefined;
        }
    }
    const missing = [];
    if (!ak)
        missing.push(AK_ENV);
    if (!sk)
        missing.push(SK_ENV);
    if (!ak || !sk) {
        return { credentials: null, source: "none", missing };
    }
    const credentials = securityToken ? { ak, sk, securityToken } : { ak, sk };
    return { credentials, source, sourceFile, missing };
}
/** A non-secret summary for /status and startup logs. */
export function credentialStatus(env = process.env) {
    const resolved = resolveCredentials(env);
    return {
        ...resolved,
        configured: resolved.credentials !== null,
        akPreview: resolved.credentials ? maskSecret(resolved.credentials.ak) : "",
    };
}
/** Mask a secret for logs: first four and last two characters stay visible. */
export function maskSecret(value) {
    const v = value.trim();
    if (!v)
        return "";
    if (v.length <= 6)
        return `${v.slice(0, 1)}****`;
    return `${v.slice(0, 4)}****${v.slice(-2)}`;
}
