import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import {
  CourseAccessType,
  CourseSource,
  CourseVisibility,
  LessonVisibility,
  LicenseStatus,
} from "@prisma/client";
import { createHmac, timingSafeEqual } from "crypto";
import { PrismaService } from "../../prisma/prisma.service";

type SignedLessonInput = {
  id: number;
  contentVersion?: number | null;
  contentChecksum?: string | null;
  contentSizeBytes?: number | null;
};

type TokenPayload = {
  schemaVersion: 1;
  lessonId: number;
  robotId: number;
  orgId: number;
  contentVersion: number;
  contentChecksum: string | null;
  contentSizeBytes: number | null;
  expiresAt: number;
};

const DEFAULT_TTL_SECONDS = 15 * 60;

@Injectable()
export class ContentDeliveryService {
  constructor(private prisma: PrismaService) {}

  private secret() {
    return process.env.LICENSE_SECRET_KEY || process.env.JWT_SECRET || "test-content-delivery-secret";
  }

  private base64Url(value: Buffer | string) {
    return Buffer.from(value)
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  }

  private fromBase64Url(value: string) {
    const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    return Buffer.from(padded, "base64").toString("utf8");
  }

  private signPayload(payload: string) {
    return this.base64Url(createHmac("sha256", this.secret()).update(payload).digest());
  }

  createLessonToken(
    lesson: SignedLessonInput,
    context: { robotId: number; orgId: number; now?: Date; ttlSeconds?: number },
  ) {
    const payload: TokenPayload = {
      schemaVersion: 1,
      lessonId: lesson.id,
      robotId: context.robotId,
      orgId: context.orgId,
      contentVersion: lesson.contentVersion ?? 1,
      contentChecksum: lesson.contentChecksum ?? null,
      contentSizeBytes: lesson.contentSizeBytes ?? null,
      expiresAt: Math.floor((context.now ?? new Date()).getTime() / 1000) + (context.ttlSeconds ?? DEFAULT_TTL_SECONDS),
    };
    const encoded = this.base64Url(JSON.stringify(payload));
    return `${encoded}.${this.signPayload(encoded)}`;
  }

  getSignedLessonUrl(lesson: SignedLessonInput, context: { robotId: number; orgId: number }) {
    const token = this.createLessonToken(lesson, context);
    return {
      url: `/api/v1/content/delivery/${token}`,
      expiresInSeconds: DEFAULT_TTL_SECONDS,
      resumable: true,
      method: "GET",
    };
  }

  decorateManifestContent<T>(value: T, context: { robotId: number; orgId: number }): T {
    if (!value || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      return value.map((item) => this.decorateManifestContent(item, context)) as T;
    }

    const record = value as Record<string, unknown>;
    const next: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      next[key] = this.decorateManifestContent(item, context);
    }

    if (
      typeof record.id === "number" &&
      typeof record.contentUrl === "string" &&
      Object.prototype.hasOwnProperty.call(record, "contentVersion")
    ) {
      const delivery = this.getSignedLessonUrl(
        {
          id: record.id,
          contentVersion: typeof record.contentVersion === "number" ? record.contentVersion : 1,
          contentChecksum: typeof record.contentChecksum === "string" ? record.contentChecksum : null,
          contentSizeBytes: typeof record.contentSizeBytes === "number" ? record.contentSizeBytes : null,
        },
        context,
      );
      next.contentUrl = delivery.url;
      next.contentDelivery = delivery;
    }

    return next as T;
  }

  private parseToken(token: string): TokenPayload {
    const parts = token.split(".");
    if (parts.length !== 2) {
      throw new ForbiddenException("Invalid content link");
    }
    const [encoded, signature] = parts;
    if (!encoded || !signature) {
      throw new ForbiddenException("Invalid content link");
    }

    const expected = this.signPayload(encoded);
    const providedBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      throw new ForbiddenException("Invalid content link");
    }

    let payload: TokenPayload;
    try {
      payload = JSON.parse(this.fromBase64Url(encoded)) as TokenPayload;
    } catch {
      throw new ForbiddenException("Invalid content link");
    }

    if (
      payload.schemaVersion !== 1 ||
      !Number.isInteger(payload.lessonId) ||
      !Number.isInteger(payload.robotId) ||
      !Number.isInteger(payload.orgId) ||
      !Number.isInteger(payload.contentVersion) ||
      !Number.isInteger(payload.expiresAt)
    ) {
      throw new ForbiddenException("Invalid content link");
    }

    if (payload.expiresAt <= Math.floor(Date.now() / 1000)) {
      throw new ForbiddenException("Content link expired");
    }

    return payload;
  }

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null) {
    if (revokedAt) return LicenseStatus.REVOKED;
    return new Date() > validUntil ? LicenseStatus.EXPIRED : LicenseStatus.ACTIVE;
  }

  private assignmentAllowsLesson(
    assignment: { accessType: CourseAccessType; levelId: number | null; chapterId: number | null },
    lesson: { levelId: number; chapterId: number | null },
  ) {
    if (assignment.accessType === CourseAccessType.FULL_COURSE) return true;
    if (assignment.accessType === CourseAccessType.LEVEL_ONLY) return assignment.levelId === lesson.levelId;
    return assignment.chapterId !== null && assignment.chapterId === lesson.chapterId;
  }

  private isPrivateIpAddress(hostname: string) {
    if (/^127\./.test(hostname) || hostname === "0.0.0.0") return true;
    if (/^10\./.test(hostname)) return true;
    if (/^192\.168\./.test(hostname)) return true;

    const match = hostname.match(/^172\.(\d{1,3})\./);
    if (match) {
      const secondOctet = Number(match[1]);
      if (secondOctet >= 16 && secondOctet <= 31) return true;
    }

    return false;
  }

  private assertSafeCurrentAssetUrl(contentUrl: string) {
    let parsed: URL;
    try {
      parsed = new URL(contentUrl);
    } catch {
      throw new ForbiddenException("Content asset is unavailable");
    }

    if (!["https:", "http:"].includes(parsed.protocol)) {
      throw new ForbiddenException("Content asset is unavailable");
    }

    if (parsed.username || parsed.password) {
      throw new ForbiddenException("Content asset is unavailable");
    }

    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === "localhost" ||
      hostname.endsWith(".localhost") ||
      hostname.endsWith(".local") ||
      this.isPrivateIpAddress(hostname)
    ) {
      throw new ForbiddenException("Content asset is unavailable");
    }
  }

  private async assertLessonCurrentlyAllowed(payload: TokenPayload) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: payload.robotId },
      include: { org: { select: { id: true, isActive: true } } },
    });
    if (!robot || robot.orgId !== payload.orgId || !robot.org.isActive) {
      throw new ForbiddenException("Content link is not authorized");
    }

    const licenseStatus = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    if (licenseStatus === LicenseStatus.EXPIRED || licenseStatus === LicenseStatus.REVOKED) {
      throw new ForbiddenException("Content link is not authorized");
    }

    const lesson = await this.prisma.lesson.findUnique({
      where: { id: payload.lessonId },
      include: { course: { select: { id: true, source: true, ownerOrgId: true, visibility: true } } },
    });
    if (!lesson) throw new NotFoundException("Content asset not found");

    if ((lesson as any).isPublished === false || (lesson.course as any).isPublished === false) {
      throw new ForbiddenException("Content asset is unavailable");
    }

    if (
      lesson.contentVersion !== payload.contentVersion ||
      (lesson.contentChecksum ?? null) !== payload.contentChecksum ||
      (lesson.contentSizeBytes ?? null) !== payload.contentSizeBytes
    ) {
      throw new ForbiddenException("Content link expired");
    }

    if (!lesson.contentUrl || (lesson.contentSizeBytes !== null && lesson.contentSizeBytes < 0)) {
      throw new ForbiddenException("Content asset is unavailable");
    }
    this.assertSafeCurrentAssetUrl(lesson.contentUrl);
    if (lesson.contentChecksum !== null && !/^[a-f0-9]{64}$/i.test(lesson.contentChecksum)) {
      throw new ForbiddenException("Content asset is unavailable");
    }

    if (
      lesson.course.visibility === CourseVisibility.PUBLIC &&
      lesson.visibility === LessonVisibility.PUBLIC_PREVIEW
    ) {
      return lesson;
    }

    const orgOwnsCourse =
      lesson.course.source !== CourseSource.PLATFORM && lesson.course.ownerOrgId === payload.orgId;
    const orgAssignments = orgOwnsCourse
      ? [{ accessType: CourseAccessType.FULL_COURSE, levelId: null, chapterId: null }]
      : await this.prisma.orgCourseAccess.findMany({
          where: { orgId: payload.orgId, courseId: lesson.courseId },
          select: { accessType: true, levelId: true, chapterId: true },
        });
    if (!orgAssignments.some((assignment) => this.assignmentAllowsLesson(assignment, lesson))) {
      throw new ForbiddenException("Content link is not authorized");
    }

    const robotAssignments = await (this.prisma as any).robotCourseAccess.findMany({
      where: { isEnabled: true, courseId: lesson.courseId, robot: { orgId: payload.orgId } },
      select: { robotId: true, accessType: true, levelId: true, chapterId: true },
    });
    if (
      robotAssignments.length > 0 &&
      !robotAssignments.some(
        (assignment: { robotId: number; accessType: CourseAccessType; levelId: number | null; chapterId: number | null }) =>
          assignment.robotId === payload.robotId &&
          this.assignmentAllowsLesson(assignment, lesson),
      )
    ) {
      throw new ForbiddenException("Content link is not authorized");
    }

    return lesson;
  }

  async resolveDownload(token: string) {
    const lesson = await this.assertLessonCurrentlyAllowed(this.parseToken(token));
    return {
      url: lesson.contentUrl,
      contentType: lesson.contentType,
      contentSizeBytes: lesson.contentSizeBytes,
      contentChecksum: lesson.contentChecksum,
    };
  }
}
