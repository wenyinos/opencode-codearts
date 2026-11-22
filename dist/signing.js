// Huawei Cloud SDK-HMAC-SHA256 request signing, implemented with the runtime's
// built-in WebCrypto so the plugin needs no crypto dependency.
//
// The canonical request layout mirrors the Huawei SDK:
//
//   HTTP_METHOD\n
//   CanonicalURI\n
//   CanonicalQueryString\n
//   CanonicalHeaders\n
//   SignedHeaders\n
//   HexEncode(SHA-256(RequestPayload))
//
// The CodeArts gateway accepts a permanent AK/SK pair without a security token;
// temporary STS credentials additionally send X-Security-Token.
// ---------------------------------------------------------------------------
// Small crypto helpers
// ---------------------------------------------------------------------------
function subtle() {
    const crypto = globalThis.crypto;
    if (!crypto?.subtle) {
        throw new Error("CodeArts: WebCrypto (globalThis.crypto.subtle) is unavailable");
    }
    return crypto.subtle;
}
/**
 * Copy into a fresh ArrayBuffer-backed view. WebCrypto's `BufferSource` does
 * not accept `Uint8Array<ArrayBufferLike>` (which may be backed by a
 * SharedArrayBuffer), so every input is normalised here.
 */
const typed = (value) => {
    const out = new Uint8Array(value.byteLength);
    out.set(value);
    return out;
};
export const hex = (bytes) => Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
export const utf8 = (value) => typed(new TextEncoder().encode(value));
export async function sha256Hex(data) {
    const digest = await subtle().digest("SHA-256", typed(data));
    return hex(new Uint8Array(digest));
}
export async function hmacSha256Hex(key, data) {
    const cryptoKey = await subtle().importKey("raw", typed(key), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
    const signature = await subtle().sign("HMAC", cryptoKey, typed(data));
    return hex(new Uint8Array(signature));
}
export function formatDateStamp(date = new Date()) {
    return date
        .toISOString()
        .replace(/[-:]/g, "")
        .replace(/\.\d+Z$/, "Z");
}
export function buildCanonicalRequest(method, uri, query, headers, payloadHash) {
    const signedHeaders = [...headers.keys()].sort();
    const headerLines = signedHeaders.map((key) => `${key}:${headers.get(key) ?? ""}`);
    return [method, uri, query, headerLines.join("\n"), "", signedHeaders.join(";"), payloadHash].join("\n");
}
/**
 * Sign one request. The returned headers already carry the exact values that
 * were hashed, so the caller must send them verbatim.
 */
export async function signRequestHuawei(input) {
    const url = new URL(input.url);
    let uri = url.pathname;
    if (!uri.endsWith("/"))
        uri += "/";
    const query = url.search.slice(1);
    const method = input.method.toUpperCase();
    const dateStamp = input.dateStamp ?? formatDateStamp();
    const body = input.body ?? new Uint8Array();
    const payloadHash = await sha256Hex(body);
    const headers = new Map();
    headers.set("host", url.host);
    headers.set("x-sdk-date", dateStamp);
    headers.set("x-sdk-content-sha256", payloadHash);
    if (input.securityToken)
        headers.set("x-security-token", input.securityToken);
    for (const [key, value] of Object.entries(input.extraHeaders ?? {})) {
        headers.set(key.toLowerCase(), value);
    }
    if (method !== "GET" && !headers.has("content-type")) {
        headers.set("content-type", "application/json");
    }
    const canonicalRequest = buildCanonicalRequest(method, uri, query, headers, payloadHash);
    const canonicalHash = await sha256Hex(utf8(canonicalRequest));
    const stringToSign = `SDK-HMAC-SHA256\n${dateStamp}\n${canonicalHash}`;
    const signature = await hmacSha256Hex(utf8(input.sk), utf8(stringToSign));
    const signedHeaders = [...headers.keys()].sort();
    headers.set("authorization", `SDK-HMAC-SHA256 Access=${input.ak},SignedHeaders=${signedHeaders.join(";")},Signature=${signature}`);
    const out = {};
    headers.forEach((value, key) => {
        if (key !== "host")
            out[key] = value;
    });
    return { headers: out, canonicalRequest, stringToSign, signature };
}
