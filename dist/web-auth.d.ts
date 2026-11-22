import { type WebCredential } from "./oauth.js";
export interface WebAuthState {
    credential: WebCredential;
    saved_at: number;
}
export interface WebAuthStatus {
    available: boolean;
    expires_at?: string;
    has_user_token: boolean;
    has_refresh_token: boolean;
    source: "web-auth" | "none";
}
export declare function webAuthFilePath(): string;
export declare function saveWebAuth(state: WebAuthState, file?: string): boolean;
export declare function loadWebAuth(file?: string): WebAuthState | null;
export declare function clearWebAuth(file?: string): void;
export declare function webAuthStatus(file?: string): WebAuthStatus;
export declare function isWebCredentialExpired(credential: WebCredential, leadMs?: number): boolean;
export interface StartedWebLogin {
    loginUrl: string;
    /** Resolves with the saved credential once the browser callback completes. */
    result: Promise<WebCredential>;
}
/**
 * Start a web login and return its URL immediately. The callback result is
 * persisted in the background; errors are logged and never escape.
 */
export declare function startWebLogin(options?: {
    open?: boolean;
}): Promise<StartedWebLogin>;
/** Run a complete login and return the credential (for the CLI). */
export declare function loginWeb(options?: {
    open?: boolean;
}): Promise<WebCredential>;
/**
 * Refresh the stored web login. Returns null when there is no refresh token or
 * the refresh failed (the caller can ask the user to log in again).
 */
export declare function refreshWebLogin(): Promise<WebCredential | null>;
/** The current web credential, refreshing it when it is about to expire. */
export declare function currentWebCredential(): Promise<WebCredential | null>;
