export interface BodyNormalization {
    body: Record<string, unknown>;
    changed: boolean;
}
/** Rewrite the object form of tool_choice into the enum the gateway accepts. */
export declare function normalizeOpenAIToolChoice(body: Record<string, unknown>): BodyNormalization;
/** The gateway's Role enum has no "developer"; downgrade it to "system". */
export declare function normalizeOpenAIDeveloperRole(body: Record<string, unknown>): BodyNormalization;
/** Translate the newer `max_completion_tokens` into `max_tokens`. */
export declare function normalizeOpenAIMaxTokens(body: Record<string, unknown>): BodyNormalization;
export declare function normalizeOpenAIReasoningEffort(body: Record<string, unknown>): BodyNormalization;
/** Apply every CodeArts-side rewrite, in a stable order. */
export declare function normalizeOpenAIChatBody(body: Record<string, unknown>): BodyNormalization;
