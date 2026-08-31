import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CourseAccessType, CourseSource } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class CourseAccessService {
  constructor(private prisma: PrismaService) {}

  async list(orgId: number) {
    const assignments: Array<{
      id: number;
      orgId: number;
      courseId: number;
      accessType: CourseAccessType;
      levelId: number | null;
      chapterId: number | null;
      course: { id: number; courseCode: string; courseName: string; source: CourseSource };
    }> = await this.prisma.orgCourseAccess.findMany({
      where: { orgId },
      orderBy: { id: 'desc' },
      include: {
        course: { select: { id: true, courseCode: true, courseName: true, source: true } },
      },
    });

    // attach level/chapter names (optional convenience for UI)
    const courseIds = Array.from(new Set(assignments.map((a) => a.courseId)));
    const courses = courseIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: courseIds } },
          include: { levels: { include: { chapters: true } } },
        })
      : [];

    const levelMap = new Map<number, { name: string; courseId: number }>();
    const chapterMap = new Map<number, { name: string; levelId: number; courseId: number }>();

    for (const c of courses) {
      for (const l of c.levels) {
        levelMap.set(l.id, { name: l.name, courseId: c.id });
        for (const ch of l.chapters) {
          chapterMap.set(ch.id, { name: ch.name, levelId: l.id, courseId: c.id });
        }
      }
    }

    return assignments.map((a) => ({
      ...a,
      levelName: a.levelId ? levelMap.get(a.levelId)?.name ?? null : null,
      chapterName: a.chapterId ? chapterMap.get(a.chapterId)?.name ?? null : null,
    }));
  }

  private async ensureCourseIsPlatform(courseId: number) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.source !== CourseSource.PLATFORM) {
      throw new BadRequestException('Only platform courses can be assigned to organizations');
    }
    return course;
  }

  async create(
    orgId: number,
    actor: { isSuperAdmin: boolean },
    data: { courseId: number; accessType: CourseAccessType; levelId?: number; chapterId?: number },
  ) {
    if (!actor.isSuperAdmin) throw new ForbiddenException('Only Super Admin can assign course access');

    await this.ensureCourseIsPlatform(data.courseId);

    // Validate structure constraints
    if (data.accessType === CourseAccessType.FULL_COURSE) {
      if (data.levelId || data.chapterId) throw new BadRequestException('FULL_COURSE must not include levelId/chapterId');
    }

    if (data.accessType === CourseAccessType.LEVEL_ONLY) {
      if (!data.levelId) throw new BadRequestException('LEVEL_ONLY requires levelId');
      const lvl = await this.prisma.level.findUnique({ where: { id: data.levelId } });
      if (!lvl) throw new BadRequestException('Level not found');
      if (lvl.courseId !== data.courseId) throw new BadRequestException('Level does not belong to the selected course');
    }

    if (data.accessType === CourseAccessType.CHAPTER_ONLY) {
      if (!data.chapterId) throw new BadRequestException('CHAPTER_ONLY requires chapterId');
      const ch = await this.prisma.chapter.findUnique({ where: { id: data.chapterId }, include: { level: true } });
      if (!ch) throw new BadRequestException('Chapter not found');
      if (ch.level.courseId !== data.courseId) throw new BadRequestException('Chapter does not belong to the selected course');
    }

    const dup = await this.prisma.orgCourseAccess.findFirst({
      where: {
        orgId,
        courseId: data.courseId,
        accessType: data.accessType,
        levelId: data.levelId ?? null,
        chapterId: data.chapterId ?? null,
      },
    });
    if (dup) throw new BadRequestException('This course access is already assigned');

    return this.prisma.orgCourseAccess.create({
      data: {
        orgId,
        courseId: data.courseId,
        accessType: data.accessType,
        levelId: data.levelId ?? null,
        chapterId: data.chapterId ?? null,
      },
    });
  }

  async remove(orgId: number, id: number, actor: { isSuperAdmin: boolean }) {
    if (!actor.isSuperAdmin) throw new ForbiddenException('Only Super Admin can revoke course access');

    const existing = await this.prisma.orgCourseAccess.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Assignment not found');
    if (existing.orgId !== orgId) throw new ForbiddenException('Assignment does not belong to this org');

    await this.prisma.orgCourseAccess.delete({ where: { id } });
    return { ok: true };
  }
}
