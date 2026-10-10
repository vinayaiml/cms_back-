import { IsNotEmpty, IsObject, IsOptional, IsString, MaxLength } from 'class-validator';

export class RobotConversationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  message!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  sessionId?: string;

  @IsOptional()
  @IsObject()
  contextReferences?: {
    location?: string;
    screen?: string;
    visitorId?: string;
    [key: string]: unknown;
  };
}

export type ToolExecutionResult = {
  toolName: string;
  status: 'EXECUTED' | 'REJECTED';
  reason?: string;
  output?: Record<string, unknown> | null;
};

export type RobotConversationResponse = {
  conversationId: string;
  reply: string;
  speechText: string;
  action: {
    type: string;
    payload?: Record<string, unknown>;
  } | null;
  toolExecutions: ToolExecutionResult[];
  fallbackUsed: boolean;
};
