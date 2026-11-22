export interface CodeArtsCredentials {
    ak: string;
    sk: string;
    /** Present only for temporary STS credentials. */
    securityToken?: string;
}
export type CredentialSource = "env" | "profile" | "none";
export interface ResolvedCredentials {
    credentials: CodeArtsCredentials | null;
    source: CredentialSource;
    sourceFile?: string;
    missing: string[];
}
export interface CredentialStatus extends ResolvedCredentials {
    configured: boolean;
    akPreview: string;
}
/**
 * The credential pair from the process environment, or null when either half
 * is absent. Both halves are required for signing.
 */
export declare function credentialsFromEnv(env?: NodeJS.ProcessEnv): CodeArtsCredentials | null;
/** The user's login shell name, e.g. "zsh", "bash", "fish". */
export declare function shellName(env?: NodeJS.ProcessEnv): string;
/**
 * Where to look for a shell profile fallback, ordered for the current shell.
 * Every list still ends with the other common profiles: opencode's background
 * service may run under a different shell than the terminal that exported the
 * variables, so stopping at the first shell would miss them.
 */
export declare function profileFiles(env?: NodeJS.ProcessEnv): string[];
/**
 * Extract an assignment from a profile file:
 *   export KEY=value        (sh/zsh/bash)
 *   KEY=value               (sh/zsh/bash)
 *   set -gx KEY value       (fish)
 * Quotes are stripped; a trailing ` # comment` is dropped for unquoted values.
 */
export declare function readProfileAssignment(file: string, key: string): string;
/**
 * Resolve the credential pair: process environment first, then the first
 * profile file that carries the missing half. Set CODEARTS_DISABLE_PROFILE=1
 * to disable the fallback (tests do this).
 */
export declare function resolveCredentials(env?: NodeJS.ProcessEnv): ResolvedCredentials;
/** A non-secret summary for /status and startup logs. */
export declare function credentialStatus(env?: NodeJS.ProcessEnv): CredentialStatus;
/** Mask a secret for logs: first four and last two characters stay visible. */
export declare function maskSecret(value: string): string;
