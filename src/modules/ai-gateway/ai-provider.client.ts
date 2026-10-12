import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { safeAiProviderReference } from "./ai-provider-reference";

export type AiProviderMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_call_id?: string;
  tool_calls?: Array<{
    id: string;
    type: "function";
    function: {
      name: string;
      arguments: string;
    };
  }>;
};

export type AiProviderToolCall = {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
};

export type AiProviderToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type AiProviderResult = {
  content: string;
  toolCalls: AiProviderToolCall[];
  fallback?: boolean;
  reason?: string;
};

export type AiProviderStreamEvent =
  | { type: "sentence"; text: string }
  | { type: "done"; fallback: boolean; reason?: string; toolCalls: AiProviderToolCall[] };

type ProviderOptions = {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs: number;
  maxRetries: number;
  maxInputChars: number;
  maxOutputTokens: number;
  maxEstimatedCostMicroUsd: number | null;
  inputCostMicroUsdPer1kTokens: number;
  outputCostMicroUsdPer1kTokens: number;
};

@Injectable()
export class AiProviderClient {
  constructor(private config: ConfigService) {}

  isConfigured() {
    return Boolean(this.readOptions());
  }

  safeReference() {
    return safeAiProviderReference(this.config);
  }

  async complete(
    messages: AiProviderMessage[],
    tools: AiProviderToolDefinition[] = [],
  ): Promise<AiProviderResult> {
    const options = this.readOptions();
    if (!options) return this.fallback("PROVIDER_NOT_CONFIGURED");

    const inputChars = messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (inputChars > options.maxInputChars) return this.fallback("INPUT_LIMIT");

    if (this.exceedsCostLimit(inputChars, options)) {
      return this.fallback("COST_LIMIT");
    }

    let lastReason = "PROVIDER_UNAVAILABLE";
    for (let attempt = 0; attempt <= options.maxRetries; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
      try {
        const response = await fetch(this.chatUrl(options.baseUrl), {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${options.apiKey}`,
          },
          body: JSON.stringify({
            model: options.model,
            messages,
            ...(tools.length ? { tools, tool_choice: "auto" } : {}),
            max_tokens: options.maxOutputTokens,
            temperature: 0.2,
          }),
        });
        clearTimeout(timeout);

        if (!response.ok) {
          lastReason = response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR";
          continue;
        }

        const body = (await response.json()) as any;
        const message = body?.choices?.[0]?.message ?? {};
        return {
          content:
            typeof message.content === "string"
              ? message.content
              : "I cannot answer that right now.",
          toolCalls: this.parseToolCalls(message.tool_calls),
        };
      } catch (error) {
        clearTimeout(timeout);
        lastReason =
          error instanceof Error && error.name === "AbortError"
            ? "PROVIDER_TIMEOUT"
            : "PROVIDER_UNAVAILABLE";
      }
    }

    return this.fallback(lastReason);
  }

  async *streamComplete(
    messages: AiProviderMessage[],
    tools: AiProviderToolDefinition[] = [],
  ): AsyncGenerator<AiProviderStreamEvent> {
    const options = this.readOptions();
    if (!options) {
      yield this.streamFallback("PROVIDER_NOT_CONFIGURED");
      return;
    }

    const inputChars = messages.reduce(
      (total, message) => total + message.content.length,
      0,
    );
    if (inputChars > options.maxInputChars) {
      yield this.streamFallback("INPUT_LIMIT");
      return;
    }
    if (this.exceedsCostLimit(inputChars, options)) {
      yield this.streamFallback("COST_LIMIT");
      return;
    }

    const controller = new AbortController();
    let abortReason = "PROVIDER_TIMEOUT";
    const firstTokenTimeout = setTimeout(() => {
      abortReason = "FIRST_TOKEN_TIMEOUT";
      controller.abort();
    }, this.getFirstTokenTimeoutMs());
    const requestTimeout = setTimeout(() => {
      abortReason = "PROVIDER_TIMEOUT";
      controller.abort();
    }, this.getStreamTimeoutMs());

    try {
      const response = await fetch(this.chatUrl(options.baseUrl), {
        method: "POST",
        signal: controller.signal,
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: options.model,
          messages,
          ...(tools.length ? { tools, tool_choice: "auto" } : {}),
          max_tokens: options.maxOutputTokens,
          temperature: 0.2,
          stream: true,
        }),
      });

      if (!response.ok || !response.body) {
        yield this.streamFallback(
          response.status === 429 ? "PROVIDER_RATE_LIMIT" : "PROVIDER_ERROR",
        );
        return;
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let receivedFirstToken = false;
      let buffer = "";
      let sentenceBuffer = "";
      const toolCalls = new Map<number, any>();

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";

        for (const rawLine of lines) {
          const line = rawLine.trim();
          if (!line.startsWith("data:")) continue;
          const data = line.slice(5).trim();
          if (!data || data === "[DONE]") continue;

          const parsed = this.parseStreamData(data);
          if (!parsed) continue;
          const delta = parsed?.choices?.[0]?.delta ?? {};
          // Any first chunk (text or tool call) proves the provider is responding.
          if (!receivedFirstToken && (delta.content || delta.tool_calls)) {
            clearTimeout(firstTokenTimeout);
            receivedFirstToken = true;
          }
          if (typeof delta.content === "string" && delta.content.length) {
            sentenceBuffer += delta.content;
            const sentences = this.drainCompleteSentences(sentenceBuffer);
            sentenceBuffer = sentences.remainder;
            for (const sentence of sentences.sentences) {
              yield { type: "sentence", text: sentence };
            }
          }
          this.collectStreamingToolCalls(toolCalls, delta.tool_calls);
        }
      }

      const trailing = sentenceBuffer.trim();
      if (trailing) {
        yield { type: "sentence", text: trailing };
      }
      yield {
        type: "done",
        fallback: false,
        toolCalls: this.parseToolCalls(Array.from(toolCalls.values())),
      };
    } catch (error) {
      yield this.streamFallback(
        error instanceof Error && error.name === "AbortError"
          ? abortReason
          : "PROVIDER_UNAVAILABLE",
      );
    } finally {
      clearTimeout(firstTokenTimeout);
      clearTimeout(requestTimeout);
      // Also runs when the consumer stops early (client disconnected): cancel the provider request.
      controller.abort();
    }
  }

  private readOptions(): ProviderOptions | null {
    const baseUrl = this.config.get<string>("AI_PROVIDER_BASE_URL")?.trim();
    const apiKey = this.config.get<string>("AI_PROVIDER_API_KEY")?.trim();
    const model = this.config.get<string>("AI_PROVIDER_MODEL")?.trim();
    if (!baseUrl || !apiKey || !model) return null;

    return {
      baseUrl,
      apiKey,
      model,
      timeoutMs: this.readPositiveInt("AI_PROVIDER_TIMEOUT_MS", 8000, 1000, 30000),
      maxRetries: this.readPositiveInt("AI_PROVIDER_MAX_RETRIES", 1, 0, 3),
      maxInputChars: this.readPositiveInt("AI_PROVIDER_MAX_INPUT_CHARS", 4000, 1, 12000),
      maxOutputTokens: this.readPositiveInt("AI_PROVIDER_MAX_OUTPUT_TOKENS", 200, 1, 2048),
      maxEstimatedCostMicroUsd: this.readOptionalPositiveInt(
        "AI_PROVIDER_MAX_ESTIMATED_COST_MICRO_USD",
      ),
      inputCostMicroUsdPer1kTokens: this.readPositiveInt(
        "AI_PROVIDER_INPUT_COST_MICRO_USD_PER_1K_TOKENS",
        0,
        0,
        1000000,
      ),
      outputCostMicroUsdPer1kTokens: this.readPositiveInt(
        "AI_PROVIDER_OUTPUT_COST_MICRO_USD_PER_1K_TOKENS",
        0,
        0,
        1000000,
      ),
    };
  }

  private readPositiveInt(
    key: string,
    defaultValue: number,
    min: number,
    max: number,
  ) {
    const raw = this.config.get<string>(key);
    const value = raw ? Number(raw) : defaultValue;
    if (!Number.isInteger(value)) return defaultValue;
    return Math.min(Math.max(value, min), max);
  }

  private readOptionalPositiveInt(key: string) {
    const raw = this.config.get<string>(key);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) return null;
    return value;
  }

  private exceedsCostLimit(inputChars: number, options: ProviderOptions) {
    if (options.maxEstimatedCostMicroUsd === null) return false;

    const estimatedInputTokens = Math.ceil(inputChars / 4);
    const estimatedInputCost = Math.ceil(
      (estimatedInputTokens / 1000) * options.inputCostMicroUsdPer1kTokens,
    );
    const estimatedOutputCost = Math.ceil(
      (options.maxOutputTokens / 1000) * options.outputCostMicroUsdPer1kTokens,
    );

    return (
      estimatedInputCost + estimatedOutputCost >
      options.maxEstimatedCostMicroUsd
    );
  }

  private chatUrl(baseUrl: string) {
    return `${baseUrl.replace(/\/+$/, "")}/chat/completions`;
  }

  getFirstTokenTimeoutMs() {
    return this.readPositiveInt(
      "AI_PROVIDER_FIRST_TOKEN_TIMEOUT_MS",
      5000,
      1000,
      30000,
    );
  }

  getStreamTimeoutMs() {
    return this.readPositiveInt(
      "AI_PROVIDER_STREAM_TIMEOUT_MS",
      45000,
      5000,
      120000,
    );
  }

  private parseToolCalls(value: unknown): AiProviderToolCall[] {
    if (!Array.isArray(value)) return [];
    const calls: AiProviderToolCall[] = [];
    for (const toolCall of value) {
      const fn = (toolCall as any)?.function ?? {};
      const id = typeof (toolCall as any)?.id === "string" ? (toolCall as any).id : undefined;
      const name = typeof fn.name === "string" ? fn.name : "";
      if (!name) continue;

      let args: Record<string, unknown> | undefined;
      if (typeof fn.arguments === "string") {
        try {
          const parsed = JSON.parse(fn.arguments);
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed))
            args = parsed;
        } catch {
          args = {};
        }
      } else if (fn.arguments && typeof fn.arguments === "object") {
        args = fn.arguments;
      }

      calls.push({ id, name, arguments: args });
    }
    return calls;
  }

  private parseStreamData(data: string) {
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  private drainCompleteSentences(value: string) {
    const matches = value.match(/[^.!?]+[.!?]+/g) ?? [];
    const consumed = matches.join("");
    return {
      sentences: matches.map((part) => part.trim()).filter(Boolean),
      remainder: value.slice(consumed.length),
    };
  }

  private collectStreamingToolCalls(
    target: Map<number, any>,
    value: unknown,
  ) {
    if (!Array.isArray(value)) return;
    for (const item of value) {
      const index =
        typeof (item as any)?.index === "number" ? (item as any).index : 0;
      const existing = target.get(index) ?? { function: { name: "", arguments: "" } };
      const fn = (item as any)?.function ?? {};
      if (typeof fn.name === "string") {
        existing.function.name += fn.name;
      }
      if (typeof fn.arguments === "string") {
        existing.function.arguments += fn.arguments;
      }
      target.set(index, existing);
    }
  }

  private streamFallback(reason: string): AiProviderStreamEvent {
    return {
      type: "done",
      fallback: true,
      reason,
      toolCalls: [],
    };
  }

  private fallback(reason: string): AiProviderResult {
    return {
      content:
        "I cannot connect to the assistant right now. Please try again later.",
      toolCalls: [],
      fallback: true,
      reason,
    };
  }
}
