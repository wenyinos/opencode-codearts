// Turn a transport failure into something the user can act on.
//
// Adapted from opencode-deveco's network-error.ts. The raw error stays in the
// log; this only produces the client-visible hint. CodeArts is always reached
// directly, so the hints talk about DNS/firewall/VPN, not proxies.
const MAX_CAUSE_DEPTH = 5;
function errorText(err) {
    const parts = [];
    let current = err;
    for (let depth = 0; depth < MAX_CAUSE_DEPTH && current; depth++) {
        const candidate = current;
        if (typeof candidate.name === "string")
            parts.push(candidate.name);
        if (typeof candidate.message === "string")
            parts.push(candidate.message);
        if (candidate.code !== undefined)
            parts.push(String(candidate.code));
        current = candidate.cause;
    }
    return parts.join(" | ");
}
function hostOf(url) {
    if (!url)
        return "the CodeArts gateway";
    try {
        return new URL(url).host;
    }
    catch {
        return "the CodeArts gateway";
    }
}
const RULES = [
    {
        pattern: /ENOTFOUND|EAI_AGAIN|getaddrinfo|DNSException|\bDNS\b/i,
        message: (host) => `Cannot resolve the address of ${host} (DNS failure). Check your network connection, DNS settings, and VPN.`,
    },
    {
        pattern: /ECONNREFUSED|ConnectionRefused|Unable to connect|ENETUNREACH|EHOSTUNREACH|ENETDOWN|NetworkUnreachable/i,
        message: (host) => `Cannot reach ${host} (connection refused or network unreachable). Check your network connection, firewall, and VPN.`,
    },
    {
        pattern: /ETIMEDOUT|ESOCKETTIMEDOUT|TimeoutError|operation timed out|Request timeout/i,
        message: (host) => `Connecting to ${host} timed out. Check your network connection and try again.`,
    },
    {
        pattern: /EPROTO|CERT_|SELF_SIGNED|UNABLE_TO_VERIFY|certificate|\bSSL\b|\bTLS\b/i,
        message: (host) => `The TLS connection to ${host} failed (certificate or protocol error). If a firewall intercepts TLS, trust its CA certificate or set NODE_EXTRA_CA_CERTS.`,
    },
    {
        pattern: /ECONNRESET|EPIPE|socket hang up|ERR_STREAM/i,
        message: (host) => `The connection to ${host} was interrupted. Check your network connection, firewall, and VPN.`,
    },
];
/**
 * Returns null when the error is not network related, so callers keep the
 * original text.
 */
export function describeNetworkError(err, url) {
    const text = errorText(err);
    if (!text)
        return null;
    const host = hostOf(url);
    for (const rule of RULES) {
        if (rule.pattern.test(text))
            return rule.message(host);
    }
    return null;
}
