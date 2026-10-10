import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

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
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/, {
    message: 'language must be a valid BCP 47 language code (e.g. en-US, es, fr-CA)',
  })
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  speechSpeed?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  sessionMaxSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  sessionIdleTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  cooldownSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailySessionLimit?: number;

  @IsOptional()
  supportedLanguages?: string[] | string;

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
  @Matches(/^[a-zA-Z]{2,3}(-[a-zA-Z0-9]{2,4})?$/, {
    message: 'language must be a valid BCP 47 language code (e.g. en-US, es, fr-CA)',
  })
  language?: string;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  tone?: string;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2.0)
  speechSpeed?: number;

  @IsOptional()
  @IsInt()
  @Min(30)
  @Max(3600)
  sessionMaxSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(10)
  @Max(600)
  sessionIdleTimeoutSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(300)
  cooldownSeconds?: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  dailySessionLimit?: number;

  @IsOptional()
  supportedLanguages?: string[] | string;

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
  speechSpeed: number;
  sessionMaxSeconds: number;
  sessionIdleTimeoutSeconds: number;
  cooldownSeconds: number;
  dailySessionLimit: number;
  supportedLanguages: string[];
  version: number;
  isOverridden: boolean;
  publishedAt: string;
};
