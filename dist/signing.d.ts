export declare const hex: (bytes: Uint8Array) => string;
export declare const utf8: (value: string) => Uint8Array<ArrayBuffer>;
export declare function sha256Hex(data: Uint8Array): Promise<string>;
export declare function hmacSha256Hex(key: Uint8Array, data: Uint8Array): Promise<string>;
export interface SignRequestInput {
    ak: string;
    sk: string;
    /** Only for temporary credentials. Permanent AK/SK leaves this empty. */
    securityToken?: string;
    method: string;
    url: string;
    body?: Uint8Array;
    /** Extra headers that must participate in the signature (e.g. content-type). */
    extraHeaders?: Record<string, string>;
    /** Fixed timestamp for deterministic tests; defaults to "now". */
    dateStamp?: string;
}
export interface SignedRequest {
    /** Headers to send upstream. `host` is omitted (fetch sets it itself). */
    headers: Record<string, string>;
    canonicalRequest: string;
    stringToSign: string;
    signature: string;
}
export declare function formatDateStamp(date?: Date): string;
export declare function buildCanonicalRequest(method: string, uri: string, query: string, headers: Map<string, string>, payloadHash: string): string;
/**
 * Sign one request. The returned headers already carry the exact values that
 * were hashed, so the caller must send them verbatim.
 */
export declare function signRequestHuawei(input: SignRequestInput): Promise<SignedRequest>;
