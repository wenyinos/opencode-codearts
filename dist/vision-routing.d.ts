import { type ModelInfo } from "./config.js";
export declare const DEFAULT_VISION_MODEL = "glm-5.3-flash";
export declare const VISION_MODEL_ENV = "CODEARTS_VISION_MODEL";
export interface ImageRoutingResult {
    body: Record<string, unknown>;
    upstreamModel: string;
    rerouted: boolean;
    imagesStripped: boolean;
}
/** Resolve the fallback vision model id (env override wins). */
export declare function visionModelId(env?: NodeJS.ProcessEnv): string;
/** True when the model is known and declares image input. */
export declare function modelSupportsImages(model: string, models?: Record<string, ModelInfo>): boolean;
/** Does one message carry an image part? */
export declare function messageHasImage(message: unknown): boolean;
export declare function anyMessageHasImage(messages: unknown): boolean;
/** Does the newest user message carry an image? */
export declare function newestUserMessageHasImage(messages: unknown): boolean;
/** Replace image parts with a text placeholder, keeping every other part. */
export declare function stripImages(messages: unknown): unknown[];
/**
 * Apply the fallback. Returns null when no rewrite is needed (known vision
 * model, unknown model, or no images at all).
 */
export declare function applyVisionRouting(body: Record<string, unknown>, env?: NodeJS.ProcessEnv): ImageRoutingResult | null;
