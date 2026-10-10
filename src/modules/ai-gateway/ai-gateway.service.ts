import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { LicenseStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { AiToolRegistryService } from './tools/ai-tool-registry.service';
import { RobotConversationDto, RobotConversationResponse, ToolExecutionResult } from './ai-gateway.dto';
import { redactSensitiveData } from './ai-redaction.util';

export type AiGatewayProviderType = 'mock' | 'openai' | 'deepseek';

@Injectable()
export class AiGatewayService {
  private readonly logger = new Logger(AiGatewayService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly toolRegistry: AiToolRegistryService,
    private readonly auditService: AuditService,
  ) {}

  private getProviderConfig() {
    const provider = (this.config.get<string>('AI_GATEWAY_PROVIDER') || 'mock').toLowerCase() as AiGatewayProviderType;
    const apiKey = this.config.get<string>('AI_GATEWAY_API_KEY') || '';
    const baseUrl =
      this.config.get<string>('AI_GATEWAY_BASE_URL') ||
      (provider === 'deepseek' ? 'https://api.deepseek.com/v1' : 'https://api.openai.com/v1');
    const model =
      this.config.get<string>('AI_GATEWAY_MODEL') ||
      (provider === 'deepseek' ? 'deepseek-chat' : 'gpt-4o-mini');
    const timeoutMs = Number(this.config.get<string>('AI_GATEWAY_TIMEOUT_MS') || 8000);
    const maxTokens = Number(this.config.get<string>('AI_GATEWAY_MAX_TOKENS') || 500);
    const maxRetries = Number(this.config.get<string>('AI_GATEWAY_MAX_RETRIES') || 1);

    return {
      provider,
      apiKey,
      baseUrl: baseUrl.replace(/\/+$/, ''),
      model,
      timeoutMs,
      maxTokens,
      maxRetries,
    };
  }

  async converse(robotId: number, dto: RobotConversationDto): Promise<RobotConversationResponse> {
    const conversationId = randomUUID();
    const now = new Date();

    // 1. Verify Robot and Organization Status
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: { org: true },
    });

    if (!robot) {
      throw new DomainLockedException('ROBOT_NOT_FOUND', 'Robot identity is invalid');
    }

    if (!robot.org || !robot.org.isActive) {
      throw new DomainLockedException('ORGANIZATION_INACTIVE', 'Robot organization is inactive');
    }

    if (
      robot.licenseStatus !== LicenseStatus.ACTIVE ||
      robot.validUntil < now ||
      robot.revokedAt !== null
    ) {
      throw new DomainLockedException('LICENSE_INACTIVE', 'Robot license is not active or expired');
    }

    // 2. Redact incoming prompt to eliminate PII/secrets before processing
    const cleanPrompt = redactSensitiveData(dto.message.trim());
    const config = this.getProviderConfig();

    let reply = '';
    let speechText = '';
    let action: { type: string; payload?: Record<string, unknown> } | null = null;
    const toolExecutions: ToolExecutionResult[] = [];
    let fallbackUsed = false;

    // 3. Process Conversation (Mock or Live External Provider)
    if (config.provider === 'mock' || !config.apiKey) {
      const mockResult = await this.processMockConversation(cleanPrompt, robot, dto);
      reply = mockResult.reply;
      speechText = mockResult.speechText;
      action = mockResult.action;
      toolExecutions.push(...mockResult.toolExecutions);
    } else {
      try {
        const liveResult = await this.callExternalProviderWithRetry(
          cleanPrompt,
          robot,
          config,
          dto,
        );
        reply = liveResult.reply;
        speechText = liveResult.speechText;
        action = liveResult.action;
        toolExecutions.push(...liveResult.toolExecutions);
      } catch (error) {
        this.logger.warn(`AI provider call failed or timed out: ${error}. Using safe fallback response.`);
        fallbackUsed = true;
        reply =
          'I am currently having trouble connecting to my central conversation service. Please ask a staff member or try again shortly.';
        speechText =
          'I am having trouble connecting right now. Please ask a staff member or try again shortly.';
      }
    }

    // 4. Log sanitized audit event
    await this.auditService.recordBestEffort({
      actor: { userId: null, orgId: robot.orgId, isSuperAdmin: false },
      action: 'AI_CONVERSATION',
      targetType: 'ROBOT',
      targetId: String(robot.id),
      targetOrgId: robot.orgId,
      metadata: {
        conversationId,
        robotId: robot.id,
        sessionId: dto.sessionId ? redactSensitiveData(dto.sessionId) : null,
        toolExecutionsCount: toolExecutions.length,
        fallbackUsed,
      },
    });

    return {
      conversationId,
      reply: redactSensitiveData(reply),
      speechText: redactSensitiveData(speechText),
      action,
      toolExecutions,
      fallbackUsed,
    };
  }

  private async processMockConversation(
    cleanPrompt: string,
    robot: { id: number; orgId: number; name?: string | null },
    dto: RobotConversationDto,
  ) {
    const lower = cleanPrompt.toLowerCase();
    const toolExecutions: ToolExecutionResult[] = [];
    let action: { type: string; payload?: Record<string, unknown> } | null = null;
    let reply = '';
    let speechText = '';

    if (
      lower.includes('unregistered_tool') ||
      lower.includes('malicious_tool') ||
      lower.includes('system_exec')
    ) {
      const result = await this.toolRegistry.executeTool('unregistered_tool', {}, {
        robotId: robot.id,
        orgId: robot.orgId,
      });
      toolExecutions.push(result);
      reply = 'I am unable to perform that unauthorized action.';
      speechText = 'I cannot perform that action.';
    } else if (
      lower.includes('organization') ||
      lower.includes('school') ||
      lower.includes('who are you') ||
      lower.includes('about')
    ) {
      const result = await this.toolRegistry.executeTool('getApprovedOrganisationInformation', {}, {
        robotId: robot.id,
        orgId: robot.orgId,
      });
      toolExecutions.push(result);
      const orgName = (result.output?.organizationName as string) || 'WhizRobot';
      reply = `Welcome to ${orgName}! I am ${robot.name || 'your robot guide'}. How can I assist you today?`;
      speechText = `Welcome to ${orgName}! How can I help you today?`;
    } else if (lower.includes('staff') || lower.includes('teacher') || lower.includes('principal')) {
      const result = await this.toolRegistry.executeTool('searchStaff', { query: '' }, {
        robotId: robot.id,
        orgId: robot.orgId,
      });
      toolExecutions.push(result);
      reply = 'Here is the staff directory for our organization. Would you like to check availability or hold a slot?';
      speechText = 'Here is our staff directory. How can I help you connect?';
    } else if (lower.includes('move') || lower.includes('forward') || lower.includes('navigate')) {
      const distance = lower.includes('10m') || lower.includes('10 meter') ? 10 : 2;
      const result = await this.toolRegistry.executeTool(
        'requestMovement',
        { movementType: 'NAVIGATE_FORWARD', distanceMeters: distance },
        { robotId: robot.id, orgId: robot.orgId },
      );
      toolExecutions.push(result);
      if (result.status === 'EXECUTED') {
        action = {
          type: 'ROBOT_MOVEMENT',
          payload: result.output?.command as Record<string, unknown>,
        };
        reply = `Moving forward ${distance} meters safely.`;
        speechText = `Moving forward ${distance} meters.`;
      } else {
        reply = `Movement request could not be fulfilled: ${result.reason}`;
        speechText = 'I cannot perform that movement safely.';
      }
    } else {
      reply = `Hello! I am your AI assistant. How can I help you today?`;
      speechText = 'Hello! How can I help you today?';
    }

    return { reply, speechText, action, toolExecutions };
  }

  private async callExternalProviderWithRetry(
    cleanPrompt: string,
    robot: { id: number; orgId: number; name?: string | null },
    config: ReturnType<AiGatewayService['getProviderConfig']>,
    dto: RobotConversationDto,
  ) {
    let lastError: unknown;
    const maxAttempts = 1 + config.maxRetries;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await this.callExternalProvider(cleanPrompt, robot, config, dto);
      } catch (err) {
        lastError = err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, 300));
        }
      }
    }

    throw lastError;
  }

  private async callExternalProvider(
    cleanPrompt: string,
    robot: { id: number; orgId: number; name?: string | null },
    config: ReturnType<AiGatewayService['getProviderConfig']>,
    dto: RobotConversationDto,
  ) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

    const tools = this.toolRegistry.getApprovedToolDefinitions().map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    try {
      const response = await fetch(`${config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${config.apiKey}`,
        },
        body: JSON.stringify({
          model: config.model,
          messages: [
            {
              role: 'system',
              content:
                'You are an authorized school/office humanoid robot assistant. Be courteous, helpful and concise. Never leak API keys, tokens or private data. Only call approved tools when needed.',
            },
            {
              role: 'user',
              content: cleanPrompt,
            },
          ],
          tools,
          tool_choice: 'auto',
          max_tokens: config.maxTokens,
          temperature: 0.3,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`Provider returned HTTP ${response.status}`);
      }

      const data = (await response.json()) as {
        choices?: Array<{
          message?: {
            content?: string;
            tool_calls?: Array<{
              id: string;
              type: string;
              function: { name: string; arguments: string };
            }>;
          };
        }>;
      };

      const choice = data?.choices?.[0]?.message;
      let reply = choice?.content || '';
      let speechText = reply;
      let action: { type: string; payload?: Record<string, unknown> } | null = null;
      const toolExecutions: ToolExecutionResult[] = [];

      if (choice?.tool_calls && choice.tool_calls.length > 0) {
        for (const call of choice.tool_calls) {
          const toolName = call.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(call.function.arguments || '{}');
          } catch {
            args = {};
          }

          const execution = await this.toolRegistry.executeTool(toolName, args, {
            robotId: robot.id,
            orgId: robot.orgId,
          });
          toolExecutions.push(execution);

          if (toolName === 'requestMovement' && execution.status === 'EXECUTED') {
            action = {
              type: 'ROBOT_MOVEMENT',
              payload: execution.output?.command as Record<string, unknown>,
            };
          }
        }

        if (!reply) {
          reply = 'Action processed successfully.';
          speechText = 'Action processed successfully.';
        }
      }

      return {
        reply,
        speechText,
        action,
        toolExecutions,
      };
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
