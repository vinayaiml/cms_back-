import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class UpsertConversationContextDto {
  @IsOptional()
  @IsString()
  @MaxLength(10000)
  companyOverview?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  operatingHours?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  locationDetails?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  visitorGuidelines?: string;

  @IsOptional()
  @IsString()
  @MaxLength(10000)
  eventsSummary?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;
}

export class ApprovedQaItemDto {
  @IsOptional()
  @IsInt()
  id?: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  question!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  answer!: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class UpsertApprovedQaDto {
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ApprovedQaItemDto)
  items?: ApprovedQaItemDto[];

  // Support single item upsert on the same endpoint
  @IsOptional()
  @IsInt()
  id?: number;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  question?: string;

  @IsOptional()
  @IsString()
  @MaxLength(5000)
  answer?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsInt()
  sortOrder?: number;
}

export class QueryApprovedQaDto {
  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsBoolean()
  includeUnpublished?: boolean;
}
