import type { WebCredential } from "./oauth.js";
import { type Fetcher } from "./http.js";
export declare const WELFARE_BASE = "https://devcloud.cn-north-4.huaweicloud.com/chat/PromptCenterService/v1";
export declare const DELIVERY_URL = "https://devcloud.cn-north-4.huaweicloud.com/chat/PromptCenterService/v1/ops/delivery?channel=WEB";
export declare const CLAIM_URL = "https://devcloud.cn-north-4.huaweicloud.com/chat/PromptCenterService/v1/ops/claim";
export declare const WEB_COOKIE_ENV = "CODEARTS_WEB_COOKIE";
export declare const WEB_COOKIE_FILE_ENV = "CODEARTS_WEB_COOKIE_FILE";
export declare const SIGNIN_TITLES_ENV = "CODEARTS_SIGNIN_TITLES";
export declare const SIGNIN_CAMPAIGNS_ENV = "CODEARTS_SIGNIN_CAMPAIGNS";
export declare const DEFAULT_SIGNIN_TITLES: string[];
/**
 * The two daily check-in campaigns the web console currently exposes. The
 * Skill competition one is a limited-time activity; when it leaves the active
 * delivery list it is reported as expired and skipped.
 *
 * https://developer.huaweicloud.com/competition/information/1300000350/html1
 */
export declare const KNOWN_DAILY_CAMPAIGNS: ReadonlyArray<{
    campaignId: number;
    title: string;
}>;
export type CampaignOutcome = "claimed" | "already" | "expired" | "unavailable" | "error";
export interface CampaignResult {
    campaignId: number;
    title: string;
    outcome: CampaignOutcome;
    message?: string;
    code?: number | string;
    amount?: number;
    unit?: string;
}
export interface SigninResult {
    ok: boolean;
    alreadyClaimed?: boolean;
    authExpired?: boolean;
    error?: string;
    message?: string;
    campaigns?: CampaignResult[];
}
export interface SigninCampaign {
    campaignId: number;
    title: string;
    type?: string;
    status?: string | null;
    claimable?: boolean;
    benefitAmount?: number;
    benefitUnit?: string;
    triggerMode?: string;
    [key: string]: unknown;
}
export declare function webCookieFilePath(): string;
/**
 * Normalize the supported cookie inputs:
 *   - a `Cookie: a=b; c=d` header (optionally from a copied cURL command)
 *   - a browser-extension JSON array (or `{ cookies: [...] }`)
 *   - a Netscape `cookies.txt` export
 *   - a bare `a=b; c=d` string
 */
export declare function normalizeCookie(raw: string): string;
export declare function readWebCookie(env?: NodeJS.ProcessEnv): string;
export declare const PREFERRED_CFTK_COOKIES: string[];
export declare function extractCftk(cookie: string): string;
export interface ClaimOptions {
    cookie?: string;
    credential?: WebCredential | null;
    fetcher?: Fetcher;
    env?: NodeJS.ProcessEnv;
}
/**
 * Claim every daily check-in campaign. Already-claimed and ended campaigns are
 * non-fatal so the daily timer stays green; unexpected errors return ok=false.
 */
export declare function claimDailyBenefit(options?: ClaimOptions): Promise<SigninResult>;
