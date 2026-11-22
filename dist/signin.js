// Daily CodeArts check-in (welfare campaigns).
//
// The web console exposes a welfare/activity service:
//   GET  /chat/PromptCenterService/v1/ops/delivery?channel=WEB
//   POST /chat/PromptCenterService/v1/ops/claim
//
// The daily check-in campaigns currently are:
//   - "每日签到领100积分"          (campaignId 34)
//   - "Skill创新赛每日签到礼"      (campaignId 40)
// Both are limited-time activities. A campaign that has ended is recorded as
// `expired` and skipped, so the daily timer does not fail because of it.
//
// Auth is the browser login cookie (including the `devclouddevuibjtcftk`
// cookie, echoed as the `cftk` header). TUI OAuth credentials cannot claim
// these campaigns.
//
// Cookie sources, in order:
//   1. CODEARTS_WEB_COOKIE (inline)
//   2. CODEARTS_WEB_COOKIE_FILE
//   3. ~/.config/opencode/opencode-codearts/web-cookie.txt (mode 0600)
import fs from "node:fs";
import path from "node:path";
import { log, pluginDataDir } from "./config.js";
import { directFetch } from "./http.js";
export const WELFARE_BASE = "https://devcloud.cn-north-4.huaweicloud.com/chat/PromptCenterService/v1";
export const DELIVERY_URL = `${WELFARE_BASE}/ops/delivery?channel=WEB`;
export const CLAIM_URL = `${WELFARE_BASE}/ops/claim`;
export const WEB_COOKIE_ENV = "CODEARTS_WEB_COOKIE";
export const WEB_COOKIE_FILE_ENV = "CODEARTS_WEB_COOKIE_FILE";
export const SIGNIN_TITLES_ENV = "CODEARTS_SIGNIN_TITLES";
export const SIGNIN_CAMPAIGNS_ENV = "CODEARTS_SIGNIN_CAMPAIGNS";
export const DEFAULT_SIGNIN_TITLES = ["每日签到"];
/**
 * The two daily check-in campaigns the web console currently exposes. The
 * Skill competition one is a limited-time activity; when it leaves the active
 * delivery list it is reported as expired and skipped.
 *
 * https://developer.huaweicloud.com/competition/information/1300000350/html1
 */
export const KNOWN_DAILY_CAMPAIGNS = [
    { campaignId: 34, title: "每日签到领100积分" },
    { campaignId: 40, title: "Skill创新赛每日签到礼" },
];
export function webCookieFilePath() {
    return path.join(pluginDataDir(), "web-cookie.txt");
}
function record(value) {
    return value && typeof value === "object" && !Array.isArray(value)
        ? value
        : {};
}
function firstOf(...values) {
    for (const value of values) {
        if (typeof value === "string" && value.trim())
            return value.trim();
    }
    return "";
}
function num(value) {
    if (typeof value === "number" && Number.isFinite(value))
        return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Number(value);
        if (Number.isFinite(parsed))
            return parsed;
    }
    return 0;
}
function localDateStamp(date = new Date()) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}
// ---------------------------------------------------------------------------
// Cookie input
// ---------------------------------------------------------------------------
const SIGNIN_HOST = "devcloud.cn-north-4.huaweicloud.com";
function domainMatches(domain) {
    if (!domain)
        return true;
    const normalized = domain.startsWith(".") ? domain.slice(1) : domain;
    return SIGNIN_HOST === normalized || SIGNIN_HOST.endsWith(`.${normalized}`);
}
function cookieHeaderFromRecords(records) {
    const matching = records.filter((cookie) => typeof cookie.name === "string" &&
        cookie.name !== "" &&
        typeof cookie.value === "string" &&
        domainMatches(cookie.domain));
    // If domain filtering removes everything, fall back to every record: an
    // extension export with unusual domains is still better than no cookie.
    const chosen = matching.length > 0 ? matching : records;
    return chosen
        .filter((cookie) => typeof cookie.name === "string" &&
        cookie.name !== "" &&
        typeof cookie.value === "string")
        .map((cookie) => `${cookie.name}=${cookie.value}`)
        .join("; ");
}
/**
 * Normalize the supported cookie inputs:
 *   - a `Cookie: a=b; c=d` header (optionally from a copied cURL command)
 *   - a browser-extension JSON array (or `{ cookies: [...] }`)
 *   - a Netscape `cookies.txt` export
 *   - a bare `a=b; c=d` string
 */
export function normalizeCookie(raw) {
    const text = raw.trim();
    if (!text)
        return "";
    if (text.startsWith("[") || text.startsWith("{")) {
        try {
            const parsed = JSON.parse(text);
            const list = Array.isArray(parsed)
                ? parsed
                : parsed &&
                    typeof parsed === "object" &&
                    Array.isArray(parsed.cookies)
                    ? parsed.cookies
                    : null;
            if (list) {
                const header = cookieHeaderFromRecords(list);
                if (header)
                    return header;
            }
        }
        catch {
            /* not JSON; fall through */
        }
    }
    if (text.split("\n").some((line) => line.split("\t").length >= 7)) {
        const records = [];
        for (const line of text.split("\n")) {
            if (!line.trim() || line.startsWith("#"))
                continue;
            const parts = line.split("\t");
            if (parts.length >= 7)
                records.push({ domain: parts[0], name: parts[5], value: parts[6] });
        }
        const header = cookieHeaderFromRecords(records);
        if (header)
            return header;
    }
    const curlHeader = text.match(/-H\s+['"]Cookie:\s*([^'"]+)['"]/i);
    if (curlHeader)
        return curlHeader[1].trim();
    const curlB = text.match(/\s-b\s+['"]([^'"]+)['"]/i);
    if (curlB)
        return curlB[1].trim();
    return text.replace(/^cookie:\s*/i, "").trim();
}
export function readWebCookie(env = process.env) {
    const inline = (env[WEB_COOKIE_ENV] ?? "").trim();
    if (inline)
        return normalizeCookie(inline);
    const file = (env[WEB_COOKIE_FILE_ENV] ?? "").trim() || webCookieFilePath();
    try {
        return normalizeCookie(fs.readFileSync(file, "utf8"));
    }
    catch {
        return "";
    }
}
// ---------------------------------------------------------------------------
// cftk header
// ---------------------------------------------------------------------------
export const PREFERRED_CFTK_COOKIES = ["devclouddevuibjtcftk", "cftk_cookie_key_cf2", "cftk"];
export function extractCftk(cookie) {
    const values = new Map();
    for (const part of cookie.split(";")) {
        const eq = part.indexOf("=");
        if (eq < 0)
            continue;
        const name = part.slice(0, eq).trim();
        const value = part.slice(eq + 1).trim();
        if (name)
            values.set(name, value);
    }
    for (const name of PREFERRED_CFTK_COOKIES) {
        const value = values.get(name);
        if (value)
            return value;
    }
    for (const [name, value] of values) {
        if (/cftk/i.test(name))
            return value;
    }
    return "";
}
// ---------------------------------------------------------------------------
// Welfare delivery / claim
// ---------------------------------------------------------------------------
function welfareHeaders(cookie, userToken) {
    const headers = {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
        "x-codearts-doer-scenario-type": "web",
        "Agent-Type": "PromptCenter",
        "X-Language": "zh-cn",
        origin: "https://devcloud.cn-north-4.huaweicloud.com",
        referer: "https://devcloud.cn-north-4.huaweicloud.com/chat/home",
    };
    if (userToken)
        headers["x-auth-token"] = userToken;
    if (cookie) {
        headers.cookie = cookie;
        const cftk = extractCftk(cookie);
        if (cftk)
            headers.cftk = cftk;
    }
    return headers;
}
async function readJson(response) {
    try {
        const parsed = (await response.json());
        return record(parsed);
    }
    catch {
        return null;
    }
}
async function fetchDelivery(cookie, userToken, fetcher) {
    let response;
    try {
        response = await fetcher(DELIVERY_URL, {
            headers: welfareHeaders(cookie, userToken),
            signal: AbortSignal.timeout(30_000),
        });
    }
    catch (err) {
        return { error: `读取签到活动失败: ${err instanceof Error ? err.message : String(err)}` };
    }
    if (response.status === 401 ||
        response.status === 403 ||
        response.headers.get("hw-ajax-redirect")) {
        return { authExpired: true };
    }
    const data = await readJson(response);
    if (!data)
        return { error: "签到活动接口返回了非 JSON 响应" };
    const code = num(data.code);
    if (code !== 0 && code !== 200) {
        return { error: firstOf(data.message, data.error_msg) || `活动列表失败 (code=${code})` };
    }
    const payload = record(data.data);
    const items = Array.isArray(payload.items)
        ? (payload.items.map((item) => record(item)).filter((item) => item.campaignId))
        : [];
    const ended = new Set();
    if (Array.isArray(payload.endedCampaigns)) {
        for (const item of payload.endedCampaigns) {
            const campaign = record(item);
            const id = num(campaign.campaignId);
            if (id)
                ended.add(id);
        }
    }
    return { items, ended };
}
function targetCampaigns(delivery, env) {
    const titles = (env[SIGNIN_TITLES_ENV] ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
    const filters = titles.length > 0 ? titles : DEFAULT_SIGNIN_TITLES;
    const ids = new Set((env[SIGNIN_CAMPAIGNS_ENV] ?? "")
        .split(",")
        .map((value) => Number(value.trim()))
        .filter((value) => Number.isInteger(value) && value > 0));
    const result = [];
    const seen = new Set();
    for (const campaign of delivery.items ?? []) {
        const id = num(campaign.campaignId);
        if (!id || seen.has(id))
            continue;
        const title = String(campaign.title ?? "");
        if (ids.size > 0 ? ids.has(id) : filters.some((filter) => title.includes(filter))) {
            seen.add(id);
            result.push({ campaign, ended: delivery.ended?.has(id) === true });
        }
    }
    // Campaigns that only exist in endedCampaigns are still reported as expired,
    // but only the known daily ones (or explicitly configured ids) — unrelated
    // ended campaigns should not pollute the report.
    for (const id of delivery.ended ?? []) {
        if (seen.has(id))
            continue;
        const known = KNOWN_DAILY_CAMPAIGNS.find((item) => item.campaignId === id);
        if (known) {
            seen.add(id);
            result.push({ campaign: { campaignId: id, title: known.title }, ended: true });
            continue;
        }
        if (ids.size > 0 && ids.has(id)) {
            seen.add(id);
            result.push({ campaign: { campaignId: id, title: `campaign ${id}` }, ended: true });
        }
    }
    return result;
}
async function claimOne(campaign, ended, cookie, userToken, fetcher) {
    const campaignId = num(campaign.campaignId);
    const title = String(campaign.title ?? `campaign ${campaignId}`);
    const base = {
        campaignId,
        title,
        outcome: "unavailable",
        ...(campaign.benefitAmount ? { amount: campaign.benefitAmount } : {}),
        ...(campaign.benefitUnit ? { unit: campaign.benefitUnit } : {}),
    };
    const status = String(campaign.status ?? "").toUpperCase();
    if (ended || ["EXPIRED", "ENDED", "CLOSED"].includes(status)) {
        return { result: { ...base, outcome: "expired", message: "活动已结束，跳过" } };
    }
    // Trust the server's claimable flag first: the delivery status can stay
    // CONFIRMED while a new day's claim becomes available again.
    if (campaign.claimable !== true) {
        if (["CONFIRMED", "CLAIMED", "RECEIVED"].includes(status)) {
            return { result: { ...base, outcome: "already", message: "今日已领取" } };
        }
        if (status !== "ELIGIBLE") {
            return { result: { ...base, outcome: "unavailable", message: "当前不可领取" } };
        }
    }
    const body = JSON.stringify({
        campaignId,
        idempotentKey: `daily-${campaignId}-${localDateStamp()}`,
        channel: "WEB",
    });
    let response;
    try {
        response = await fetcher(CLAIM_URL, {
            method: "POST",
            headers: welfareHeaders(cookie, userToken),
            body,
            signal: AbortSignal.timeout(30_000),
        });
    }
    catch (err) {
        return {
            result: {
                ...base,
                outcome: "error",
                message: `领取请求失败: ${err instanceof Error ? err.message : String(err)}`,
            },
        };
    }
    if (response.status === 401 ||
        response.status === 403 ||
        response.headers.get("hw-ajax-redirect")) {
        return {
            result: { ...base, outcome: "error", message: "网页登录已失效，请重新导出 Cookie" },
            authExpired: true,
        };
    }
    const data = await readJson(response);
    if (!data) {
        return { result: { ...base, outcome: "error", message: "领取接口返回了非 JSON 响应" } };
    }
    const code = data.code ?? data.error_code;
    const codeNumber = num(code);
    const rawCode = typeof code === "number" || typeof code === "string" ? code : undefined;
    const message = firstOf(data.message, data.error_msg);
    if (codeNumber === 0 || codeNumber === 200) {
        log.info(`CodeArts daily check-in claimed: ${title} (${campaignId})`);
        return { result: { ...base, outcome: "claimed", code: codeNumber, message: message || "领取成功" } };
    }
    if (codeNumber === 40001 || /尚未到达|refresh/i.test(message)) {
        return {
            result: {
                ...base,
                outcome: "already",
                code: codeNumber,
                message: message || "今日已领取，等待下次刷新",
            },
        };
    }
    if (/过期|结束|未开始|expired|ended|not started|closed/i.test(message)) {
        return {
            result: { ...base, outcome: "expired", code: rawCode, message: message || "活动已结束" },
        };
    }
    if (codeNumber === 40901 || /冲突|conflict|already/i.test(message)) {
        return {
            result: { ...base, outcome: "already", code: codeNumber, message: message || "今日已领取" },
        };
    }
    return {
        result: {
            ...base,
            outcome: "error",
            code: rawCode,
            message: message || `领取失败 (code=${String(code ?? "unknown")})`,
        },
    };
}
/**
 * Claim every daily check-in campaign. Already-claimed and ended campaigns are
 * non-fatal so the daily timer stays green; unexpected errors return ok=false.
 */
export async function claimDailyBenefit(options = {}) {
    const env = options.env ?? process.env;
    const cookie = (options.cookie ?? readWebCookie(env)).trim();
    const userToken = options.credential?.user_token?.trim() ?? "";
    if (!cookie && !userToken) {
        return {
            ok: false,
            authExpired: true,
            error: "缺少网页登录 Cookie。请从浏览器导出 devcloud.cn-north-4.huaweicloud.com 的 Cookie，" +
                "保存到 ~/.config/opencode/opencode-codearts/web-cookie.txt（权限 600）。",
        };
    }
    const fetcher = options.fetcher ?? directFetch;
    const delivery = await fetchDelivery(cookie, userToken, fetcher);
    if (delivery.authExpired) {
        return {
            ok: false,
            authExpired: true,
            error: "网页登录已失效（签到接口要求重新登录），请重新导出 Cookie。",
        };
    }
    if (delivery.error)
        return { ok: false, error: delivery.error };
    const targets = targetCampaigns(delivery, env);
    if (targets.length === 0) {
        // Both daily campaigns are limited-time; once they leave delivery entirely
        // there is nothing to claim. That is not a failure for the daily timer.
        log.info("no active daily check-in campaigns; treating as already done");
        return {
            ok: true,
            alreadyClaimed: true,
            campaigns: [],
            message: "未找到进行中的每日签到活动（活动可能已结束）。可用 " +
                `${SIGNIN_TITLES_ENV} 或 ${SIGNIN_CAMPAIGNS_ENV} 覆盖匹配。`,
        };
    }
    const campaigns = [];
    let authExpired = false;
    for (const target of targets) {
        const outcome = await claimOne(target.campaign, target.ended, cookie, userToken, fetcher);
        campaigns.push(outcome.result);
        if (outcome.authExpired) {
            authExpired = true;
            break;
        }
    }
    const hasError = campaigns.some((campaign) => campaign.outcome === "error");
    const claimed = campaigns.some((campaign) => campaign.outcome === "claimed");
    if (authExpired) {
        return {
            ok: false,
            authExpired: true,
            error: "网页登录已失效，请重新导出 Cookie。",
            campaigns,
        };
    }
    if (hasError) {
        return {
            ok: false,
            error: campaigns.find((campaign) => campaign.outcome === "error")?.message || "签到失败",
            campaigns,
        };
    }
    return {
        ok: true,
        ...(claimed ? {} : { alreadyClaimed: true }),
        campaigns,
    };
}
