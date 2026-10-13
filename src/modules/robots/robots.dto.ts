import { Type } from 'class-transformer';
import { IsBoolean, IsDateString, IsIn, IsInt, IsNotEmpty, IsObject, IsOptional, IsString, Max, Min, ValidateNested } from 'class-validator';

export class RobotHardwareDisplayDto {
  @IsInt()
  @Min(1)
  @Max(10000)
  width!: number;

  @IsInt()
  @Min(1)
  @Max(10000)
  height!: number;
}

export class RobotHardwareProfileDto {
  @IsString()
  @IsIn(['MINI_ELF', 'ELF', 'NANO', 'S5'])
  model!: string;

  @IsOptional()
  @IsString()
  manufacturer?: string;

  @IsInt()
  @Min(1)
  androidApiLevel!: number;

  @IsString()
  @IsIn(['arm64-v8a', 'armeabi-v7a'])
  abi!: string;

  @ValidateNested()
  @Type(() => RobotHardwareDisplayDto)
  display!: RobotHardwareDisplayDto;

  @IsOptional()
  @IsObject()
  capabilities?: Record<string, boolean>;
}

export class CreateRobotDto {
  @IsInt()
  orgId!: number;

  @IsString()
  @IsNotEmpty()
  serialNumber!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsDateString()
  validFrom!: string;

  @IsDateString()
  validUntil!: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => RobotHardwareProfileDto)
  hardwareProfile?: RobotHardwareProfileDto;
}

export class RenewLicenseDto {
  @IsDateString()
  validUntil!: string;
}

export class LockRobotDto {
  // true = lock, false = unlock
  @IsBoolean()
  lock!: boolean;
}

export class ReassignRobotDto {
  @IsInt()
  orgId!: number;
}

export class UpdateRobotHardwareDto {
  @IsString()
  @IsIn(['MINI_ELF', 'ELF', 'NANO', 'S5'])
  model!: string;
}

export class UpdateRobotNameDto {
  @IsString()
  @IsOptional()
  name?: string;
}

export class UpsertRobotCapabilityAssignmentDto {
  @IsString()
  @IsNotEmpty()
  capabilityStableKey!: string;

  @IsOptional()
  @IsBoolean()
  isEnabled?: boolean;

  @IsOptional()
  @IsObject()
  limits?: Record<string, unknown>;
}
