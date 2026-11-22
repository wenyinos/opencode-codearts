/**
 * Returns null when the error is not network related, so callers keep the
 * original text.
 */
export declare function describeNetworkError(err: unknown, url?: string): string | null;
