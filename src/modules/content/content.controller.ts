import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { ContentService } from './content.service';
import { UpdateChapterDto, UpdateCourseDto, UpdateLessonDto, UpdateLevelDto } from './content.dto';

@Controller('content')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class ContentController {
  constructor(private content: ContentService) {}

  /**
   * "My Courses" for dashboards:
   * - Org users: org-owned + assigned platform courses (metadata + levels summary)
   * - Super Admin: platform courses
   */
  @Get('my')
  @RequirePermissions('content.read')
  async myCourses(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    if (actor.isSuperAdmin && !actor.orgId) {
      return this.content.listPlatformCourses();
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    return this.content.listMyCourses(actor.orgId);
  }

  // Platform courses (Super Admin)
  @Get('platform')
  @RequirePermissions('content.read')
  async platform(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.content.listPlatformCourses();
  }

  // Course details (nested levels/chapters/lessons)
  @Get('course/:id')
  @RequirePermissions('content.read')
  async courseDetails(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.content.getCourseDetails(actor, id);
  }

  // Update course metadata
  @Patch('course/:id')
  @RequirePermissions('content.write')
  async updateCourse(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateCourseDto) {
    return this.content.updateCourse(actor, id, dto);
  }

  // Update level
  @Patch('level/:id')
  @RequirePermissions('content.write')
  async updateLevel(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLevelDto) {
    return this.content.updateLevel(actor, id, dto);
  }

  // Update chapter
  @Patch('chapter/:id')
  @RequirePermissions('content.write')
  async updateChapter(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateChapterDto) {
    return this.content.updateChapter(actor, id, dto);
  }

  // Update lesson
  @Patch('lesson/:id')
  @RequirePermissions('content.write')
  async updateLesson(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateLessonDto) {
    return this.content.updateLesson(actor, id, dto);
  }

  // Delete course
  @Delete('course/:id')
  @RequirePermissions('content.write')
  async deleteCourse(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    return this.content.deleteCourse(actor, id);
  }

  // Organization-owned content import (CSV/XLSX)
  @Post('import')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async import(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importOrgContent(actor.orgId, { buffer: file.buffer, originalname: file.originalname });
  }

  // Platform content import (CSV/XLSX) — Super Admin only
  @Post('import/platform')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importPlatform(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importPlatformContent({ buffer: file.buffer, originalname: file.originalname });
  }

  // Organization-only: courses template
  @Post('import/courses')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importCourses(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importCoursesOnly(actor.orgId, { buffer: file.buffer, originalname: file.originalname });
  }

  // Super Admin: courses template (platform)
  @Post('import/platform/courses')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importPlatformCourses(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importCoursesOnly(null, { buffer: file.buffer, originalname: file.originalname }, true);
  }

  // Organization-only: chapters template
  @Post('import/chapters')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importChapters(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importChaptersOnly(actor.orgId, { buffer: file.buffer, originalname: file.originalname });
  }

  // Super Admin: chapters template (platform)
  @Post('import/platform/chapters')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importPlatformChapters(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importChaptersOnly(null, { buffer: file.buffer, originalname: file.originalname }, true);
  }

  // Organization-only: lessons template
  @Post('import/lessons')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importLessons(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importLessonsOnly(actor.orgId, { buffer: file.buffer, originalname: file.originalname });
  }

  // Super Admin: lessons template (platform)
  @Post('import/platform/lessons')
  @RequirePermissions('content.import')
  @UseInterceptors(FileInterceptor('file'))
  async importPlatformLessons(@CurrentUser() actor: JwtPayload, @UploadedFile() file?: Express.Multer.File) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    if (!file) throw new ForbiddenException('No file uploaded');

    return this.content.importLessonsOnly(null, { buffer: file.buffer, originalname: file.originalname }, true);
  }
}
