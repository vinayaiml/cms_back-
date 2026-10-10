import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { parse as parseCsv } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import { z } from 'zod';
import { createHash } from 'crypto';
import {
  CourseAccessType,
  CourseSource,
  CourseVisibility,
  LessonVisibility,
  ContentType,
  Prisma,
} from '@prisma/client';
import { JwtPayload, JwtUserPayload } from '../../common/auth/jwt.types';
import { UpdateChapterDto, UpdateCourseDto, UpdateLessonDto, UpdateLevelDto } from './content.dto';

type RawRow = Record<string, any>;

type CourseDetails = Prisma.CourseGetPayload<{
  include: {
    levels: {
      include: {
        chapters: { include: { lessons: true } };
        lessons: true;
      };
    };
  };
}>;

type CourseDetailsLevel = CourseDetails['levels'][number];
type CourseDetailsChapter = CourseDetailsLevel['chapters'][number];
type CourseDetailsLesson = CourseDetailsChapter['lessons'][number];
type CourseDetailsDirectLesson = CourseDetailsLevel['lessons'][number];

type CourseAccessScope = {
  full: boolean;
  levelIds: Set<number>;
  chapterIds: Set<number>;
};

type CourseReadAccess = {
  course: {
    id: number;
    source: CourseSource;
    ownerOrgId: number | null;
  };
  scope: 'full' | CourseAccessScope;
};

type CourseAccessRow = {
  accessType: CourseAccessType;
  levelId: number | null;
  chapterId: number | null;
};

type CourseCard = {
  id: number;
  courseCode: string;
  courseName: string;
  visibility: CourseVisibility;
  source: CourseSource;
  ownerOrgId: number | null;
  createdAt: Date;
};

const normalizeKey = (k: string) => k.trim().toLowerCase();

const toUpperOrUndef = (v: any) => {
  if (v === undefined || v === null) return undefined;
  const s = String(v).trim();
  return s ? s.toUpperCase() : undefined;
};

const BooleanishOptional = z.preprocess((v) => {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (!s) return undefined;
  if (['true', '1', 'yes', 'y'].includes(s)) return true;
  if (['false', '0', 'no', 'n'].includes(s)) return false;
  return v;
}, z.boolean().optional());

const RowSchema = z.object({
  courseName: z.string().min(1),
  courseImageUrl: z.string().optional(),
  levelName: z.string().min(1),
  levelDescription: z.string().optional(),
  chapterName: z.string().optional(),
  chapterDescription: z.string().optional(),
  lessonName: z.string().min(1),
  lessonDescription: z.string().optional(),
  durationMins: z.coerce.number().int().positive().optional(),
  contentUrl: z.string().min(1),
  contentSizeBytes: z.coerce.number().int().min(0).optional(),
  contentChecksum: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
  logoUrl: z.string().optional(),

  // Optional visibility controls
  courseVisibility: z.preprocess(toUpperOrUndef, z.enum(['PUBLIC', 'PRIVATE']).optional()),
  isIntroLevel: BooleanishOptional,
  lessonVisibility: z.preprocess(toUpperOrUndef, z.enum(['PUBLIC_PREVIEW', 'PRIVATE']).optional()),
  contentType: z.preprocess(toUpperOrUndef, z.enum(['VIDEO', 'IMAGE', 'TEXT']).optional()),
});

export type ImportResult = {
  coursesCreated: number;
  coursesUpdated: number;
  rowsProcessed: number;
};

type CourseRow = {
  courseName: string;
  courseCode?: string;
  description?: string;
  courseImageUrl?: string;
  logoUrl?: string;
  visibility?: CourseVisibility;
};

type ChapterRow = {
  courseName: string;
  levelName?: string;
  chapterName: string;
  sequence?: number;
  description?: string;
};

type LessonRow = {
  courseName: string;
  levelName: string;
  chapterName?: string;
  lessonName: string;
  sequence?: number;
  description?: string;
  durationMins?: number;
  contentType?: ContentType;
  contentUrl: string;
  contentSizeBytes?: number;
  contentChecksum?: string;
  thumbnailUrl?: string;
  logoUrl?: string;
  visibility?: LessonVisibility;
};

@Injectable()
export class ContentService {
  constructor(private prisma: PrismaService) {}
  private static readonly IMPORT_TX_OPTS = { maxWait: 10000, timeout: 60000 } as const;

  private applyCarryForward(
    rows: RawRow[],
    fields: Array<{ canonical: string; aliases: string[] }>,
  ): RawRow[] {
    const lastSeen: Record<string, string | undefined> = {};

    return rows.map((raw) => {
      const byKey: Record<string, any> = {};
      for (const [k, v] of Object.entries(raw)) {
        byKey[normalizeKey(k)] = typeof v === 'string' ? v.trim() : v;
      }

      const out: RawRow = { ...raw };

      for (const field of fields) {
        let found: string | undefined;

        for (const alias of field.aliases) {
          const v = byKey[normalizeKey(alias)];
          if (v !== undefined && v !== null && String(v).trim() !== '') {
            found = String(v).trim();
            break;
          }
        }

        if (found) {
          lastSeen[field.canonical] = found;
          out[field.canonical] = found;
        } else if (lastSeen[field.canonical] !== undefined) {
          out[field.canonical] = lastSeen[field.canonical];
        }
      }

      return out;
    });
  }

  private canonicalCourseName(name: string): string {
    return name
      .normalize('NFKC')
      .replace(/[\u2010-\u2015]/g, '-')
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/\s+/g, ' ')
      .trim()
      .toUpperCase();
  }

  private normalizeChecksum(value: string | null | undefined) {
    if (value === undefined || value === null) return undefined;
    const trimmed = String(value).trim().toLowerCase();
    if (!trimmed) return undefined;
    if (!/^[a-f0-9]{64}$/.test(trimmed)) {
      throw new BadRequestException('contentChecksum must be a SHA-256 hex string');
    }
    return trimmed;
  }

  private normalizeContentSize(value: number | null | undefined) {
    if (value === undefined || value === null) return undefined;
    if (!Number.isInteger(value) || value < 0) {
      throw new BadRequestException('contentSizeBytes must be a non-negative integer');
    }
    return value;
  }

  private computedChecksum(input: { contentUrl: string; contentType: ContentType; contentSizeBytes?: number | null }) {
    return createHash('sha256')
      .update(`${input.contentType}:${input.contentUrl}:${input.contentSizeBytes ?? ''}`)
      .digest('hex');
  }

  private nextContentMetadata(
    input: { contentUrl: string; contentType: ContentType; contentSizeBytes?: number | null; contentChecksum?: string | null },
    existing?: {
      contentUrl: string;
      contentType: ContentType;
      contentSizeBytes: number | null;
      contentChecksum: string | null;
      contentVersion: number;
    } | null,
  ) {
    const contentSizeBytes = this.normalizeContentSize(input.contentSizeBytes);
    const explicitChecksum = this.normalizeChecksum(input.contentChecksum);
    const effectiveSize = contentSizeBytes ?? existing?.contentSizeBytes ?? null;
    const contentChecksum = explicitChecksum ?? this.computedChecksum({
      contentUrl: input.contentUrl,
      contentType: input.contentType,
      contentSizeBytes: effectiveSize,
    });

    if (!existing) {
      return {
        contentVersion: 1,
        contentSizeBytes: effectiveSize,
        contentChecksum,
      };
    }

    const changed =
      existing.contentUrl !== input.contentUrl ||
      existing.contentType !== input.contentType ||
      existing.contentSizeBytes !== effectiveSize ||
      existing.contentChecksum !== contentChecksum;

    return {
      contentVersion: changed ? existing.contentVersion + 1 : existing.contentVersion,
      contentSizeBytes: effectiveSize,
      contentChecksum,
    };
  }

  private async findExistingCourseByName(
    tx: Prisma.TransactionClient,
    courseName: string,
    source: CourseSource,
    ownerOrgId: number | null,
  ) {
    const exact = await tx.course.findFirst({
      where: { courseName, source, ownerOrgId },
    });
    if (exact) return exact;

    const candidates = await tx.course.findMany({
      where: { source, ownerOrgId },
      select: {
        id: true,
        courseCode: true,
        courseName: true,
        description: true,
        courseImageUrl: true,
        logoUrl: true,
        visibility: true,
        source: true,
        ownerOrgId: true,
      },
    });

    const wanted = this.canonicalCourseName(courseName);
    return candidates.find((c) => this.canonicalCourseName(c.courseName) === wanted) || null;
  }

  private ensureUser(actor: JwtPayload): JwtUserPayload {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return actor;
  }

  private buildCourseAccessScope(assignments: CourseAccessRow[]): CourseAccessScope {
    const scope: CourseAccessScope = {
      full: false,
      levelIds: new Set<number>(),
      chapterIds: new Set<number>(),
    };

    for (const assignment of assignments) {
      if (assignment.accessType === CourseAccessType.FULL_COURSE) {
        scope.full = true;
      } else if (assignment.accessType === CourseAccessType.LEVEL_ONLY && assignment.levelId) {
        scope.levelIds.add(assignment.levelId);
      } else if (assignment.accessType === CourseAccessType.CHAPTER_ONLY && assignment.chapterId) {
        scope.chapterIds.add(assignment.chapterId);
      }
    }

    return scope;
  }

  private filterCourseDetailsByAccess(course: CourseDetails, access: CourseReadAccess): CourseDetails {
    if (access.scope === 'full' || access.scope.full) return course;

    const scope = access.scope;
    const levels = course.levels.flatMap((level: CourseDetailsLevel) => {
      if (scope.levelIds.has(level.id)) {
        return [level];
      }

      const chapters = level.chapters.filter((chapter: CourseDetailsChapter) =>
        scope.chapterIds.has(chapter.id),
      );

      if (!chapters.length) return [];

      return [{
        ...level,
        chapters,
        lessons: [],
      }];
    });

    if (!levels.length) {
      throw new ForbiddenException('Assigned course access is invalid');
    }

    return { ...course, levels };
  }

  private async canReadCourse(actor: JwtPayload, courseId: number): Promise<CourseReadAccess> {
    const user = this.ensureUser(actor);
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    if (user.isSuperAdmin) {
      if (course.source !== CourseSource.PLATFORM) throw new ForbiddenException('Super Admin can only access platform courses');
      return { course, scope: 'full' };
    }

    if (!user.orgId) throw new ForbiddenException('Org scope required');
    if (course.ownerOrgId === user.orgId) return { course, scope: 'full' };

    if (course.source === CourseSource.PLATFORM) {
      const assignments = await this.prisma.orgCourseAccess.findMany({
        where: { orgId: user.orgId, courseId: course.id },
        select: { accessType: true, levelId: true, chapterId: true },
      });
      if (assignments.length) {
        return { course, scope: this.buildCourseAccessScope(assignments) };
      }
    }

    throw new ForbiddenException('Not allowed to access this course');
  }

  private async canWriteCourse(actor: JwtPayload, courseId: number) {
    const user = this.ensureUser(actor);
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    if (user.isSuperAdmin) {
      if (course.source !== CourseSource.PLATFORM) throw new ForbiddenException('Super Admin can only edit platform courses');
      return course;
    }

    if (!user.orgId) throw new ForbiddenException('Org scope required');
    if (course.ownerOrgId !== user.orgId) throw new ForbiddenException('Not allowed to edit this course');
    return course;
  }

  async getCourseDetails(actor: JwtPayload, courseId: number) {
    const access = await this.canReadCourse(actor, courseId);

    const course = (await this.prisma.course.findUnique({
      where: { id: courseId },
      include: {
        levels: {
          orderBy: { sequence: 'asc' },
          include: {
            chapters: {
              orderBy: { sequence: 'asc' },
              include: {
                lessons: { orderBy: { sequence: 'asc' } },
              },
            },
            lessons: { orderBy: { sequence: 'asc' } },
          },
        },
      },
    })) as CourseDetails | null;

    if (!course) throw new NotFoundException('Course not found');

    const filteredCourse = this.filterCourseDetailsByAccess(course, access);

    const levels = filteredCourse.levels.map((lvl: CourseDetailsLevel) => ({
      id: lvl.id,
      name: lvl.name,
      sequence: lvl.sequence,
      description: lvl.description,
      chapters: lvl.chapters.map((ch: CourseDetailsChapter) => ({
        id: ch.id,
        name: ch.name,
        sequence: ch.sequence,
        description: ch.description,
        lessons: ch.lessons.map((lsn: CourseDetailsLesson) => ({
          id: lsn.id,
          name: lsn.name,
          sequence: lsn.sequence,
          description: lsn.description,
          durationMins: lsn.durationMins,
          contentType: lsn.contentType,
          contentUrl: lsn.contentUrl,
          contentVersion: (lsn as any).contentVersion,
          contentSizeBytes: (lsn as any).contentSizeBytes,
          contentChecksum: (lsn as any).contentChecksum,
          thumbnailUrl: lsn.thumbnailUrl,
          logoUrl: lsn.logoUrl,
          visibility: lsn.visibility,
          chapterId: lsn.chapterId,
          levelId: lsn.levelId,
        })),
      })),
      directLessons: lvl.lessons
        .filter((lsn: CourseDetailsDirectLesson) => !lsn.chapterId)
        .map((lsn: CourseDetailsDirectLesson) => ({
          id: lsn.id,
          name: lsn.name,
          sequence: lsn.sequence,
          description: lsn.description,
          durationMins: lsn.durationMins,
          contentType: lsn.contentType,
          contentUrl: lsn.contentUrl,
          contentVersion: (lsn as any).contentVersion,
          contentSizeBytes: (lsn as any).contentSizeBytes,
          contentChecksum: (lsn as any).contentChecksum,
          thumbnailUrl: lsn.thumbnailUrl,
          logoUrl: lsn.logoUrl,
          visibility: lsn.visibility,
          chapterId: lsn.chapterId,
          levelId: lsn.levelId,
        })),
    }));

    return {
      id: filteredCourse.id,
      courseCode: filteredCourse.courseCode,
      courseName: filteredCourse.courseName,
      description: filteredCourse.description,
      courseImageUrl: filteredCourse.courseImageUrl,
      logoUrl: filteredCourse.logoUrl,
      visibility: filteredCourse.visibility,
      source: filteredCourse.source,
      ownerOrgId: filteredCourse.ownerOrgId,
      introLevelId: filteredCourse.introLevelId,
      levels,
    };
  }

  async updateCourse(actor: JwtPayload, courseId: number, dto: UpdateCourseDto) {
    const course = await this.canWriteCourse(actor, courseId);

    if (Object.prototype.hasOwnProperty.call(dto, 'introLevelId') && dto.introLevelId !== null && dto.introLevelId !== undefined) {
      const level = await this.prisma.level.findUnique({ where: { id: dto.introLevelId } });
      if (!level || level.courseId !== course.id) {
        throw new BadRequestException('Intro level must belong to the course');
      }
    }

    const data: any = {};
    const keys: Array<keyof UpdateCourseDto> = ['courseCode', 'courseName', 'description', 'courseImageUrl', 'logoUrl', 'visibility', 'introLevelId'];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(dto, k)) data[k] = (dto as any)[k];
    }

    return this.prisma.course.update({ where: { id: course.id }, data });
  }

  async updateLevel(actor: JwtPayload, levelId: number, dto: UpdateLevelDto) {
    this.ensureUser(actor);
    const level = await this.prisma.level.findUnique({ where: { id: levelId }, include: { course: true } });
    if (!level) throw new NotFoundException('Level not found');
    await this.canWriteCourse(actor, level.courseId);

    const data: any = {};
    const keys: Array<keyof UpdateLevelDto> = ['name', 'description', 'sequence'];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(dto, k)) data[k] = (dto as any)[k];
    }

    return this.prisma.level.update({ where: { id: levelId }, data });
  }

  async updateChapter(actor: JwtPayload, chapterId: number, dto: UpdateChapterDto) {
    this.ensureUser(actor);
    const chapter = await this.prisma.chapter.findUnique({
      where: { id: chapterId },
      include: { level: { include: { course: true } } },
    });
    if (!chapter) throw new NotFoundException('Chapter not found');
    await this.canWriteCourse(actor, chapter.level.courseId);

    const data: any = {};
    const keys: Array<keyof UpdateChapterDto> = ['name', 'description', 'sequence'];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(dto, k)) data[k] = (dto as any)[k];
    }

    return this.prisma.chapter.update({ where: { id: chapterId }, data });
  }

  async updateLesson(actor: JwtPayload, lessonId: number, dto: UpdateLessonDto) {
    this.ensureUser(actor);
    const lesson = await this.prisma.lesson.findUnique({
      where: { id: lessonId },
      include: { level: { include: { course: true } } },
    });
    if (!lesson) throw new NotFoundException('Lesson not found');
    await this.canWriteCourse(actor, lesson.level.courseId);

    if (Object.prototype.hasOwnProperty.call(dto, 'chapterId')) {
      if (dto.chapterId) {
        const chapter = await this.prisma.chapter.findUnique({ where: { id: dto.chapterId } });
        if (!chapter || chapter.levelId !== lesson.levelId) {
          throw new BadRequestException('Chapter must belong to the same level');
        }
      }
    }

    const lessonWithMetadata = lesson as typeof lesson & {
      contentSizeBytes: number | null;
      contentChecksum: string | null;
      contentVersion: number;
    };
    const nextContentUrl = Object.prototype.hasOwnProperty.call(dto, 'contentUrl') && dto.contentUrl !== undefined ? dto.contentUrl : lesson.contentUrl;
    const nextContentType = Object.prototype.hasOwnProperty.call(dto, 'contentType') && dto.contentType !== undefined ? dto.contentType : lesson.contentType;
    const metadata = this.nextContentMetadata(
      {
        contentUrl: nextContentUrl,
        contentType: nextContentType,
        contentSizeBytes: Object.prototype.hasOwnProperty.call(dto, 'contentSizeBytes') ? dto.contentSizeBytes : lessonWithMetadata.contentSizeBytes,
        contentChecksum: Object.prototype.hasOwnProperty.call(dto, 'contentChecksum') ? dto.contentChecksum : lessonWithMetadata.contentChecksum,
      },
      {
        contentUrl: lesson.contentUrl,
        contentType: lesson.contentType,
        contentSizeBytes: lessonWithMetadata.contentSizeBytes,
        contentChecksum: lessonWithMetadata.contentChecksum,
        contentVersion: lessonWithMetadata.contentVersion,
      },
    );

    const data: any = {};
    const keys: Array<keyof UpdateLessonDto> = [
      'name',
      'description',
      'sequence',
      'durationMins',
      'contentType',
      'contentUrl',
      'contentSizeBytes',
      'contentChecksum',
      'thumbnailUrl',
      'logoUrl',
      'visibility',
      'chapterId',
    ];
    for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(dto, k)) data[k] = (dto as any)[k];
    }
    data.contentVersion = metadata.contentVersion;
    data.contentSizeBytes = metadata.contentSizeBytes;
    data.contentChecksum = metadata.contentChecksum;

    return this.prisma.lesson.update({ where: { id: lessonId }, data: data as any });
  }

  async deleteCourse(actor: JwtPayload, courseId: number) {
    await this.canWriteCourse(actor, courseId);
    await this.prisma.course.delete({ where: { id: courseId } });
    return { ok: true };
  }

  /**
   * Returns org-owned + assigned platform courses (dashboard "My Courses").
   * Note: this is NOT robot sync — robot sync uses OrgCourseAccess filtering.
   */
  async listMyCourses(orgId: number) {
    const owned: CourseCard[] = await this.prisma.course.findMany({
      where: { ownerOrgId: orgId },
      orderBy: { id: 'desc' },
      select: {
        id: true,
        courseCode: true,
        courseName: true,
        visibility: true,
        source: true,
        ownerOrgId: true,
        createdAt: true,
      },
    });

    const assignedRows: Array<{ courseId: number }> = await this.prisma.orgCourseAccess.findMany({
      where: { orgId },
      select: { courseId: true },
    });

    const assignedCourseIds = Array.from(new Set(assignedRows.map((r) => r.courseId)));

    const assigned: CourseCard[] = assignedCourseIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: assignedCourseIds }, source: CourseSource.PLATFORM },
          orderBy: { id: 'desc' },
          select: {
            id: true,
            courseCode: true,
            courseName: true,
            visibility: true,
            source: true,
            ownerOrgId: true,
            createdAt: true,
          },
        })
      : [];

    const ownedIds = new Set<number>(owned.map((c) => c.id));

    return [
      ...owned.map((c: CourseCard) => ({ ...c, isAssigned: false })),
      ...assigned.filter((c: CourseCard) => !ownedIds.has(c.id)).map((c: CourseCard) => ({ ...c, isAssigned: true })),
    ];
  }

  /**
   * Platform courses list (Super Admin).
   * Includes levels+chapters for assignment UI.
   */
  async listPlatformCourses() {
    return this.prisma.course.findMany({
      where: { source: CourseSource.PLATFORM },
      orderBy: { id: 'desc' },
      include: {
        levels: {
          orderBy: { sequence: 'asc' },
          include: {
            chapters: { orderBy: { sequence: 'asc' } },
          },
        },
      },
    });
  }

  private mapRow(raw: RawRow): any {
    // Support multiple header variants (from sample + future)
    const byKey: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      byKey[normalizeKey(k)] = typeof v === 'string' ? v.trim() : v;
    }

    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = byKey[normalizeKey(k)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
      return undefined;
    };

    const courseName = get('Course name', 'course_name', 'course');
    const courseImageUrl = get('Course image', 'course_image', 'course_image_url');

    const levelName = get('Level', 'level_name', 'level');
    const levelDescription = get('Description', 'level_description', 'level_desc');

    const chapterName = get('Chapter name', 'chapter_name', 'chapter');
    const chapterDescription = get('Chapter Description', 'chapter_description', 'chapter_desc');

    const lessonName = get('Lesson name', 'lesson_name', 'lesson');
    const lessonDescription = get('Lesson Description', 'lesson_description', 'lesson_desc');

    const durationMins = get('Duration', 'duration_mins', 'duration');
    const contentUrl = get('Video url', 'content_url', 'video_url', 'url');
    const contentSizeBytes = get('contentSizeBytes', 'content size bytes', 'content_size_bytes', 'file size', 'file_size');
    const contentChecksum = get('contentChecksum', 'content checksum', 'content_checksum', 'checksum', 'sha256');
    const logoUrl = get('Logo url', 'logo_url');

    const courseVisibility = get('Course visibility', 'course_visibility');
    const isIntroLevel = get('Is intro level', 'is_intro_level', 'intro_level');
    const lessonVisibility = get('Lesson visibility', 'lesson_visibility');
    const contentType = get('Content type', 'content_type');

    return RowSchema.parse({
      courseName,
      courseImageUrl,
      levelName,
      levelDescription,
      chapterName,
      chapterDescription,
      lessonName,
      lessonDescription,
      durationMins,
      contentUrl,
      contentSizeBytes,
      contentChecksum,
      logoUrl,
      courseVisibility,
      isIntroLevel,
      lessonVisibility,
      contentType,
    });
  }

  private parseFile(buffer: Buffer, filename: string): RawRow[] {
    const lower = filename.toLowerCase();

    if (lower.endsWith('.csv')) {
      const records = parseCsv(buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as RawRow[];
      return records;
    }

    if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) {
      const wb = XLSX.read(buffer, { type: 'buffer' });
      const sheetName = wb.SheetNames[0];
      if (!sheetName) throw new BadRequestException('Excel has no sheets');
      const sheet = wb.Sheets[sheetName];
      const json = XLSX.utils.sheet_to_json(sheet, { defval: '' }) as RawRow[];
      return json;
    }

    throw new BadRequestException('Unsupported file type. Use .csv or .xlsx');
  }

  private mapCourseRow(raw: RawRow): CourseRow {
    const byKey: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      byKey[normalizeKey(k)] = typeof v === 'string' ? v.trim() : v;
    }

    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = byKey[normalizeKey(k)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return String(v).trim();
      }
      return undefined;
    };

    const courseName = get('courseName', 'course name', 'course');
    const courseCode = get('courseCode', 'course code');
    const description = get('description');
    const courseImageUrl = get('courseImageUrl', 'course image', 'course_image_url');
    const logoUrl = get('logoUrl', 'logo url');
    const visibility = get('visibility', 'course visibility');

    const schema = z.object({
      courseName: z.string().min(1),
      courseCode: z.string().optional(),
      description: z.string().optional(),
      courseImageUrl: z.string().optional(),
      logoUrl: z.string().optional(),
      visibility: z.preprocess(toUpperOrUndef, z.enum(['PUBLIC', 'PRIVATE']).optional()),
    });

    return schema.parse({
      courseName,
      courseCode,
      description,
      courseImageUrl,
      logoUrl,
      visibility,
    }) as any;
  }

  private mapChapterRow(raw: RawRow): ChapterRow {
    const byKey: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      byKey[normalizeKey(k)] = typeof v === 'string' ? v.trim() : v;
    }

    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = byKey[normalizeKey(k)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return undefined;
    };

    const courseName = get('courseName', 'course name', 'course');
    const levelName = get('levelName', 'level name', 'level');
    const chapterName = get('chapterName', 'chapter name', 'chapter');
    const sequence = get('sequence', 'chapter sequence');
    const description = get('description', 'chapter description');

    const schema = z.object({
      courseName: z.string().min(1),
      levelName: z.string().optional(),
      chapterName: z.string().min(1),
      sequence: z.coerce.number().int().positive().optional(),
      description: z.string().optional(),
    });

    return schema.parse({
      courseName,
      levelName,
      chapterName,
      sequence,
      description,
    }) as any;
  }

  private mapLessonRow(raw: RawRow): LessonRow {
    const byKey: Record<string, any> = {};
    for (const [k, v] of Object.entries(raw)) {
      byKey[normalizeKey(k)] = typeof v === 'string' ? v.trim() : v;
    }

    const get = (...keys: string[]) => {
      for (const k of keys) {
        const v = byKey[normalizeKey(k)];
        if (v !== undefined && v !== null && String(v).trim() !== '') return v;
      }
      return undefined;
    };

    const courseName = get('courseName', 'course name', 'course');
    const levelName = get('levelName', 'level name', 'level');
    const chapterName = get('chapterName', 'chapter name', 'chapter');
    const lessonName = get('lessonName', 'lesson name', 'lesson');
    const sequence = get('sequence');
    const description = get('description', 'lesson description');
    const durationMins = get('durationMins', 'duration');
    const contentType = get('contentType', 'content type');
    const contentUrl = get('contentUrl', 'video url', 'url');
    const contentSizeBytes = get('contentSizeBytes', 'content size bytes', 'content_size_bytes', 'file size', 'file_size');
    const contentChecksum = get('contentChecksum', 'content checksum', 'content_checksum', 'checksum', 'sha256');
    const thumbnailUrl = get('thumbnailUrl', 'thumbnail url');
    const logoUrl = get('logoUrl', 'logo url');
    const visibility = get('visibility', 'lesson visibility');

    const schema = z.object({
      courseName: z.string().min(1),
      levelName: z.string().min(1),
      chapterName: z.string().optional(),
      lessonName: z.string().min(1),
      sequence: z.coerce.number().int().positive().optional(),
      description: z.string().optional(),
      durationMins: z.coerce.number().int().positive().optional(),
      contentType: z.preprocess((v) => {
        const upper = toUpperOrUndef(v);
        if (upper === 'DOCUMENT') return 'TEXT';
        return upper;
      }, z.enum(['VIDEO', 'IMAGE', 'TEXT']).optional()),
      contentUrl: z.string().min(1),
      contentSizeBytes: z.coerce.number().int().min(0).optional(),
      contentChecksum: z.string().regex(/^[a-fA-F0-9]{64}$/).optional(),
      thumbnailUrl: z.string().optional(),
      logoUrl: z.string().optional(),
      visibility: z.preprocess(toUpperOrUndef, z.enum(['PUBLIC_PREVIEW', 'PRIVATE', 'PUBLIC']).optional()),
    });

    const parsed = schema.parse({
      courseName,
      levelName,
      chapterName,
      lessonName,
      sequence,
      description,
      durationMins,
      contentType,
      contentUrl,
      contentSizeBytes,
      contentChecksum,
      thumbnailUrl,
      logoUrl,
      visibility,
    }) as any;

    if (parsed.visibility === 'PUBLIC') parsed.visibility = 'PUBLIC_PREVIEW';
    return parsed;
  }

  private async nextCourseCode(client: Prisma.TransactionClient | PrismaService = this.prisma): Promise<string> {
    const row = await client.globalCounter.upsert({
      where: { key: 'COURSE' },
      update: { value: { increment: 1 } },
      create: { key: 'COURSE', value: 1 },
    });

    return `C${String(row.value).padStart(5, '0')}`;
  }

  async importOrgContent(orgId: number, file: { buffer: Buffer; originalname: string }): Promise<ImportResult> {
    return this.importContent({ ownerOrgId: orgId, source: CourseSource.ORGANIZATION }, file);
  }

  async importPlatformContent(file: { buffer: Buffer; originalname: string }): Promise<ImportResult> {
    return this.importContent({ ownerOrgId: null, source: CourseSource.PLATFORM }, file);
  }

  async importCoursesOnly(ownerOrgId: number | null, file: { buffer: Buffer; originalname: string }, isPlatform = false): Promise<ImportResult> {
    const rawRows = this.applyCarryForward(this.parseFile(file.buffer, file.originalname), [
      { canonical: 'courseName', aliases: ['courseName', 'course name', 'course'] },
    ]);
    const parsedRows: CourseRow[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    rawRows.forEach((r, idx) => {
      try {
        parsedRows.push(this.mapCourseRow(r));
      } catch (e: any) {
        errors.push({ row: idx + 2, error: e?.message || 'Invalid row' });
      }
    });

    if (errors.length) {
      throw new BadRequestException({ message: 'Import failed validation. No data was saved.', errors });
    }

    let coursesCreated = 0;
    let coursesUpdated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        let existing = null;
        if (row.courseCode) {
          existing = await tx.course.findUnique({ where: { courseCode: row.courseCode } });
          if (existing) {
            if (existing.source !== (isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION)) {
              throw new BadRequestException(`Course code ${row.courseCode} belongs to another source`);
            }
            if (!isPlatform && existing.ownerOrgId !== ownerOrgId) {
              throw new BadRequestException(`Course code ${row.courseCode} belongs to another organization`);
            }
          }
        }

        if (!existing) {
          existing = await this.findExistingCourseByName(
            tx,
            row.courseName,
            isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
            ownerOrgId,
          );
        }

        const visibility = row.visibility ?? CourseVisibility.PRIVATE;

        if (existing) {
          await tx.course.update({
            where: { id: existing.id },
            data: {
              courseName: row.courseName,
              description: row.description ?? existing.description,
              courseImageUrl: row.courseImageUrl ?? existing.courseImageUrl,
              logoUrl: row.logoUrl ?? existing.logoUrl,
              visibility,
              source: isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
              ownerOrgId,
            },
          });
          coursesUpdated += 1;
        } else {
          const courseCode = row.courseCode || (await this.nextCourseCode(tx));
          await tx.course.create({
            data: {
              courseCode,
              courseName: row.courseName,
              description: row.description ?? null,
              courseImageUrl: row.courseImageUrl ?? null,
              logoUrl: row.logoUrl ?? null,
              visibility,
              source: isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
              ownerOrgId,
            },
          });
          coursesCreated += 1;
        }
      }
    }, ContentService.IMPORT_TX_OPTS);

    return { coursesCreated, coursesUpdated, rowsProcessed: parsedRows.length };
  }

  async importChaptersOnly(ownerOrgId: number | null, file: { buffer: Buffer; originalname: string }, isPlatform = false): Promise<ImportResult> {
    const rawRows = this.applyCarryForward(this.parseFile(file.buffer, file.originalname), [
      { canonical: 'courseName', aliases: ['courseName', 'course name', 'course'] },
      { canonical: 'levelName', aliases: ['levelName', 'level name', 'level'] },
      { canonical: 'chapterName', aliases: ['chapterName', 'chapter name', 'chapter'] },
    ]);
    const parsedRows: ChapterRow[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    rawRows.forEach((r, idx) => {
      try {
        parsedRows.push(this.mapChapterRow(r));
      } catch (e: any) {
        errors.push({ row: idx + 2, error: e?.message || 'Invalid row' });
      }
    });

    if (errors.length) {
      throw new BadRequestException({ message: 'Import failed validation. No data was saved.', errors });
    }

    let coursesCreated = 0;
    let coursesUpdated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        let course = await this.findExistingCourseByName(
          tx,
          row.courseName,
          isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
          ownerOrgId,
        );

        if (!course) {
          const courseCode = await this.nextCourseCode(tx);
          course = await tx.course.create({
            data: {
              courseCode,
              courseName: row.courseName,
              description: null,
              visibility: CourseVisibility.PRIVATE,
              source: isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
              ownerOrgId,
            },
          });
          coursesCreated += 1;
        } else {
          coursesUpdated += 1;
        }

        const targetLevelName = row.levelName || 'Level 1';

        let level = await tx.level.findFirst({
          where: { courseId: course.id, name: targetLevelName },
        });
        if (!level) {
          const maxLevelSeq = await tx.level.aggregate({
            where: { courseId: course.id },
            _max: { sequence: true },
          });
          level = await tx.level.create({
            data: {
              courseId: course.id,
              name: targetLevelName,
              sequence: (maxLevelSeq._max.sequence || 0) + 1,
              description: null,
            },
          });
        }

        let seq = row.sequence;
        if (!seq) {
          const maxSeq = await tx.chapter.aggregate({
            where: { levelId: level.id },
            _max: { sequence: true },
          });
          seq = (maxSeq._max.sequence || 0) + 1;
        }

        const existing = await tx.chapter.findFirst({
          where: { levelId: level.id, sequence: seq },
        });

        if (existing) {
          await tx.chapter.update({
            where: { id: existing.id },
            data: {
              name: row.chapterName,
              description: row.description ?? existing.description,
              sequence: seq,
            },
          });
        } else {
          await tx.chapter.create({
            data: {
              levelId: level.id,
              name: row.chapterName,
              description: row.description ?? null,
              sequence: seq,
            },
          });
        }
      }
    }, ContentService.IMPORT_TX_OPTS);

    return { coursesCreated, coursesUpdated, rowsProcessed: parsedRows.length };
  }

  async importLessonsOnly(ownerOrgId: number | null, file: { buffer: Buffer; originalname: string }, isPlatform = false): Promise<ImportResult> {
    const rawRows = this.applyCarryForward(this.parseFile(file.buffer, file.originalname), [
      { canonical: 'courseName', aliases: ['courseName', 'course name', 'course'] },
      { canonical: 'levelName', aliases: ['levelName', 'level name', 'level'] },
      { canonical: 'chapterName', aliases: ['chapterName', 'chapter name', 'chapter'] },
      { canonical: 'lessonName', aliases: ['lessonName', 'lesson name', 'lesson'] },
      { canonical: 'contentUrl', aliases: ['contentUrl', 'video url', 'url'] },
    ]);
    const parsedRows: LessonRow[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    rawRows.forEach((r, idx) => {
      try {
        parsedRows.push(this.mapLessonRow(r));
      } catch (e: any) {
        errors.push({ row: idx + 2, error: e?.message || 'Invalid row' });
      }
    });

    if (errors.length) {
      throw new BadRequestException({ message: 'Import failed validation. No data was saved.', errors });
    }

    let coursesCreated = 0;
    let coursesUpdated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of parsedRows) {
        let course = await this.findExistingCourseByName(
          tx,
          row.courseName,
          isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
          ownerOrgId,
        );

        if (!course) {
          const courseCode = await this.nextCourseCode(tx);
          course = await tx.course.create({
            data: {
              courseCode,
              courseName: row.courseName,
              description: null,
              visibility: CourseVisibility.PRIVATE,
              source: isPlatform ? CourseSource.PLATFORM : CourseSource.ORGANIZATION,
              ownerOrgId,
            },
          });
          coursesCreated += 1;
        } else {
          coursesUpdated += 1;
        }

        let level = await tx.level.findFirst({
          where: { courseId: course.id, name: row.levelName },
        });
        if (!level) {
          const maxSeq = await tx.level.aggregate({
            where: { courseId: course.id },
            _max: { sequence: true },
          });
          const seq = (maxSeq._max.sequence || 0) + 1;
          level = await tx.level.create({
            data: { courseId: course.id, name: row.levelName, sequence: seq, description: null },
          });
        }

        let seq = row.sequence;
        let resolvedLevelId = level.id;
        let chapterId: number | null = null;

        if (row.chapterName) {
          let chapter = await tx.chapter.findFirst({
            where: { levelId: level.id, name: row.chapterName },
          });

          if (!chapter) {
            const chaptersByName = await tx.chapter.findMany({
              where: { level: { courseId: course.id }, name: row.chapterName },
              select: { id: true, levelId: true },
            });
            if (chaptersByName.length === 1) {
              chapter = chaptersByName[0] as any;
            } else if (chaptersByName.length > 1) {
              throw new BadRequestException(
                `Multiple chapters named "${row.chapterName}" found in course "${row.courseName}". Please include the correct levelName.`,
              );
            }
          }

          if (!chapter) {
            const maxChapterSeq = await tx.chapter.aggregate({
              where: { levelId: level.id },
              _max: { sequence: true },
            });
            chapter = await tx.chapter.create({
              data: {
                levelId: level.id,
                name: row.chapterName,
                description: null,
                sequence: (maxChapterSeq._max.sequence || 0) + 1,
              },
            });
          }

          chapterId = chapter.id;
          resolvedLevelId = chapter.levelId;
        } else {
          // Fallback: if chapterName is omitted but lessonName matches exactly one chapter in this course,
          // attach lesson under that chapter instead of importing it as a direct lesson.
          const chaptersByLessonName = await tx.chapter.findMany({
            where: { level: { courseId: course.id }, name: row.lessonName },
            select: { id: true, levelId: true },
          });
          if (chaptersByLessonName.length === 1) {
            chapterId = chaptersByLessonName[0].id;
            resolvedLevelId = chaptersByLessonName[0].levelId;
          }
        }

        if (!seq) {
          const maxSeq = await tx.lesson.aggregate({
            where: { courseId: course.id, levelId: resolvedLevelId, chapterId },
            _max: { sequence: true },
          });
          seq = (maxSeq._max.sequence || 0) + 1;
        }

        const existing = await tx.lesson.findFirst({
          where: { courseId: course.id, levelId: resolvedLevelId, chapterId, sequence: seq },
        });

        if (existing) {
          const contentType = row.contentType ?? existing.contentType;
          const metadata = this.nextContentMetadata(
            {
              contentUrl: row.contentUrl,
              contentType,
              contentSizeBytes: row.contentSizeBytes ?? (existing as any).contentSizeBytes,
              contentChecksum: row.contentChecksum ?? (existing as any).contentChecksum,
            },
            {
              contentUrl: existing.contentUrl,
              contentType: existing.contentType,
              contentSizeBytes: (existing as any).contentSizeBytes,
              contentChecksum: (existing as any).contentChecksum,
              contentVersion: (existing as any).contentVersion,
            },
          );
          await tx.lesson.update({
            where: { id: existing.id },
            data: {
              name: row.lessonName,
              description: row.description ?? existing.description,
              durationMins: row.durationMins ?? existing.durationMins,
              contentType,
              contentUrl: row.contentUrl,
              contentVersion: metadata.contentVersion,
              contentSizeBytes: metadata.contentSizeBytes,
              contentChecksum: metadata.contentChecksum,
              thumbnailUrl: row.thumbnailUrl ?? existing.thumbnailUrl,
              logoUrl: row.logoUrl ?? existing.logoUrl,
              visibility: row.visibility ?? existing.visibility,
              levelId: resolvedLevelId,
              chapterId,
              sequence: seq,
            } as any,
          });
        } else {
          const contentType = row.contentType ?? ContentType.VIDEO;
          const metadata = this.nextContentMetadata({
            contentUrl: row.contentUrl,
            contentType,
            contentSizeBytes: row.contentSizeBytes,
            contentChecksum: row.contentChecksum,
          });
          await tx.lesson.create({
            data: {
              courseId: course.id,
              levelId: resolvedLevelId,
              chapterId,
              name: row.lessonName,
              description: row.description ?? null,
              durationMins: row.durationMins ?? null,
              contentType,
              contentUrl: row.contentUrl,
              contentVersion: metadata.contentVersion,
              contentSizeBytes: metadata.contentSizeBytes,
              contentChecksum: metadata.contentChecksum,
              thumbnailUrl: row.thumbnailUrl ?? null,
              logoUrl: row.logoUrl ?? null,
              visibility: row.visibility ?? LessonVisibility.PRIVATE,
              sequence: seq,
            } as any,
          });
        }
      }
    }, ContentService.IMPORT_TX_OPTS);

    return { coursesCreated, coursesUpdated, rowsProcessed: parsedRows.length };
  }

  private async importContent(
    opts: { ownerOrgId: number | null; source: CourseSource },
    file: { buffer: Buffer; originalname: string },
  ): Promise<ImportResult> {
    const rawRows = this.applyCarryForward(this.parseFile(file.buffer, file.originalname), [
      { canonical: 'courseName', aliases: ['Course name', 'course_name', 'course'] },
      { canonical: 'levelName', aliases: ['Level', 'level_name', 'level'] },
    ]);

    // 1) Validate & normalize all rows first (reject partial uploads)
    const parsedRows: any[] = [];
    const errors: Array<{ row: number; error: string }> = [];

    rawRows.forEach((r, idx) => {
      try {
        parsedRows.push(this.mapRow(r));
      } catch (e: any) {
        errors.push({ row: idx + 2, error: e?.message || 'Invalid row' }); // +2 for header row
      }
    });

    if (errors.length) {
      throw new BadRequestException({
        message: 'Import failed validation. No data was saved.',
        errors,
      });
    }

    // 2) Group by course name (so a single file can contain multiple courses)
    const byCourse = new Map<string, any[]>();
    for (const row of parsedRows) {
      const key = row.courseName;
      const arr = byCourse.get(key) || [];
      arr.push(row);
      byCourse.set(key, arr);
    }

    let coursesCreated = 0;
    let coursesUpdated = 0;

    // 3) Transaction: all-or-nothing
    await this.prisma.$transaction(async (tx) => {
      for (const [courseName, rows] of byCourse.entries()) {
        const existingCourse = await this.findExistingCourseByName(tx, courseName, opts.source, opts.ownerOrgId);

        let courseId: number;
        let courseCode: string;

        const visibility = rows.some((r) => r.courseVisibility === 'PUBLIC')
          ? CourseVisibility.PUBLIC
          : CourseVisibility.PRIVATE;

        if (existingCourse) {
          courseId = existingCourse.id;
          courseCode = existingCourse.courseCode;

          // Update course metadata first (and clear introLevelId) so we can delete levels safely.
          await tx.course.update({
            where: { id: courseId },
            data: {
              courseName,
              description: existingCourse.description,
              courseImageUrl: rows[0]?.courseImageUrl || existingCourse.courseImageUrl,
              logoUrl: rows[0]?.logoUrl || existingCourse.logoUrl,
              visibility,
              source: opts.source,
              ownerOrgId: opts.ownerOrgId,
              introLevelId: null, // will be set below if provided
            },
          });

          // Replace levels/chapters/lessons safely (cascade deletes)
          await tx.level.deleteMany({ where: { courseId } });

          coursesUpdated += 1;
        } else {
          courseCode = await this.nextCourseCode(tx);

          const course = await tx.course.create({
            data: {
              courseCode,
              courseName,
              description: null,
              courseImageUrl: rows[0]?.courseImageUrl || null,
              logoUrl: rows[0]?.logoUrl || null,
              visibility,
              source: opts.source,
              ownerOrgId: opts.ownerOrgId,
            },
          });

          courseId = course.id;
          coursesCreated += 1;
        }

        // Build Level sequence by first appearance
        const levelOrder: string[] = [];
        for (const r of rows) {
          if (!levelOrder.includes(r.levelName)) levelOrder.push(r.levelName);
        }

        const levelIdByName = new Map<string, number>();

        for (let i = 0; i < levelOrder.length; i++) {
          const name = levelOrder[i];
          const sampleRow = rows.find((x) => x.levelName === name);

          const level = await tx.level.create({
            data: {
              courseId,
              name,
              sequence: i + 1,
              description: sampleRow?.levelDescription || null,
            },
          });

          levelIdByName.set(name, level.id);
        }

        // Optional intro level (first row that says isIntroLevel=true)
        const introLevelName = rows.find((r) => r.isIntroLevel === true)?.levelName;
        if (introLevelName) {
          const introLevelId = levelIdByName.get(introLevelName);
          if (introLevelId) {
            await tx.course.update({ where: { id: courseId }, data: { introLevelId } });
          }
        }

        // Chapters and lessons
        // Chapter sequence by appearance within level
        const chapterIdByKey = new Map<string, number>(); // key: `${levelId}::${chapterName}`
        const chapterSeqByLevel = new Map<number, number>();

        const lessonSeqByContainer = new Map<string, number>(); // `${levelId}::${chapterId??0}`

        for (const r of rows) {
          const levelId = levelIdByName.get(r.levelName);
          if (!levelId) continue;

          let chapterId: number | null = null;

          if (r.chapterName) {
            const chapKey = `${levelId}::${r.chapterName}`;
            const existingChapId = chapterIdByKey.get(chapKey);

            if (existingChapId === undefined) {
              const currentSeq = (chapterSeqByLevel.get(levelId) || 0) + 1;
              chapterSeqByLevel.set(levelId, currentSeq);

              const chapter = await tx.chapter.create({
                data: {
                  levelId,
                  name: r.chapterName,
                  sequence: currentSeq,
                  description: r.chapterDescription || null,
                },
              });

              chapterIdByKey.set(chapKey, chapter.id);
              chapterId = chapter.id;
            } else {
              chapterId = existingChapId;
            }
          }

          const containerKey = `${levelId}::${chapterId ?? 0}`;
          const nextSeq = (lessonSeqByContainer.get(containerKey) || 0) + 1;
          lessonSeqByContainer.set(containerKey, nextSeq);
          const contentType = (r.contentType ? (ContentType as any)[r.contentType] : ContentType.VIDEO) as ContentType;
          const metadata = this.nextContentMetadata({
            contentUrl: r.contentUrl,
            contentType,
            contentSizeBytes: r.contentSizeBytes,
            contentChecksum: r.contentChecksum,
          });

          await tx.lesson.create({
            data: {
              courseId,
              levelId,
              chapterId,
              name: r.lessonName,
              sequence: nextSeq,
              description: r.lessonDescription || null,
              durationMins: r.durationMins ?? null,
              contentType,
              contentUrl: r.contentUrl,
              contentVersion: metadata.contentVersion,
              contentSizeBytes: metadata.contentSizeBytes,
              contentChecksum: metadata.contentChecksum,
              logoUrl: r.logoUrl || null,
              visibility: (r.lessonVisibility
                ? (LessonVisibility as any)[r.lessonVisibility]
                : LessonVisibility.PRIVATE) as LessonVisibility,
            } as any,
          });
        }
      }
    }, ContentService.IMPORT_TX_OPTS);

    return { coursesCreated, coursesUpdated, rowsProcessed: parsedRows.length };
  }
}
