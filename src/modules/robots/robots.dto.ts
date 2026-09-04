import { IsBoolean, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

export class CreateRobotDto {
  @IsInt()
  orgId!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  serialNumber!: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
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
