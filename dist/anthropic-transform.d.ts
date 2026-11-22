export type AnthropicContentBlock = {
    type: "text";
    text: string;
    cache_control?: unknown;
} | {
    type: "image";
    source: {
        type: "base64";
        media_type: string;
        data: string;
    };
    cache_control?: unknown;
} | {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
    cache_control?: unknown;
} | {
    type: "tool_result";
    tool_use_id: string;
    content: string | AnthropicContentBlock[];
    is_error?: boolean;
    cache_control?: unknown;
} | {
    type: "thinking";
    thinking: string;
    signature?: string;
};
export type AnthropicMessage = {
    role: "user" | "assistant";
    content: string | AnthropicContentBlock[];
};
export type AnthropicRequest = {
    model: string;
    system?: string | Array<{
        type: "text";
        text: string;
        cache_control?: unknown;
    }>;
    messages: AnthropicMessage[];
    max_tokens: number;
    temperature?: number;
    top_p?: number;
    stop_sequences?: string[];
    stream?: boolean;
    tools?: Array<{
        name: string;
        description?: string;
        input_schema: Record<string, unknown>;
        cache_control?: unknown;
    }>;
    tool_choice?: unknown;
    thinking?: {
        type: string;
        budget_tokens?: number;
    };
};
export type AnthropicResponse = {
    id: string;
    type: "message";
    role: "assistant";
    content: AnthropicContentBlock[];
    model: string;
    stop_reason: string | null;
    stop_sequence: string | null;
    usage: {
        input_tokens: number;
        output_tokens: number;
        cache_read_input_tokens?: number;
        cache_creation_input_tokens?: number;
    };
};
type OpenAIChatMessage = {
    role: "system" | "user" | "assistant" | "tool";
    content?: string | Array<{
        type: "text";
        text: string;
    } | {
        type: "image_url";
        image_url: {
            url: string;
        };
    }> | null;
    name?: string;
    reasoning_content?: string;
    tool_calls?: Array<{
        id: string;
        type: "function";
        function: {
            name: string;
            arguments: unknown;
        };
    }>;
    tool_call_id?: string;
};
type OpenAIChatRequest = {
    model: string;
    messages: OpenAIChatMessage[];
    max_tokens?: number;
    temperature?: number;
    top_p?: number;
    stop?: string | string[];
    stream?: boolean;
    stream_options?: {
        include_usage: boolean;
    };
    tools?: Array<{
        type: "function";
        function: {
            name: string;
            description?: string;
            parameters?: Record<string, unknown>;
        };
    }>;
    tool_choice?: unknown;
    reasoning_effort?: "low" | "medium" | "high";
};
type OpenAIChatResponse = {
    id: string;
    model: string;
    choices: Array<{
        message: {
            role: string;
            content: string | null;
            tool_calls?: Array<{
                id: string;
                type: "function";
                function: {
                    name: string;
                    arguments: string;
                };
            }>;
            reasoning_content?: string;
            reasoning?: string;
        };
        finish_reason: string | null;
    }>;
    usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
        prompt_tokens_details?: {
            cached_tokens?: number;
        };
    };
};
export declare function anthropicToOpenaiChat(body: AnthropicRequest): OpenAIChatRequest;
/** The tool name an Anthropic `{type:"tool"}` choice pins the model to, if any. */
export declare function forcedToolName(choice: unknown): string | null;
export declare function convertToolChoice(choice: unknown): unknown;
export declare function openaiChatToAnthropic(response: OpenAIChatResponse, model: string): AnthropicResponse;
export declare function openaiChatStreamToAnthropic(upstream: ReadableStream<Uint8Array>, model: string, onUpstreamChunk?: () => void): ReadableStream<Uint8Array>;
export {};
