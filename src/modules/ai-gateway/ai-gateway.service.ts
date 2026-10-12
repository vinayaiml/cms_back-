import { Injectable, Optional } from "@nestjs/common";
import { AuditService } from "../audit/audit.service";
import {
  AiProviderClient,
  AiProviderMessage,
  AiProviderToolCall,
} from "./ai-provider.client";
import { RobotAiConversationDto } from "./ai-gateway.dto";
import { AiToolRegistryService } from "./ai-tool-registry.service";
import { redactText, redactValue } from "./ai-redaction";
import { ConversationConfigService } from "../conversation-config/conversation-config.service";

type ConversationInput = {
  robotId: number;
  orgId: number;
  body: RobotAiConversationDto;
  correlationId?: string | null;
};

const OUT_OF_SCOPE_REFUSAL =
  "I can only answer questions using the approved event and organization information.";

type PreparedConversation = {
  message: string;
  conversation: any;
  toolDefinitions: ReturnType<AiToolRegistryService["toolDefinitions"]>;
  outOfContext: boolean;
  policyAction: "answer" | "redirect" | "refuse";
  /** Org policy for out-of-scope requests; applied only when the model tags the answer [[scope:out]]. */
  configuredPolicy: "answer" | "redirect" | "refuse";
};

type StreamScopeState = {
  index: number;
  outOfContext?: boolean;
  refused: boolean;
};

type SafeToolResult = {
  name: string;
  status: "completed" | "rejected";
  result?: unknown;
  message?: string;
};

@Injectable()
export class AiGatewayService {
  constructor(
    private provider: AiProviderClient,
    private tools: AiToolRegistryService,
    private audit: AuditService,
    @Optional()
    private conversationConfig?: ConversationConfigService,
  ) {}

  async converse(input: ConversationInput) {
    const prepared = await this.prepare(input);

    const explicitTool = input.body.requestedTool;
    if (explicitTool) {
      const toolResult = await this.executeToolSafely(input, explicitTool);
      return this.response({
        message:
          toolResult.status === "rejected"
            ? "I cannot use that tool for this request."
            : "Tool request completed.",
        fallback: false,
        toolResults: [toolResult],
        outOfContext: prepared.outOfContext,
        policyAction: prepared.policyAction,
      });
    }


    const messages: AiProviderMessage[] = [
        {
          role: "system",
          content: this.buildSystemPrompt(
            prepared.conversation,
            prepared.configuredPolicy,
          ),
        },
        {
          role: "user",
          content: prepared.message,
        },
      ];
    const providerResult = await this.provider.complete(
      messages,
      prepared.toolDefinitions,
    );

    const toolRound = await this.runProviderToolRound(
      input,
      messages,
      providerResult.toolCalls,
      prepared.toolDefinitions,
    );
    const finalContent = toolRound.providerContent ?? providerResult.content;

    return this.response({
      message: redactText(finalContent),
      fallback: Boolean(providerResult.fallback || toolRound.fallback),
      fallbackReason: providerResult.reason ?? toolRound.fallbackReason,
      toolResults: toolRound.toolResults,
      outOfContext: prepared.outOfContext,
      policyAction: prepared.policyAction,
      configuredPolicy: prepared.configuredPolicy,
    });
  }

  async *streamEvents(input: ConversationInput) {
    const prepared = await this.prepare(input);
    const explicitTool = input.body.requestedTool;
    if (explicitTool) {
      const toolResult = await this.executeToolSafely(input, explicitTool);
      yield { type: "tool", data: toolResult };
      yield {
        type: "sentence",
        data: this.sentenceEvent(
          toolResult.status === "rejected"
            ? "I cannot use that tool for this request."
            : "Tool request completed.",
          0,
        ),
      };
      yield {
        type: "done",
        data: {
          outOfContext: prepared.outOfContext,
          policyAction: prepared.policyAction,
          fallback: false,
        },
      };
      return;
    }


    let fallback = false;
    let fallbackReason: string | undefined;
    let sentAnySentence = false;
    const scope: StreamScopeState = { index: 0, refused: false };
    const messages: AiProviderMessage[] = [
        {
          role: "system",
          content: this.buildSystemPrompt(
            prepared.conversation,
            prepared.configuredPolicy,
          ),
        },
        { role: "user", content: prepared.message },
      ];
    const toolResults: SafeToolResult[] = [];
    for await (const event of this.provider.streamComplete(
      messages,
      prepared.toolDefinitions,
    )) {
      if (event.type === "sentence") {
        sentAnySentence = true;
        yield* this.streamSentence(event.text, scope, prepared.configuredPolicy);
        continue;
      }

      fallback = event.fallback;
      fallbackReason = event.reason;
      if (fallback && !sentAnySentence) {
        yield {
          type: "sentence",
          data: this.sentenceEvent(
            "I cannot connect to the assistant right now. Please try again later.",
            scope.index++,
          ),
        };
      }
      for (const toolCall of event.toolCalls) {
        const toolResult = await this.executeProviderTool(input, toolCall);
        toolResults.push(toolResult);
        yield { type: "tool", data: toolResult };
      }
      if (event.toolCalls.length) {
        for await (const secondEvent of this.provider.streamComplete(
          this.messagesWithToolResults(messages, event.toolCalls, toolResults),
          prepared.toolDefinitions,
        )) {
          if (secondEvent.type === "sentence") {
            yield* this.streamSentence(secondEvent.text, scope, prepared.configuredPolicy);
          } else {
            fallback = fallback || secondEvent.fallback;
            fallbackReason = fallbackReason ?? secondEvent.reason;
          }
        }
      }
    }

    yield {
      type: "done",
      data: {
        outOfContext: scope.outOfContext ?? prepared.outOfContext,
        policyAction: scope.refused
          ? "refuse"
          : scope.outOfContext
            ? prepared.configuredPolicy
            : "answer",
        fallback,
        ...(fallbackReason ? { fallbackReason } : {}),
      },
    };
  }

  private async executeToolSafely(
    input: ConversationInput,
    toolCall: { name: string; arguments?: Record<string, unknown> },
  ) {
    try {
      const result = await this.tools.execute({
        robotId: input.robotId,
        orgId: input.orgId,
        name: toolCall.name,
        arguments: toolCall.arguments,
        correlationId: input.correlationId,
      });
      return {
        name: toolCall.name,
        status: "completed" as const,
        result: redactValue(result),
      };
    } catch {
      return {
        name: toolCall.name,
        status: "rejected" as const,
        message: "I cannot use that tool for this request.",
      };
    }
  }

  private async executeProviderTool(
    input: ConversationInput,
    toolCall: AiProviderToolCall,
  ): Promise<SafeToolResult> {
    return this.executeToolSafely(input, toolCall);
  }

  private async runProviderToolRound(
    input: ConversationInput,
    messages: any[],
    toolCalls: AiProviderToolCall[],
    toolDefinitions: PreparedConversation["toolDefinitions"],
  ) {
    const toolResults: SafeToolResult[] = [];
    if (!toolCalls.length) {
      return { toolResults };
    }
    for (const toolCall of toolCalls) {
      toolResults.push(await this.executeProviderTool(input, toolCall));
    }
    const second = await this.provider.complete(
      this.messagesWithToolResults(messages, toolCalls, toolResults),
      toolDefinitions,
    );
    return {
      providerContent: second.content,
      fallback: Boolean(second.fallback),
      fallbackReason: second.reason,
      toolResults,
    };
  }

  private messagesWithToolResults(
    messages: any[],
    toolCalls: AiProviderToolCall[],
    toolResults: SafeToolResult[],
  ) {
    const assistantToolCalls = toolCalls.map((toolCall, index) => ({
      id: toolCall.id ?? `tool-call-${index}`,
      type: "function" as const,
      function: {
        name: toolCall.name,
        arguments: JSON.stringify(toolCall.arguments ?? {}),
      },
    }));
    return [
      ...messages,
      {
        role: "assistant",
        content: "",
        tool_calls: assistantToolCalls,
      },
      ...toolResults.map((result, index) => ({
        role: "tool",
        tool_call_id: assistantToolCalls[index]?.id ?? `tool-call-${index}`,
        content: JSON.stringify(redactValue(result)),
      })),
    ];
  }

  private buildSystemPrompt(conversation: any, policyAction: string) {
    const approvedContext = conversation?.approvedContext ?? {};
    const contexts = Array.isArray(approvedContext.contexts)
      ? approvedContext.contexts
      : [];
    const approvedQa = Array.isArray(approvedContext.approvedQa)
      ? approvedContext.approvedQa
      : [];

    return [
      "You are the WhizRobot CMS assistant gateway.",
      "For each answer, internally classify whether the request is in approved scope. If relevant, prefix exactly one hidden tag [[scope:in]] or [[scope:out]].",
      "Answer in one to three short spoken sentences.",
      "Do not expose secrets, tokens, personal data, provider URLs, database data, camera records or motor commands.",
      `Persona: ${conversation?.personaName ?? "WhizRobot Assistant"}.`,
      `Tone: ${conversation?.tone ?? "helpful"}. Language: ${conversation?.language ?? "en"}.`,
      `Persona prompt: ${conversation?.personaPrompt ?? ""}`,
      `Out-of-context policy action: ${policyAction}.`,
      `Approved context: ${JSON.stringify(redactValue(contexts)).slice(0, 4000)}`,
      `Approved Q&A: ${JSON.stringify(redactValue(approvedQa)).slice(0, 4000)}`,
    ].join("\n");
  }

  private isOutOfContext(message: string, conversation: any) {
    if (this.isAlwaysInScopeUtterance(message)) return false;
    const approvedContext = conversation?.approvedContext ?? {};
    const haystack = JSON.stringify([
      conversation?.personaName,
      conversation?.personaPrompt,
      approvedContext.contexts,
      approvedContext.approvedQa,
    ]).toLowerCase();
    const words = message
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length >= 4);
    if (!words.length) return false;
    return !words.some((word) => haystack.includes(word));
  }

  private isAlwaysInScopeUtterance(message: string) {
    const normalized = message.trim().toLowerCase();
    if (/^(hi|hello|hey|namaste|good morning|good afternoon|good evening)\b/.test(normalized)) {
      return true;
    }
    return /\b(book|appointment|schedule|meet|meeting|available|availability|today|tomorrow|\d{4}-\d{2}-\d{2})\b/.test(normalized);
  }

  private outOfContextPolicy(conversation: any): "answer" | "redirect" | "refuse" {
    const configured =
      conversation?.policies?.outOfContext?.action ??
      conversation?.outOfContextPolicyAction;
    if (configured === "redirect" || configured === "refuse") return configured;
    return "answer";
  }

  private defaultConversation() {
    return {
      personaName: "WhizRobot Assistant",
      personaPrompt: "Use only approved CMS context and registered tools.",
      tone: "helpful",
      language: "en",
      approvedContext: { contexts: [], approvedQa: [] },
      policies: { outOfContext: { action: "answer" } },
    };
  }

  private async prepare(input: ConversationInput): Promise<PreparedConversation> {
    const message = redactText(input.body.message);
    const contextReferences = redactValue(input.body.contextReferences ?? {});
    const conversation = this.conversationConfig
      ? await this.conversationConfig.resolveForRobot(input.robotId)
      : this.defaultConversation();
    const permittedToolNames =
      typeof (this.tools as any).permittedToolNames === "function"
        ? await this.tools.permittedToolNames(input.robotId, input.orgId)
        : [];
    const toolDefinitions =
      typeof (this.tools as any).toolDefinitions === "function"
        ? this.tools.toolDefinitions(permittedToolNames)
        : [];
    const outOfContext = this.isOutOfContext(message, conversation);
    const policyAction = outOfContext
      ? this.outOfContextPolicy(conversation)
      : "answer";

    void this.audit.recordBestEffort({
      actor: { userId: null, orgId: input.orgId, isSuperAdmin: false },
      action: "ai.conversation.requested",
      targetType: "robot",
      targetId: input.robotId,
      targetOrgId: input.orgId,
      correlationId: input.correlationId,
      metadata: {
        inputMode: input.body.inputMode ?? "text",
        messageLength: redactText(message).length,
        contextReferences,
      } as any,
    });

    return {
      message,
      conversation,
      toolDefinitions,
      outOfContext,
      policyAction,
      configuredPolicy: this.outOfContextPolicy(conversation),
    };
  }

  private response(input: {
    message: string;
    fallback: boolean;
    fallbackReason?: string;
    toolResults: unknown[];
    outOfContext: boolean;
    policyAction: "answer" | "redirect" | "refuse";
    configuredPolicy?: "answer" | "redirect" | "refuse";
  }) {
    const decision = this.scopeDecision(
      input.message,
      input.outOfContext,
      input.configuredPolicy ?? "answer",
    );
    return {
      schemaVersion: 1,
      message: decision.content,
      outOfContext: decision.outOfContext,
      policyAction: decision.policyAction,
      fallback: input.fallback,
      ...(input.fallbackReason ? { fallbackReason: input.fallbackReason } : {}),
      toolResults: input.toolResults,
    };
  }

  /**
   * The model tags each answer [[scope:in]] / [[scope:out]]; the tag is never spoken.
   * Out of scope + "refuse" policy -> refusal line. No tag -> keyword hint only, never a refusal.
   */
  private scopeDecision(
    text: string,
    keywordOutOfContext: boolean,
    configuredPolicy: "answer" | "redirect" | "refuse",
  ): { content: string; outOfContext: boolean; policyAction: "answer" | "redirect" | "refuse" } {
    const scoped = this.stripScopeTag(text);
    if (scoped.outOfContext === undefined) {
      return { content: scoped.content, outOfContext: keywordOutOfContext, policyAction: "answer" };
    }
    if (scoped.outOfContext && configuredPolicy === "refuse") {
      return { content: OUT_OF_SCOPE_REFUSAL, outOfContext: true, policyAction: "refuse" };
    }
    return {
      content: scoped.content,
      outOfContext: scoped.outOfContext,
      policyAction: scoped.outOfContext ? configuredPolicy : "answer",
    };
  }

  /** Strips the scope tag from a streamed sentence and applies the refuse policy once. */
  private streamSentence(
    raw: string,
    state: StreamScopeState,
    configuredPolicy: "answer" | "redirect" | "refuse",
  ): Array<{ type: "sentence"; data: ReturnType<AiGatewayService["sentenceEvent"]> }> {
    if (state.refused) return [];
    const scoped = this.stripScopeTag(raw);
    if (state.outOfContext === undefined && scoped.outOfContext !== undefined) {
      state.outOfContext = scoped.outOfContext;
      if (scoped.outOfContext && configuredPolicy === "refuse") {
        state.refused = true;
        return [{ type: "sentence", data: this.sentenceEvent(OUT_OF_SCOPE_REFUSAL, state.index++) }];
      }
    }
    if (!scoped.content) return [];
    return [{ type: "sentence", data: this.sentenceEvent(redactText(scoped.content), state.index++) }];
  }

  private stripScopeTag(value: string) {
    const trimmed = value.trim();
    const match = trimmed.match(/^\[\[scope:(in|out)\]\]\s*/i);
    if (!match) return { content: trimmed };
    return {
      content: trimmed.slice(match[0].length).trim(),
      outOfContext: match[1].toLowerCase() === "out",
    };
  }

  private sentenceEvent(text: string, index: number) {
    return {
      index,
      text,
      emotion: "neutral",
    };
  }
}
