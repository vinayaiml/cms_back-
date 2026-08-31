import { IsEnum, IsInt, IsOptional } from 'class-validator';
import { CourseAccessType } from '@prisma/client';

export class CreateCourseAccessDto {
  @IsInt()
  courseId!: number;

  @IsEnum(CourseAccessType)
  accessType!: CourseAccessType;

  @IsOptional()
  @IsInt()
  levelId?: number;

  @IsOptional()
  @IsInt()
  chapterId?: number;
}
