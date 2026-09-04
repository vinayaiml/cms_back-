import { Type } from 'class-transformer';
import { Equals, IsBoolean, IsEmail, IsInt, IsNotEmpty, IsObject, IsString, Min, ValidateNested } from 'class-validator';

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
  manufacturer!: string;

  @IsString()
  @IsNotEmpty()
  model!: string;

  @IsString()
  @IsNotEmpty()
  androidVersion!: string;

  @IsInt()
  @Min(1)
  apiLevel!: number;

  @IsString()
  @IsNotEmpty()
  appVersionName!: string;

  @IsInt()
  @Min(1)
  appVersionCode!: number;
}

export class RobotLoginDto {
  @IsString()
  @IsNotEmpty()
  licenseKey!: string;

  @IsString()
  @IsNotEmpty()
  serialNumber!: string;

  @IsObject()
  @ValidateNested()
  @Type(() => RobotDeviceMetadataDto)
  deviceMetadata!: RobotDeviceMetadataDto;

  @IsBoolean()
  @Equals(true)
  deviceMetadataConsent!: boolean;
}
