import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from "class-validator";

export class UpsertConversationConfigDto {
  @IsOptional()
  @IsString()
  @MaxLength(80)
  personaName?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(1200)
  personaPrompt?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(280)
  greetingText?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  voiceStyle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  language?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  tone?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(8)
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/)
  defaultLanguage?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(8)
  @IsString({ each: true })
  @MaxLength(8, { each: true })
  @Matches(/^[a-z]{2}(-[A-Z]{2})?$/, { each: true })
  supportedLanguages?: string[] | null;

  @IsOptional()
  @IsNumber()
  @Min(0.5)
  @Max(2)
  speechSpeed?: number | null;

  @IsOptional()
  @IsInt()
  @Min(60)
  @Max(3600)
  sessionMaxSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(900)
  sessionIdleTimeoutSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(600)
  cooldownSeconds?: number | null;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  dailySessionLimit?: number | null;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpsertConversationContextDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9._-]+$/)
  stableKey!: string;

  @IsString()
  @MaxLength(40)
  @Matches(/^[A-Z_]+$/)
  contextType!: string;

  @IsString()
  @MaxLength(120)
  title!: string;

  @IsString()
  @MaxLength(2000)
  body!: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}

export class UpsertApprovedQaDto {
  @IsString()
  @MaxLength(80)
  @Matches(/^[a-z0-9._-]+$/)
  stableKey!: string;

  @IsString()
  @MaxLength(280)
  question!: string;

  @IsString()
  @MaxLength(1200)
  answer!: string;

  @IsOptional()
  @IsBoolean()
  publish?: boolean;
}
