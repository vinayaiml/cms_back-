import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CourseAccessType, CourseSource } from '@prisma/client';
import { PrismaModule } from '../../prisma/prisma.module';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseAccessModule } from './course-access.module';
import { CourseAccessService } from './course-access.service';

const validLesson = (overrides: Record<string, unknown> = {}) => ({
  id: 100,
  contentUrl: 'https://cdn.whizrobo.test/content/lesson.mp4',
  contentSizeBytes: 2048,
  contentChecksum: 'a'.repeat(64),
  ...overrides,
});

const assignableCourse = (lessonOverrides: Record<string, unknown> = {}) => ({
  id: 20,
  levels: [
    {
      id: 30,
      lessons: [validLesson({ id: 101, ...lessonOverrides })],
      chapters: [
        {
          id: 40,
          lessons: [validLesson({ id: 102, ...lessonOverrides })],
        },
      ],
    },
  ],
});

describe('CourseAccessService', () => {
  const prisma = {
    course: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    level: {
      findUnique: jest.fn(),
    },
    chapter: {
      findUnique: jest.fn(),
    },
    orgCourseAccess: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
    },
  };

  let service: CourseAccessService;
  let assetProbe: jest.Mock;

  beforeEach(() => {
    jest.resetAllMocks();
    assetProbe = jest.fn().mockResolvedValue({ ok: true, status: 200 });
    service = new CourseAccessService(prisma as unknown as PrismaService, assetProbe);
  });

  function mockPlatformCourseForAssignment(course = assignableCourse()) {
    prisma.course.findUnique
      .mockResolvedValueOnce({ id: 20, source: CourseSource.PLATFORM })
      .mockResolvedValueOnce(course);
  }

  it('creates full-course access when assigned lessons have valid asset metadata', async () => {
    mockPlatformCourseForAssignment();
    prisma.orgCourseAccess.findFirst.mockResolvedValue(null);
    prisma.orgCourseAccess.create.mockResolvedValue({
      id: 1,
      orgId: 7,
      courseId: 20,
      accessType: CourseAccessType.FULL_COURSE,
      levelId: null,
      chapterId: null,
    });

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).resolves.toMatchObject({
      orgId: 7,
      courseId: 20,
      accessType: CourseAccessType.FULL_COURSE,
    });

    expect(prisma.orgCourseAccess.create).toHaveBeenCalledTimes(1);
    expect(assetProbe).toHaveBeenCalledWith('https://cdn.whizrobo.test/content/lesson.mp4');
  });

  it('rejects invalid lesson asset URLs before creating access', async () => {
    mockPlatformCourseForAssignment(assignableCourse({ contentUrl: 'file:///tmp/lesson.mp4' }));

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.orgCourseAccess.findFirst).not.toHaveBeenCalled();
    expect(prisma.orgCourseAccess.create).not.toHaveBeenCalled();
    expect(assetProbe).not.toHaveBeenCalled();
  });

  it('rejects private or credentialed asset URLs before assignment', async () => {
    mockPlatformCourseForAssignment(assignableCourse({ contentUrl: 'https://user:pass@cdn.whizrobo.test/lesson.mp4' }));

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toThrow('Course content asset URLs must not include credentials');

    jest.resetAllMocks();
    mockPlatformCourseForAssignment(assignableCourse({ contentUrl: 'http://127.0.0.1/lesson.mp4' }));

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toThrow('Course content asset URL must use an approved public host');

    expect(prisma.orgCourseAccess.create).not.toHaveBeenCalled();
  });

  it('rejects unavailable public content assets before assignment', async () => {
    mockPlatformCourseForAssignment(assignableCourse({ contentUrl: 'https://cdn.whizrobo.test/missing.mp4' }));
    assetProbe.mockResolvedValue({ ok: false, status: 404 });

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toThrow('Course contains a lesson with unavailable content asset');

    expect(assetProbe).toHaveBeenCalledWith('https://cdn.whizrobo.test/missing.mp4');
    expect(prisma.orgCourseAccess.findFirst).not.toHaveBeenCalled();
    expect(prisma.orgCourseAccess.create).not.toHaveBeenCalled();
  });

  it('rejects invalid checksum metadata before assignment', async () => {
    mockPlatformCourseForAssignment(assignableCourse({ contentChecksum: 'not-a-sha' }));

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toThrow('Course contains a lesson with invalid content checksum');

    expect(prisma.orgCourseAccess.create).not.toHaveBeenCalled();
  });

  it('rejects empty assignment scopes before mutation', async () => {
    mockPlatformCourseForAssignment({
      id: 20,
      levels: [{ id: 30, lessons: [], chapters: [{ id: 40, lessons: [] }] }],
    });
    prisma.chapter.findUnique.mockResolvedValue({ id: 40, level: { courseId: 20 } });

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.CHAPTER_ONLY,
        chapterId: 40,
      }),
    ).rejects.toThrow('Course access assignment contains no lessons');

    expect(prisma.orgCourseAccess.create).not.toHaveBeenCalled();
  });

  it('keeps duplicate access validation after asset validation succeeds', async () => {
    mockPlatformCourseForAssignment();
    prisma.orgCourseAccess.findFirst.mockResolvedValue({ id: 99 });

    await expect(
      service.create(7, { isSuperAdmin: true }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toThrow('This course access is already assigned');
  });

  it('blocks non-super-admin assignment before reading content assets', async () => {
    await expect(
      service.create(7, { isSuperAdmin: false }, {
        courseId: 20,
        accessType: CourseAccessType.FULL_COURSE,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.course.findUnique).not.toHaveBeenCalled();
    expect(prisma.orgCourseAccess.create).not.toHaveBeenCalled();
  });

  it('compiles CourseAccessModule without a custom asset probe provider', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, CourseAccessModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prisma)
      .compile();

    expect(moduleRef.get(CourseAccessService)).toBeInstanceOf(CourseAccessService);
    await moduleRef.close();
  });
});
