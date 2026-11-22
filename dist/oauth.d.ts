export declare const OAUTH_CLIENT_ID = "CodeArts_Tui";
export declare const OAUTH_REDIRECT_PATH = "/oauth/callback";
export declare const PORTAL_AUTHORIZE_BASE = "https://codearts.huaweicloud.com/portal/authorize";
export declare const PORTAL_LOGIN_BASE = "https://codearts.huaweicloud.com/portal/login";
export declare const STS_TOKEN_ENDPOINT = "https://sts.cn-north-4.myhuaweicloud.com/v1/oauth2/tokens";
export declare const LEGACY_TICKET_ENDPOINT = "https://snap-access.cn-north-4.myhuaweicloud.com/snap-manager/v1/login/ticket";
export declare const OAUTH_LOCALE = "zh-cn";
export declare const TOKEN_TIMEOUT_MS = 60000;
export declare const OAUTH_CALLBACK_TIMEOUT_MS = 180000;
export declare const MIN_CALLBACK_PORT = 10000;
export declare const LEGACY_POLL_ATTEMPTS = 60;
export interface DpopKeyPair {
    privateKeyJwk: JsonWebKey;
    publicKeyJwk: JsonWebKey;
}
/** The full credential persisted after a successful web login. */
export interface WebCredential {
    access_key_id: string;
    secret_access_key: string;
    security_token: string;
    expires_at: string;
    refresh_token?: string;
    code_verifier?: string;
    dpop_private_key_jwk?: JsonWebKey;
    /** Web user token (X-Auth-Token) when the portal/STS returns one. */
    user_token?: string;
    token_type?: string;
    domain_id?: string;
    user_id?: string;
    user_name?: string;
}
export interface OAuthFlow {
    loginUrl: string;
    result: Promise<{
        credential: WebCredential;
        loginUrl: string;
    }>;
    close: () => Promise<void>;
}
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
/** PKCE pair: random verifier + S256 challenge. */
export declare function generatePkcePair(): Promise<{
    codeVerifier: string;
    codeChallenge: string;
}>;
/** Fresh ES256 (P-256) DPoP key pair as JWKs. */
export declare function generateDpopKeyPair(): Promise<DpopKeyPair>;
export declare function keyPairFromStoredJwk(jwk: JsonWebKey): DpopKeyPair;
/** Sign a `dpop+jwt` proof (htm=method, htu=URL). */
export declare function signDpopJws(keyPair: DpopKeyPair, htm: string, htu: string): Promise<string>;
/** Normalize the STS token response into the persisted web credential. */
export declare function credentialFromTokenResponse(token: unknown, codeVerifier: string, keyPair: DpopKeyPair): WebCredential;
/** POST the STS token endpoint with a DPoP proof. */
export declare function requestToken(body: Record<string, string>, keyPair: DpopKeyPair, fetcher?: Fetcher): Promise<Record<string, unknown>>;
export declare function exchangeAuthorizationCode(code: string, codeVerifier: string, port: number, keyPair: DpopKeyPair, fetcher?: Fetcher): Promise<Record<string, unknown>>;
export declare function exchangeRefreshToken(refreshToken: string, codeVerifier: string, keyPair: DpopKeyPair, fetcher?: Fetcher): Promise<Record<string, unknown>>;
/** Refresh a stored web credential, reusing its verifier + DPoP key. */
export declare function refreshWebCredential(cred: WebCredential, fetcher?: Fetcher): Promise<WebCredential>;
export declare function buildOAuthLoginUrl(port: number, pkce: {
    codeChallenge: string;
}, ticketId: string): string;
/** Normalize a legacy ticket/credential response. */
export declare function parseLegacyCredential(data: unknown): WebCredential | null;
/** Poll the legacy ticket endpoint until a credential arrives. */
export declare function pollForCredential(ticketId: string, secret: string, fetcher?: Fetcher): Promise<WebCredential>;
/**
 * Start the web login flow. The caller can open `loginUrl` in a browser; the
 * result resolves after the loopback callback and STS exchange.
 */
export declare function startOAuthFlow(fetcher?: Fetcher): Promise<OAuthFlow>;
/** Open a URL in the user's browser; failures are non-fatal. */
export declare function openBrowser(url: string): boolean;
export {};
