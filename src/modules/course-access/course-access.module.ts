import { Module } from '@nestjs/common';
import { CourseAccessController } from './course-access.controller';
import { CourseAccessService } from './course-access.service';

@Module({
  controllers: [CourseAccessController],
  providers: [CourseAccessService],
})
export class CourseAccessModule {}
