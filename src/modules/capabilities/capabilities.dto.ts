import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

export class CapabilityHardwareRequirementsDto {
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  models?: string[];

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  capabilities?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  minAndroidApiLevel?: number;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  abi?: string[];
}

export class CreateCapabilityDto {
  @IsString()
  @IsNotEmpty()
  @Matches(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/)
  stableKey!: string;

  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsInt()
  @Min(1)
  version!: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CapabilityHardwareRequirementsDto)
  requiredHardware?: CapabilityHardwareRequirementsDto;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateCapabilityDto {
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  category?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  version?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => CapabilityHardwareRequirementsDto)
  requiredHardware?: CapabilityHardwareRequirementsDto | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
