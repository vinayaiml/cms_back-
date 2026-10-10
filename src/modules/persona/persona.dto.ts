import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertOrganizationPersonaDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  personaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personaPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  greetingText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  speechGreeting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  voiceStyle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tone?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class UpsertRobotPersonaOverrideDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  personaName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  personaPrompt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  greetingText?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  speechGreeting?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  voiceStyle?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tone?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export type EffectivePersonaResponse = {
  schemaVersion: number;
  configVersion: string;
  orgId: number;
  robotId: number;
  personaName: string;
  personaPrompt: string | null;
  greetingText: string;
  speechGreeting: string;
  voiceStyle: string;
  language: string;
  tone: string;
  version: number;
  isOverridden: boolean;
  publishedAt: string;
};
