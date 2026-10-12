import {
  IsBase64,
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
  MaxLength,
  ValidateNested,
} from "class-validator";
import { Type } from "class-transformer";

export class IdentityConsentDto {
  @IsBoolean()
  granted!: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  source!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  policyVersion!: string;

  @IsDateString()
  grantedAt!: string;
}

export class CreateIdentityEmbeddingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  subjectRef!: string;

  @ValidateNested()
  @Type(() => IdentityConsentDto)
  consent!: IdentityConsentDto;

  @IsObject()
  embeddingMetadata!: Record<string, unknown>;
}

export class UpdateIdentityEmbeddingDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  subjectRef?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => IdentityConsentDto)
  consent?: IdentityConsentDto;

  @IsOptional()
  @IsObject()
  embeddingMetadata?: Record<string, unknown>;
}

export class RevokeIdentityConsentDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string;
}

export class DeleteIdentityEmbeddingDto {
  @IsOptional()
  @IsString()
  @MaxLength(160)
  reason?: string;
}

export class RobotIdentityEmbeddingDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  modelId!: string;

  @IsInt()
  @Min(1)
  dimension!: number;

  @IsBase64()
  @MaxLength(70000)
  vector!: string;
}

export class RobotIdentityEnrollmentDto {
  @ValidateNested()
  @Type(() => IdentityConsentDto)
  consent!: IdentityConsentDto;

  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  subjectRef!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9 ._-]+$/)
  displayName?: string;

  @ValidateNested()
  @Type(() => RobotIdentityEmbeddingDto)
  embedding!: RobotIdentityEmbeddingDto;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @ValidateNested({ each: true })
  @Type(() => RobotIdentityEmbeddingDto)
  templates?: RobotIdentityEmbeddingDto[];
}

export class RobotIdentityTemplateDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  modelId!: string;

  @IsBase64()
  @MaxLength(70000)
  vector!: string;

  @IsInt()
  @Min(1)
  dimension!: number;

  @Min(0)
  @IsNumber()
  qualityScore!: number;

  @Min(0)
  @IsNumber()
  score!: number;

  @Min(0)
  @IsNumber()
  margin!: number;

  @IsInt()
  @Min(1)
  votes!: number;
}

export class RobotIdentityFeedbackDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  identityId?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  modelId!: string;

  @Min(0)
  @IsNumber()
  score!: number;

  @Min(0)
  @IsNumber()
  margin!: number;

  @IsInt()
  @Min(1)
  votes!: number;

  @IsString()
  @IsIn(["confirmed", "rejected", "recovered_missed"])
  outcome!: "confirmed" | "rejected" | "recovered_missed";
}

export class RecognitionModelUploadDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  modelId!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  version!: string;

  @IsBase64()
  @MaxLength(20_000_000)
  fileBase64!: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  license?: string;
}
