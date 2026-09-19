import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsString, Matches, MaxLength, Min, ValidateNested } from 'class-validator';
import { RobotHardwareProfileDto } from '../robots/robots.dto';

export class RobotDeviceProfileDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  manufacturer!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  deviceModel!: string;

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

  @ValidateNested()
  @Type(() => RobotHardwareProfileDto)
  hardwareProfile!: RobotHardwareProfileDto;
}
