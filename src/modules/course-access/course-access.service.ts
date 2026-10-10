import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { CourseAccessType, CourseSource } from '@prisma/client';
import * as http from 'http';
import * as https from 'https';
import { PrismaService } from '../../prisma/prisma.service';

type AssignableLessonAsset = {
  id: number;
  contentUrl: string | null;
  contentSizeBytes: number | null;
  contentChecksum: string | null;
};

type AssignableCourse = {
  id: number;
  levels: Array<{
    id: number;
    lessons: AssignableLessonAsset[];
    chapters: Array<{
      id: number;
      lessons: AssignableLessonAsset[];
    }>;
  }>;
};

export const ASSET_AVAILABILITY_PROBE = Symbol('ASSET_AVAILABILITY_PROBE');
export type AssetAvailabilityProbe = (url: string) => Promise<{ ok: boolean; status?: number }>;

const probeHttpAsset = (url: string, method: 'HEAD' | 'GET') =>
  new Promise<{ ok: boolean; status?: number }>((resolve) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(
      parsed,
      {
        method,
        timeout: 5000,
        headers: method === 'GET' ? { Range: 'bytes=0-0' } : undefined,
      },
      (res) => {
        res.resume();
        const status = res.statusCode ?? 0;
        resolve({ ok: status >= 200 && status < 400, status });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false });
    });
    req.on('error', () => resolve({ ok: false }));
    req.end();
  });

const defaultAssetProbe: AssetAvailabilityProbe = async (url: string) => {
  const head = await probeHttpAsset(url, 'HEAD');
  if (head.status !== 405) return head;
  return probeHttpAsset(url, 'GET');
};

@Injectable()
export class CourseAccessService {
  private readonly assetProbe: AssetAvailabilityProbe;

  constructor(
    private prisma: PrismaService,
    @Optional()
    @Inject(ASSET_AVAILABILITY_PROBE)
    assetProbe?: AssetAvailabilityProbe,
  ) {
    this.assetProbe = assetProbe ?? defaultAssetProbe;
  }

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

  private isPrivateIpAddress(hostname: string) {
    if (/^127\./.test(hostname) || hostname === '0.0.0.0') return true;
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;

    const match = hostname.match(/^172\.(\d{1,3})\./);
    if (match) {
      const secondOctet = Number(match[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }

    return false;
  }

  private async validateLessonAsset(lesson: AssignableLessonAsset) {
    if (!lesson.contentUrl || !lesson.contentUrl.trim()) {
      throw new BadRequestException('Course contains a lesson with missing content asset URL');
    }

    let parsed: URL;
    try {
      parsed = new URL(lesson.contentUrl);
    } catch {
      throw new BadRequestException('Course contains a lesson with invalid content asset URL');
    }

    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw new BadRequestException('Course contains a lesson with unsupported content asset URL');
    }

    if (parsed.username || parsed.password) {
      throw new BadRequestException('Course content asset URLs must not include credentials');
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname.endsWith('.localhost') ||
      hostname.endsWith('.local') ||
      this.isPrivateIpAddress(hostname)
    ) {
      throw new BadRequestException('Course content asset URL must use an approved public host');
    }

    if (lesson.contentSizeBytes !== null && lesson.contentSizeBytes < 0) {
      throw new BadRequestException('Course contains a lesson with invalid content size');
    }

    if (lesson.contentChecksum !== null && !/^[a-fA-F0-9]{64}$/.test(lesson.contentChecksum)) {
      throw new BadRequestException('Course contains a lesson with invalid content checksum');
    }

    const availability = await this.assetProbe(parsed.toString());
    if (!availability.ok) {
      throw new BadRequestException('Course contains a lesson with unavailable content asset');
    }
  }

  private lessonsForAssignment(course: AssignableCourse, data: { accessType: CourseAccessType; levelId?: number; chapterId?: number }) {
    if (data.accessType === CourseAccessType.FULL_COURSE) {
      return course.levels.flatMap((level) => [
        ...level.lessons,
        ...level.chapters.flatMap((chapter) => chapter.lessons),
      ]);
    }

    if (data.accessType === CourseAccessType.LEVEL_ONLY) {
      const level = course.levels.find((item) => item.id === data.levelId);
      if (!level) throw new BadRequestException('Level does not belong to the selected course');
      return [
        ...level.lessons,
        ...level.chapters.flatMap((chapter) => chapter.lessons),
      ];
    }

    const chapter = course.levels
      .flatMap((level) => level.chapters)
      .find((item) => item.id === data.chapterId);
    if (!chapter) throw new BadRequestException('Chapter does not belong to the selected course');
    return chapter.lessons;
  }

  private async validateAssignableContentAssets(
    courseId: number,
    data: { accessType: CourseAccessType; levelId?: number; chapterId?: number },
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: {
        id: true,
        levels: {
          select: {
            id: true,
            lessons: {
              select: {
                id: true,
                contentUrl: true,
                contentSizeBytes: true,
                contentChecksum: true,
              },
            },
            chapters: {
              select: {
                id: true,
                lessons: {
                  select: {
                    id: true,
                    contentUrl: true,
                    contentSizeBytes: true,
                    contentChecksum: true,
                  },
                },
              },
            },
          },
        },
      },
    } as any) as AssignableCourse | null;

    if (!course) throw new NotFoundException('Course not found');

    const lessons = this.lessonsForAssignment(course, data);
    if (!lessons.length) {
      throw new BadRequestException('Course access assignment contains no lessons');
    }

    for (const lesson of lessons) {
      await this.validateLessonAsset(lesson);
    }
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

    await this.validateAssignableContentAssets(data.courseId, data);

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
