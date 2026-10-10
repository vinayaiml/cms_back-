import {
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
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
