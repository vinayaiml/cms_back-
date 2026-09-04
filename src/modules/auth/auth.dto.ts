import { Type } from 'class-transformer';
import {
  Equals,
  IsBoolean,
  IsEmail,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class LoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  password!: string;
}

export class RobotDeviceMetadataDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  manufacturer!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  model!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  @Matches(/^[0-9A-Za-z._ -]+$/)
  androidVersion!: string;

  @IsInt()
  @Min(1)
  apiLevel!: number;

  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  @Matches(/^[0-9A-Za-z._+-]+$/)
  appVersionName!: string;

  @IsInt()
  @Min(1)
  appVersionCode!: number;
}

export class RobotLoginDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  licenseKey!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  @Matches(/^[A-Za-z0-9._:-]+$/)
  serialNumber!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => RobotDeviceMetadataDto)
  deviceMetadata!: RobotDeviceMetadataDto;

  @IsBoolean()
  @Equals(true)
  @IsOptional()
  deviceMetadataConsent?: boolean;
}
