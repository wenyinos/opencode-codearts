import type { Fetcher } from "./http.js";
export declare const KEY_EXCHANGE_PATH = "/api/v1/security/key-exchange";
export declare const ENCRYPT_ALGO = "sm4-gcm";
export interface TransportCredentials {
    ak: string;
    sk: string;
    securityToken?: string;
}
export interface SessionKey {
    keyId: string;
    key: Uint8Array;
    expiresAt: number;
}
/** Opt-in switch; plaintext remains the default. */
export declare function transportEncryptEnabled(env?: NodeJS.ProcessEnv): boolean;
/** Cached keys are refreshed five minutes before the server-side expiry. */
export declare function sessionKeyUsable(key: SessionKey | null, now?: number): boolean;
/**
 * One P-256 ECDH exchange; SHA-256 of the shared secret, truncated to 16 bytes,
 * is the SM4 key. Matches the CLI's `getOrNegotiateKey` request shape.
 */
export declare function negotiateSessionKey(credentials: TransportCredentials, fetcher: Fetcher, baseUrl: string): Promise<SessionKey>;
/**
 * SM4-GCM encrypt one request body; AAD mirrors the CLI: method|path|timestamp.
 * The wire body is base64 text (the CLI sends `base64(ciphertext)`).
 */
export declare function encryptChatBody(body: string, key: SessionKey, method: string, pathname: string): {
    body: string;
    headers: Record<string, string>;
};
/** Does this upstream response carry an SM4-GCM encrypted body? */
export declare function isEncryptedResponse(response: Response): boolean;
/**
 * Wrap an encrypted upstream response in a plaintext stream. Frames are
 * authenticated individually; a bad frame fails the stream instead of yielding
 * corrupted SSE to the client.
 */
export declare function decryptResponseStream(response: Response, key: SessionKey): Response;
