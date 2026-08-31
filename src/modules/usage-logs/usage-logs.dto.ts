import { Type } from 'class-transformer';
import { IsArray, IsDateString, IsInt, IsNotEmpty, IsOptional, IsString, ValidateNested } from 'class-validator';

export class UsageLogItemDto {
  @IsString()
  @IsNotEmpty()
  eventId!: string;

  @IsOptional()
  @IsInt()
  courseId?: number;

  @IsOptional()
  @IsInt()
  lessonId?: number;

  @IsDateString()
  openedAt!: string;

  @IsOptional()
  @IsInt()
  durationSec?: number;
}

export class UploadUsageLogsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UsageLogItemDto)
  logs!: UsageLogItemDto[];
}
