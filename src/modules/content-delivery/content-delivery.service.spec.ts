import { ForbiddenException } from "@nestjs/common";
import {
  ContentType,
  CourseAccessType,
  CourseSource,
  CourseVisibility,
  LessonVisibility,
  LicenseStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import { ContentDeliveryService } from "./content-delivery.service";

describe("ContentDeliveryService", () => {
  const prisma = {
    robot: { findUnique: jest.fn() },
    lesson: { findUnique: jest.fn() },
    orgCourseAccess: { findMany: jest.fn() },
    robotCourseAccess: { findMany: jest.fn() },
  };

  let service: ContentDeliveryService;

  const checksum = "a".repeat(64);
  const lesson = {
    id: 500,
    courseId: 50,
    levelId: 5,
    chapterId: 55,
    name: "Lesson",
    sequence: 1,
    description: null,
    durationMins: null,
    contentType: ContentType.VIDEO,
    contentUrl: "https://cdn.whizrobo.test/course-50/lesson-500.mp4",
    contentVersion: 3,
    contentSizeBytes: 1024,
    contentChecksum: checksum,
    isPublished: true,
    thumbnailUrl: null,
    logoUrl: null,
    visibility: LessonVisibility.PRIVATE,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    course: {
      id: 50,
      source: CourseSource.PLATFORM,
      ownerOrgId: null,
      visibility: CourseVisibility.PRIVATE,
      isPublished: true,
    },
  };

  beforeEach(() => {
    process.env.LICENSE_SECRET_KEY = "test-license-secret-key-that-is-long-enough";
    jest.clearAllMocks();
    service = new ContentDeliveryService(prisma as unknown as PrismaService);
    prisma.robot.findUnique.mockResolvedValue({
      id: 10,
      orgId: 1,
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      revokedAt: null,
      licenseStatus: LicenseStatus.ACTIVE,
      org: { id: 1, isActive: true },
    });
    prisma.lesson.findUnique.mockResolvedValue(lesson);
    prisma.orgCourseAccess.findMany.mockResolvedValue([
      {
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);
    prisma.robotCourseAccess.findMany.mockResolvedValue([]);
  });

  it("resolves a valid signed content link without exposing credentials", async () => {
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    const result = await service.resolveDownload(token);

    expect(result).toEqual({
      url: lesson.contentUrl,
      contentType: ContentType.VIDEO,
      contentSizeBytes: 1024,
      contentChecksum: checksum,
    });
    expect(JSON.stringify(result)).not.toMatch(/licenseKey|token|password|secret/i);
  });

  it("rejects expired signed content links", async () => {
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date("2020-01-01T00:00:00.000Z"),
      ttlSeconds: 1,
    });

    await expect(service.resolveDownload(token)).rejects.toThrow(ForbiddenException);
  });

  it("rejects tampered signed content links", async () => {
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    await expect(service.resolveDownload(`${token.slice(0, -2)}xx`)).rejects.toThrow(ForbiddenException);
  });

  it("rejects signed content links with appended tampered segments", async () => {
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    await expect(service.resolveDownload(`${token}.tampered`)).rejects.toThrow(ForbiddenException);
  });

  it.each([
    ["malformed", "not a url"],
    ["unsupported scheme", "file:///etc/passwd"],
    ["credentialed", "https://user:password@cdn.whizrobo.test/lesson.mp4"],
    ["localhost", "http://localhost/lesson.mp4"],
    ["private IP", "http://192.168.1.10/lesson.mp4"],
  ])("rejects %s current asset URLs before redirecting", async (_label, contentUrl) => {
    prisma.lesson.findUnique.mockResolvedValue({ ...lesson, contentUrl });
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    await expect(service.resolveDownload(token)).rejects.toThrow(ForbiddenException);
  });

  it("rejects signed links when the lesson has been unpublished", async () => {
    prisma.lesson.findUnique.mockResolvedValue({ ...lesson, isPublished: false });
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    await expect(service.resolveDownload(token)).rejects.toThrow(ForbiddenException);
  });

  it("rejects signed links when the course has been unpublished", async () => {
    prisma.lesson.findUnique.mockResolvedValue({
      ...lesson,
      course: { ...lesson.course, isPublished: false },
    });
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    await expect(service.resolveDownload(token)).rejects.toThrow(ForbiddenException);
  });

  it("rejects a link when current robot course access no longer allows the lesson", async () => {
    prisma.robotCourseAccess.findMany.mockResolvedValue([
      {
        robotId: 99,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);
    const token = service.createLessonToken(lesson, {
      robotId: 10,
      orgId: 1,
      now: new Date(),
      ttlSeconds: 60,
    });

    await expect(service.resolveDownload(token)).rejects.toThrow(ForbiddenException);
  });
});
