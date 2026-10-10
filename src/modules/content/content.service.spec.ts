import { ForbiddenException } from '@nestjs/common';
import {
  ContentType,
  CourseAccessType,
  CourseSource,
  CourseVisibility,
  LessonVisibility,
} from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { ContentService } from './content.service';

const orgActor = {
  type: 'user' as const,
  sub: 10,
  userId: 10,
  email: 'admin@example.com',
  orgId: 1,
  isSuperAdmin: false,
};

function lesson(overrides: Record<string, unknown> = {}) {
  return {
    id: 100,
    name: 'Lesson',
    sequence: 1,
    description: 'Lesson description',
    durationMins: 10,
    contentType: ContentType.VIDEO,
    contentUrl: 'https://cdn.example.com/lesson.mp4',
    contentVersion: 1,
    contentSizeBytes: 2048,
    contentChecksum: 'a'.repeat(64),
    thumbnailUrl: null,
    logoUrl: null,
    visibility: LessonVisibility.PRIVATE,
    chapterId: 40,
    levelId: 30,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function course(overrides: Record<string, unknown> = {}) {
  return {
    id: 20,
    courseCode: 'PLAT-101',
    courseName: 'Platform Course',
    description: 'Course description',
    courseImageUrl: null,
    logoUrl: null,
    visibility: CourseVisibility.PRIVATE,
    source: CourseSource.PLATFORM,
    ownerOrgId: null,
    introLevelId: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    levels: [
      {
        id: 30,
        name: 'Level 1',
        sequence: 1,
        description: 'Level 1 description',
        courseId: 20,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        chapters: [
          {
            id: 40,
            name: 'Chapter 1',
            sequence: 1,
            description: 'Chapter 1 description',
            levelId: 30,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            lessons: [lesson({ id: 100, chapterId: 40, name: 'Chapter 1 Lesson' })],
          },
          {
            id: 41,
            name: 'Chapter 2',
            sequence: 2,
            description: 'Chapter 2 description',
            levelId: 30,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            lessons: [lesson({ id: 101, chapterId: 41, name: 'Chapter 2 Lesson' })],
          },
        ],
        lessons: [lesson({ id: 102, chapterId: null, name: 'Direct Level Lesson' })],
      },
      {
        id: 31,
        name: 'Level 2',
        sequence: 2,
        description: 'Level 2 description',
        courseId: 20,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        chapters: [
          {
            id: 42,
            name: 'Chapter 3',
            sequence: 1,
            description: 'Chapter 3 description',
            levelId: 31,
            createdAt: new Date('2026-01-01T00:00:00.000Z'),
            updatedAt: new Date('2026-01-01T00:00:00.000Z'),
            lessons: [lesson({ id: 103, levelId: 31, chapterId: 42, name: 'Level 2 Lesson' })],
          },
        ],
        lessons: [],
      },
    ],
    ...overrides,
  };
}

describe('ContentService tenant access matrix', () => {
  const prisma = {
    course: {
      findUnique: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    level: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    chapter: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    lesson: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    orgCourseAccess: {
      findMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: ContentService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new ContentService(prisma as unknown as PrismaService);
  });

  function mockCourseRead(assignments: unknown[], details = course()) {
    prisma.course.findUnique
      .mockResolvedValueOnce({
        id: 20,
        source: CourseSource.PLATFORM,
        ownerOrgId: null,
      })
      .mockResolvedValueOnce(details);
    prisma.orgCourseAccess.findMany.mockResolvedValue(assignments);
  }

  it('returns all levels, chapters and lessons for FULL_COURSE access', async () => {
    mockCourseRead([
      {
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);

    const result = await service.getCourseDetails(orgActor, 20);

    expect(result.levels.map((level) => level.id)).toEqual([30, 31]);
    expect(result.levels[0].chapters.map((chapter) => chapter.id)).toEqual([40, 41]);
    expect(result.levels[0].directLessons.map((item) => item.id)).toEqual([102]);
  });

  it('returns only the assigned level for LEVEL_ONLY access', async () => {
    mockCourseRead([
      {
        accessType: CourseAccessType.LEVEL_ONLY,
        levelId: 31,
        chapterId: null,
      },
    ]);

    const result = await service.getCourseDetails(orgActor, 20);

    expect(result.levels.map((level) => level.id)).toEqual([31]);
    expect(result.levels[0].chapters.map((chapter) => chapter.id)).toEqual([42]);
  });

  it('returns only the assigned chapter and removes unassigned direct lessons for CHAPTER_ONLY access', async () => {
    mockCourseRead([
      {
        accessType: CourseAccessType.CHAPTER_ONLY,
        levelId: null,
        chapterId: 41,
      },
    ]);

    const result = await service.getCourseDetails(orgActor, 20);

    expect(result.levels.map((level) => level.id)).toEqual([30]);
    expect(result.levels[0].chapters.map((chapter) => chapter.id)).toEqual([41]);
    expect(result.levels[0].chapters[0].lessons.map((item) => item.id)).toEqual([101]);
    expect(result.levels[0].directLessons).toEqual([]);
  });

  it('rejects unassigned platform course direct access before returning content', async () => {
    mockCourseRead([]);

    await expect(service.getCourseDetails(orgActor, 20)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.course.findUnique).toHaveBeenCalledTimes(1);
  });

  it('rejects cross-tenant organization-owned course direct access', async () => {
    prisma.course.findUnique.mockResolvedValueOnce({
      id: 20,
      source: CourseSource.ORGANIZATION,
      ownerOrgId: 2,
    });

    await expect(service.getCourseDetails(orgActor, 20)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.orgCourseAccess.findMany).not.toHaveBeenCalled();
  });

  it('rejects corrupted assigned platform access before returning content', async () => {
    mockCourseRead([
      {
        accessType: CourseAccessType.LEVEL_ONLY,
        levelId: 999,
        chapterId: null,
      },
    ]);

    await expect(service.getCourseDetails(orgActor, 20)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('keeps checksum and version unchanged when lesson file metadata is unchanged', async () => {
    const existing = {
      ...lesson(),
      level: { courseId: 20, course: { id: 20, source: CourseSource.ORGANIZATION, ownerOrgId: 1 } },
    };
    prisma.lesson.findUnique.mockResolvedValue(existing);
    prisma.course.findUnique.mockResolvedValue({ id: 20, source: CourseSource.ORGANIZATION, ownerOrgId: 1 });
    prisma.lesson.update.mockResolvedValue({});

    await service.updateLesson(orgActor, 100, {
      contentUrl: existing.contentUrl,
      contentChecksum: existing.contentChecksum,
      contentSizeBytes: existing.contentSizeBytes,
    });

    expect(prisma.lesson.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        contentUrl: existing.contentUrl,
        contentVersion: 1,
        contentSizeBytes: 2048,
        contentChecksum: 'a'.repeat(64),
      }),
    });
  });

  it('increments content version when the lesson file metadata changes', async () => {
    const existing = {
      ...lesson(),
      level: { courseId: 20, course: { id: 20, source: CourseSource.ORGANIZATION, ownerOrgId: 1 } },
    };
    prisma.lesson.findUnique.mockResolvedValue(existing);
    prisma.course.findUnique.mockResolvedValue({ id: 20, source: CourseSource.ORGANIZATION, ownerOrgId: 1 });
    prisma.lesson.update.mockResolvedValue({});

    await service.updateLesson(orgActor, 100, {
      contentUrl: 'https://cdn.example.com/lesson-v2.mp4',
      contentChecksum: 'b'.repeat(64),
      contentSizeBytes: 4096,
    });

    expect(prisma.lesson.update).toHaveBeenCalledWith({
      where: { id: 100 },
      data: expect.objectContaining({
        contentUrl: 'https://cdn.example.com/lesson-v2.mp4',
        contentVersion: 2,
        contentSizeBytes: 4096,
        contentChecksum: 'b'.repeat(64),
      }),
    });
  });

  it('rejects invalid lesson file metadata', async () => {
    const existing = {
      ...lesson(),
      level: { courseId: 20, course: { id: 20, source: CourseSource.ORGANIZATION, ownerOrgId: 1 } },
    };
    prisma.lesson.findUnique.mockResolvedValue(existing);
    prisma.course.findUnique.mockResolvedValue({ id: 20, source: CourseSource.ORGANIZATION, ownerOrgId: 1 });

    await expect(
      service.updateLesson(orgActor, 100, { contentChecksum: 'not-a-sha' }),
    ).rejects.toThrow('contentChecksum must be a SHA-256 hex string');
    await expect(
      service.updateLesson(orgActor, 100, { contentSizeBytes: -1 }),
    ).rejects.toThrow('contentSizeBytes must be a non-negative integer');
    expect(prisma.lesson.update).not.toHaveBeenCalled();
  });
});
