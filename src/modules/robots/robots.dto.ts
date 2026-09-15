import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
