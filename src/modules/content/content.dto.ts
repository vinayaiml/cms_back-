import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ContentType, CourseVisibility, LessonVisibility } from '@prisma/client';

export class UpdateCourseDto {
  @IsOptional()
  @IsString()
  courseCode?: string;

  @IsOptional()
  @IsString()
  courseName?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsString()
  courseImageUrl?: string | null;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsEnum(CourseVisibility)
  visibility?: CourseVisibility;

  @IsOptional()
  @IsInt()
  introLevelId?: number | null;
}

export class UpdateLevelDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  sequence?: number;
}

export class UpdateChapterDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  sequence?: number;
}

export class UpdateLessonDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsOptional()
  @IsInt()
  sequence?: number;

  @IsOptional()
  @IsInt()
  durationMins?: number | null;

  @IsOptional()
  @IsEnum(ContentType)
  contentType?: ContentType;

  @IsOptional()
  @IsString()
  contentUrl?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  contentSizeBytes?: number | null;

  @IsOptional()
  @IsString()
  contentChecksum?: string | null;

  @IsOptional()
  @IsString()
  thumbnailUrl?: string | null;

  @IsOptional()
  @IsString()
  logoUrl?: string | null;

  @IsOptional()
  @IsEnum(LessonVisibility)
  visibility?: LessonVisibility;

  @IsOptional()
  @IsInt()
  chapterId?: number | null;
}
