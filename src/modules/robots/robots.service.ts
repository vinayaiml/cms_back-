import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  AuditEvent,
  CourseAccessType,
  CourseSource,
  CourseVisibility,
  LessonVisibility,
  LicenseStatus,
  Prisma,
} from "@prisma/client";
import { randomBytes } from "crypto";
import { AuditService } from "../audit/audit.service";
import {
  decryptLicenseKey,
  encryptLicenseKey,
  licenseFingerprint,
  maskLicenseKey,
} from "../../common/security/license-secret";
import { normalizeRobotHardwareProfile } from "./robot-hardware-profile";
import { UpsertRobotCapabilityAssignmentDto } from "./robots.dto";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { RobotManifestResolver } from "../robot-sync/robot-manifest.resolver";

type Allowed = {
  full: boolean;
  levelIds: Set<number>;
  chapterIds: Set<number>;
};

type AssignmentRow = {
  courseId: number;
  accessType: CourseAccessType;
  levelId: number | null;
  chapterId: number | null;
};

type ScopedAssignmentRow = AssignmentRow & {
  robotId?: number;
  userId?: number;
};

type CourseWithLevels = Prisma.CourseGetPayload<{
  include: {
    levels: {
      include: {
        chapters: { include: { lessons: true } };
        lessons: true;
      };
    };
  };
}>;

type PublicCourse = Prisma.CourseGetPayload<{
  include: {
    introLevel: {
      include: {
        chapters: { include: { lessons: true } };
        lessons: true;
      };
    };
  };
}>;

@Injectable()
export class RobotsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private entitlements: EntitlementsService,
    private manifestResolver: RobotManifestResolver,
  ) {}

  private readonly robotSelect = {
    id: true,
    orgId: true,
    serialNumber: true,
    name: true,
    validFrom: true,
    validUntil: true,
    licenseStatus: true,
    revokedAt: true,
    lastSeenAt: true,
    appVersion: true,
    deviceModel: true,
    deviceMetadata: true,
    hardwareModel: true,
    hardwareProfile: true,
    hardwareCapabilities: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  private readonly robotEnrollmentSelect = {
    ...this.robotSelect,
    licenseKey: true,
    licenseKeyCiphertext: true,
  } as const;

  private readonly protectedRobotSelect = {
    ...this.robotSelect,
    licenseKey: true,
    licenseKeyCiphertext: true,
    licenseKeyFingerprint: true,
  } as const;

  private readonly superAdminRobotSelect = {
    ...this.robotSelect,
    licenseKey: true,
    licenseKeyCiphertext: true,
  } as const;

  private buildFleetWhere(
    filters: {
      orgId?: number;
      status?: LicenseStatus;
      model?: string;
      version?: string;
      lastSeenFrom?: Date;
      lastSeenTo?: Date;
    } = {},
  ): Prisma.RobotWhereInput {
    const where: Prisma.RobotWhereInput = {};

    if (filters.orgId !== undefined) where.orgId = filters.orgId;
    if (filters.status) where.licenseStatus = filters.status;
    if (filters.model) where.hardwareModel = filters.model;
    if (filters.version) where.appVersion = filters.version;
    if (filters.lastSeenFrom || filters.lastSeenTo) {
      where.lastSeenAt = {
        ...(filters.lastSeenFrom ? { gte: filters.lastSeenFrom } : {}),
        ...(filters.lastSeenTo ? { lte: filters.lastSeenTo } : {}),
      };
    }

    return where;
  }

  private clampLimit(limit?: number) {
    if (limit === undefined || !Number.isFinite(limit)) return undefined;
    return Math.min(Math.max(Math.trunc(limit), 1), 100);
  }

  private computeLicenseStatus(
    validUntil: Date,
    revokedAt: Date | null,
  ): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft =
      (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private toRobotReassignmentHistoryItem(event: AuditEvent) {
    const metadata =
      event.metadata &&
      typeof event.metadata === "object" &&
      !Array.isArray(event.metadata)
        ? (event.metadata as Record<string, unknown>)
        : {};

    return {
      id: event.id,
      robotId: Number(event.targetId),
      actorUserId: event.actorUserId,
      actorOrgId: event.actorOrgId,
      oldOrgId:
        typeof metadata.oldOrgId === "number" ? metadata.oldOrgId : null,
      newOrgId:
        typeof metadata.newOrgId === "number"
          ? metadata.newOrgId
          : event.targetOrgId,
      targetOrgId: event.targetOrgId,
      correlationId: event.correlationId,
      createdAt: event.createdAt,
    };
  }

  private toRobotAuditHistoryItem(event: AuditEvent) {
    const sanitizedMetadata = this.audit.sanitizeMetadata(event.metadata);

    return {
      id: event.id,
      action: event.action,
      actorUserId: event.actorUserId,
      actorOrgId: event.actorOrgId,
      targetOrgId: event.targetOrgId,
      correlationId: event.correlationId,
      metadata:
        sanitizedMetadata && typeof sanitizedMetadata === "object"
          ? sanitizedMetadata
          : null,
      createdAt: event.createdAt,
    };
  }

  private validateCapabilityLimits(
    value: unknown,
    depth = 0,
  ): Prisma.JsonValue {
    if (depth > 4)
      throw new BadRequestException("Capability limits are too deeply nested");
    if (value === null) return null;

    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000) {
        throw new BadRequestException(
          "Capability limits contain invalid numeric value",
        );
      }
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 120)
        throw new BadRequestException(
          "Capability limits contain invalid text value",
        );
      if (
        /token|secret|password|license|jwt|authorization|cookie|private/i.test(
          trimmed,
        )
      ) {
        throw new BadRequestException(
          "Capability limits contain prohibited value",
        );
      }
      return trimmed;
    }
    if (Array.isArray(value)) {
      if (value.length > 20)
        throw new BadRequestException(
          "Capability limits contain too many values",
        );
      return value.map((item) =>
        this.validateCapabilityLimits(item, depth + 1),
      ) as Prisma.JsonArray;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 20)
        throw new BadRequestException(
          "Capability limits contain too many keys",
        );
      const clean: Record<string, Prisma.JsonValue> = {};
      for (const [key, item] of entries) {
        const normalizedKey = key.trim();
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(normalizedKey)) {
          throw new BadRequestException(
            "Capability limits contain invalid key",
          );
        }
        if (
          /password|passcode|token|jwt|secret|authorization|cookie|hash|apiKey|licenseKey|privateKey|accessKey|refreshToken/i.test(
            normalizedKey,
          )
        ) {
          throw new BadRequestException(
            "Capability limits contain prohibited key",
          );
        }
        clean[normalizedKey] = this.validateCapabilityLimits(item, depth + 1);
      }
      return clean as Prisma.JsonObject;
    }

    throw new BadRequestException(
      "Capability limits contain unsupported value",
    );
  }

  private buildAllowedMap(assignments: AssignmentRow[]) {
    const map = new Map<number, Allowed>();

    for (const a of assignments) {
      const entry = map.get(a.courseId) || {
        full: false,
        levelIds: new Set<number>(),
        chapterIds: new Set<number>(),
      };

      if (a.accessType === CourseAccessType.FULL_COURSE) {
        entry.full = true;
      } else if (a.accessType === CourseAccessType.LEVEL_ONLY && a.levelId) {
        entry.levelIds.add(a.levelId);
      } else if (
        a.accessType === CourseAccessType.CHAPTER_ONLY &&
        a.chapterId
      ) {
        entry.chapterIds.add(a.chapterId);
      }

      map.set(a.courseId, entry);
    }

    return map;
  }

  private filterCourseByAllowed(course: any, allowed: Allowed) {
    if (allowed.full) return course;

    const filteredLevels: any[] = [];
    for (const level of course.levels || []) {
      if (allowed.levelIds.has(level.id)) {
        filteredLevels.push(level);
        continue;
      }

      const keptChapters = (level.chapters || []).filter((ch: any) =>
        allowed.chapterIds.has(ch.id),
      );
      if (keptChapters.length > 0) {
        filteredLevels.push({
          ...level,
          chapters: keptChapters,
          lessons: [],
        });
      }
    }

    if (!filteredLevels.length) return null;
    return { ...course, levels: filteredLevels };
  }

  private async buildManifestContent(
    orgId: number,
    scope?: { robotId?: number; userId?: number },
  ) {
    const orgOwnedCourses: CourseWithLevels[] = await this.prisma.course.findMany({
      where: { ownerOrgId: orgId, isPublished: true } as any,
      orderBy: { id: "asc" },
      include: {
        levels: {
          orderBy: { sequence: "asc" },
          include: {
            chapters: {
              orderBy: { sequence: "asc" },
              include: {
                lessons: {
                  where: { isPublished: true } as any,
                  orderBy: { sequence: "asc" },
                },
              },
            },
            lessons: {
              where: { chapterId: null, isPublished: true } as any,
              orderBy: { sequence: "asc" },
            },
          },
        },
      },
    });

    const assignments: AssignmentRow[] = await this.prisma.orgCourseAccess.findMany({
      where: { orgId },
      select: {
        courseId: true,
        accessType: true,
        levelId: true,
        chapterId: true,
      },
    });
    const allowedMap = this.buildAllowedMap(assignments);
    const robotAssignments: ScopedAssignmentRow[] = scope?.robotId
      ? await (this.prisma as any).robotCourseAccess.findMany({
          where: { isEnabled: true, robot: { orgId } },
          select: {
            robotId: true,
            courseId: true,
            accessType: true,
            levelId: true,
            chapterId: true,
          },
        })
      : [];
    const userAssignments: ScopedAssignmentRow[] = scope?.userId
      ? await (this.prisma as any).userCourseAccess.findMany({
          where: { isEnabled: true, user: { orgId } },
          select: {
            userId: true,
            courseId: true,
            accessType: true,
            levelId: true,
            chapterId: true,
          },
        })
      : [];
    const robotScopedCourseIds = new Set(
      robotAssignments.map((assignment) => assignment.courseId),
    );
    const userScopedCourseIds = new Set(
      userAssignments.map((assignment) => assignment.courseId),
    );
    const robotAllowedMap = this.buildAllowedMap(
      robotAssignments.filter((assignment) => assignment.robotId === scope?.robotId),
    );
    const userAllowedMap = this.buildAllowedMap(
      userAssignments.filter((assignment) => assignment.userId === scope?.userId),
    );
    const assignedCourseIds = Array.from(
      new Set(assignments.map((a) => a.courseId)),
    );
    const assignedPlatformCourses: CourseWithLevels[] = assignedCourseIds.length
      ? await this.prisma.course.findMany({
          where: {
            id: { in: assignedCourseIds },
            source: CourseSource.PLATFORM,
            isPublished: true,
          } as any,
          orderBy: { id: "asc" },
          include: {
            levels: {
              orderBy: { sequence: "asc" },
              include: {
                chapters: {
                  orderBy: { sequence: "asc" },
                  include: {
                    lessons: {
                      where: { isPublished: true } as any,
                      orderBy: { sequence: "asc" },
                    },
                  },
                },
                lessons: {
                  where: { chapterId: null, isPublished: true } as any,
                  orderBy: { sequence: "asc" },
                },
              },
            },
          },
        })
      : [];

    const filteredAssigned = assignedPlatformCourses
      .map((course) => {
        const allow = allowedMap.get(course.id);
        if (!allow) return null;
        const orgFiltered = this.filterCourseByAllowed(course, allow);
        if (!orgFiltered) return null;
        const robotAllow = robotAllowedMap.get(course.id);
        const robotFiltered = robotScopedCourseIds.has(course.id)
          ? robotAllow
            ? this.filterCourseByAllowed(orgFiltered, robotAllow)
            : null
          : orgFiltered;
        if (!robotFiltered) return null;
        if (!userScopedCourseIds.has(course.id)) return robotFiltered;
        const userAllow = userAllowedMap.get(course.id);
        if (!userAllow) return null;
        return this.filterCourseByAllowed(robotFiltered, userAllow);
      })
      .filter((course): course is CourseWithLevels => Boolean(course));

    const scopedOrgOwnedCourses = robotScopedCourseIds.size || userScopedCourseIds.size
      ? orgOwnedCourses
          .map((course) => {
            const robotAllow = robotAllowedMap.get(course.id);
            const robotFiltered = robotScopedCourseIds.has(course.id)
              ? robotAllow
                ? this.filterCourseByAllowed(course, robotAllow)
                : null
              : course;
            if (!robotFiltered) return null;
            if (!userScopedCourseIds.has(course.id)) return robotFiltered;
            const userAllow = userAllowedMap.get(course.id);
            if (!userAllow) return null;
            return this.filterCourseByAllowed(robotFiltered, userAllow);
          })
          .filter((course): course is CourseWithLevels => Boolean(course))
      : orgOwnedCourses;

    const publicCourses: PublicCourse[] = await this.prisma.course.findMany({
      where: {
        visibility: CourseVisibility.PUBLIC,
        isPublished: true,
        introLevelId: { not: null },
      } as any,
      orderBy: { id: "asc" },
      include: {
        introLevel: {
          include: {
            chapters: {
              orderBy: { sequence: "asc" },
              include: {
                lessons: {
                  where: { visibility: LessonVisibility.PUBLIC_PREVIEW, isPublished: true } as any,
                  orderBy: { sequence: "asc" },
                },
              },
            },
            lessons: {
              where: {
                chapterId: null,
                visibility: LessonVisibility.PUBLIC_PREVIEW,
                isPublished: true,
              } as any,
              orderBy: { sequence: "asc" },
            },
          },
        },
      },
    });

    return {
      myCourses: [...scopedOrgOwnedCourses, ...filteredAssigned],
      publicCatalog: publicCourses.map((course) => ({
        id: course.id,
        courseCode: course.courseCode,
        courseName: course.courseName,
        description: course.description,
        courseImageUrl: course.courseImageUrl,
        logoUrl: course.logoUrl,
        introLevel: course.introLevel,
      })),
    };
  }

  private sanitizeCapabilityLimits(
    limits?: Record<string, unknown>,
  ): Prisma.InputJsonObject | null {
    if (limits === undefined || limits === null) return null;
    if (typeof limits !== "object" || Array.isArray(limits))
      throw new BadRequestException("Capability limits must be an object");
    return this.validateCapabilityLimits(
      limits,
    ) as unknown as Prisma.InputJsonObject;
  }

  private toRobotCapabilityAssignmentResponse(assignment: {
    id: number;
    robotId: number;
    capabilityId: number;
    isEnabled: boolean;
    limits: Prisma.JsonValue | null;
    createdByUserId: number | null;
    createdAt: Date;
    updatedAt: Date;
    capability: { stableKey: string; name: string };
    robot?: { orgId: number };
  }) {
    return {
      id: assignment.id,
      robotId: assignment.robotId,
      orgId: assignment.robot?.orgId,
      capabilityId: assignment.capabilityId,
      capabilityStableKey: assignment.capability.stableKey,
      capabilityName: assignment.capability.name,
      isEnabled: assignment.isEnabled,
      limits: assignment.limits,
      createdByUserId: assignment.createdByUserId,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    };
  }

  private async getOrgEffectiveCapabilityKeys(
    orgId: number,
    hardware?: {
      hardwareModel?: string | null;
      hardwareProfile?: Prisma.JsonValue | null;
      hardwareCapabilities?: Prisma.JsonValue | null;
    },
  ) {
    return this.entitlements.resolveCapabilityKeys({
      orgId,
      hardwareModel: hardware?.hardwareModel,
      hardwareProfile: hardware?.hardwareProfile,
      hardwareCapabilities: hardware?.hardwareCapabilities,
      enforceHardware: hardware !== undefined,
    });
  }

  private generateLicenseKeyCandidate(): string {
    const value = randomBytes(4).readUInt32BE(0) % 1_000_000;
    return `WHRB${value.toString().padStart(6, "0")}`;
  }

  private async generateUniqueLicenseKey(): Promise<string> {
    for (let attempt = 0; attempt < 20; attempt++) {
      const licenseKey = this.generateLicenseKeyCandidate();
      const existing = await this.prisma.robot.findFirst({
        where: {
          OR: [
            { licenseKey },
            { licenseKeyFingerprint: licenseFingerprint(licenseKey) },
          ],
        },
        select: { id: true },
      });
      if (!existing) return licenseKey;
    }

    throw new Error("Unable to generate unique robot license key");
  }

  private readProtectedLicenseKey(robot: {
    licenseKey: string | null;
    licenseKeyCiphertext?: string | null;
  }) {
    if (robot.licenseKeyCiphertext)
      return decryptLicenseKey(robot.licenseKeyCiphertext);
    return robot.licenseKey;
  }

  private toSuperAdminRobotResponse<
    T extends {
      licenseKey: string | null;
      licenseKeyCiphertext?: string | null;
    },
  >(robot: T) {
    const fullLicenseKey = this.readProtectedLicenseKey(robot);
    const {
      licenseKey: _legacyLicenseKey,
      licenseKeyCiphertext: _ciphertext,
      ...rest
    } = robot;

    return {
      ...rest,
      licenseKey: fullLicenseKey,
      licenseKeyMasked: maskLicenseKey(fullLicenseKey),
    };
  }

  async listByOrg(
    orgId: number,
    filters: {
      status?: LicenseStatus;
      model?: string;
      version?: string;
      lastSeenFrom?: Date;
      lastSeenTo?: Date;
      limit?: number;
    } = {},
  ) {
    const take = this.clampLimit(filters.limit);
    return this.prisma.robot.findMany({
      where: this.buildFleetWhere({ ...filters, orgId }),
      orderBy: { id: "desc" },
      ...(take ? { take } : {}),
      select: this.robotSelect,
    });
  }

  async listAll(
    filters: {
      orgId?: number;
      status?: LicenseStatus;
      model?: string;
      version?: string;
      lastSeenFrom?: Date;
      lastSeenTo?: Date;
      limit?: number;
    } = {},
  ) {
    const take = this.clampLimit(filters.limit);
    const robots = await this.prisma.robot.findMany({
      where: this.buildFleetWhere(filters),
      orderBy: { id: "desc" },
      ...(take ? { take } : {}),
      select: {
        ...this.superAdminRobotSelect,
        org: { select: { id: true, name: true } },
      },
    });

    return robots.map((robot) => this.toSuperAdminRobotResponse(robot));
  }

  async getDetail(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
    limit = 50,
  ) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      select: {
        ...this.robotSelect,
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            tenantVersion: true,
          },
        },
      },
    });
    if (!robot) throw new NotFoundException("Robot not found");
    await this.ensureOrgAccess(actor, robot.orgId);

    const take = Math.min(
      Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 50, 1),
      100,
    );
    const auditHistory = await this.prisma.auditEvent.findMany({
      where: {
        targetType: "robot",
        targetId: String(robotId),
      },
      orderBy: { createdAt: "desc" },
      take,
    });
    const {
      licenseKey: _licenseKey,
      licenseKeyCiphertext: _licenseKeyCiphertext,
      licenseKeyFingerprint: _licenseKeyFingerprint,
      ...safeRobot
    } = robot as typeof robot & {
      licenseKey?: string | null;
      licenseKeyCiphertext?: string | null;
      licenseKeyFingerprint?: string | null;
    };

    return {
      robot: safeRobot,
      license: {
        status: robot.licenseStatus,
        validFrom: robot.validFrom,
        validUntil: robot.validUntil,
        revokedAt: robot.revokedAt,
      },
      auditHistory: auditHistory.map((event) =>
        this.toRobotAuditHistoryItem(event),
      ),
    };
  }

  async getManifestPreview(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
    appVersionCode?: number,
  ) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            tenantVersion: true,
          },
        },
      },
    });
    if (!robot) throw new NotFoundException("Robot not found");
    await this.ensureOrgAccess(actor, robot.orgId);

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    const locked =
      !robot.org.isActive ||
      status === LicenseStatus.EXPIRED ||
      status === LicenseStatus.REVOKED;
    const reason = !robot.org.isActive ? "ORG_INACTIVE" : locked ? status : undefined;

    const content = locked
      ? { myCourses: [], publicCatalog: [] }
      : await this.buildManifestContent(robot.orgId, { robotId: robot.id });

    return this.manifestResolver.resolve({
      robot,
      licenseStatus: status,
      locked,
      ...(reason ? { reason } : {}),
      appVersionCode,
      myCourses: content.myCourses,
      publicCatalog: content.publicCatalog,
    });
  }

  async getUserManifestPreview(
    robotId: number,
    userId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
    appVersionCode?: number,
  ) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            tenantVersion: true,
          },
        },
      },
    });
    if (!robot) throw new NotFoundException("Robot not found");
    await this.ensureOrgAccess(actor, robot.orgId);

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, orgId: true, isLocked: true },
    });
    if (!user || user.orgId !== robot.orgId) {
      throw new ForbiddenException("User is not in the robot organization");
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    const locked =
      !robot.org.isActive ||
      user.isLocked ||
      status === LicenseStatus.EXPIRED ||
      status === LicenseStatus.REVOKED;
    const reason = !robot.org.isActive
      ? "ORG_INACTIVE"
      : user.isLocked
        ? "USER_LOCKED"
        : locked
          ? status
          : undefined;

    const content = locked
      ? { myCourses: [], publicCatalog: [] }
      : await this.buildManifestContent(robot.orgId, {
          robotId: robot.id,
          userId: user.id,
        });

    return this.manifestResolver.resolve({
      robot,
      licenseStatus: status,
      locked,
      ...(reason ? { reason } : {}),
      appVersionCode,
      myCourses: content.myCourses,
      publicCatalog: content.publicCatalog,
    });
  }

  async createRobot(
    input: {
      orgId: number;
      serialNumber: string;
      name?: string;
      validFrom: Date;
      validUntil: Date;
      hardwareProfile?: {
        model?: string;
        manufacturer?: string;
        androidApiLevel?: number;
        abi?: string;
        display?: {
          width?: number;
          height?: number;
        };
        capabilities?: Record<string, unknown>;
      };
    },
    actor?: {
      userId: number | null;
      orgId: number | null;
      isSuperAdmin: boolean;
    },
    correlationId?: string,
  ) {
    const hardware = normalizeRobotHardwareProfile(input.hardwareProfile);
    const existingSerial = await this.prisma.robot.findUnique({
      where: { serialNumber: input.serialNumber },
      select: { id: true },
    });
    if (existingSerial)
      throw new ConflictException("Robot serial number already exists");

    const licenseKey = await this.generateUniqueLicenseKey();
    const status = this.computeLicenseStatus(input.validUntil, null);

    return this.prisma.$transaction(async (tx) => {
      const robot = await tx.robot
        .create({
          data: {
            orgId: input.orgId,
            serialNumber: input.serialNumber,
            name: input.name,
            licenseKey: null,
            licenseKeyCiphertext: encryptLicenseKey(licenseKey),
            licenseKeyFingerprint: licenseFingerprint(licenseKey),
            validFrom: input.validFrom,
            validUntil: input.validUntil,
            licenseStatus: status,
            hardwareModel: hardware.hardwareModel,
            hardwareProfile: hardware.hardwareProfile ?? Prisma.JsonNull,
            hardwareCapabilities:
              hardware.hardwareCapabilities ?? Prisma.JsonNull,
          },
          select: this.robotEnrollmentSelect,
        })
        .catch((error) => {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === "P2002" &&
            Array.isArray(error.meta?.target) &&
            error.meta.target.includes("serialNumber")
          ) {
            throw new ConflictException("Robot serial number already exists");
          }
          throw error;
        });

      if (actor) {
        await this.audit.recordCritical(
          {
            actor,
            action: "robot.enrolled",
            targetType: "robot",
            targetId: robot.id,
            targetOrgId: robot.orgId,
            correlationId,
            metadata: {
              serialNumber: robot.serialNumber,
              licenseStatus: robot.licenseStatus,
              validFrom: robot.validFrom,
              validUntil: robot.validUntil,
              hardwareModel: robot.hardwareModel,
            },
          },
          tx,
        );
      }

      return this.toSuperAdminRobotResponse(robot);
    });
  }

  async renewLicense(robotId: number, validUntil: Date) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
    });
    if (!robot) throw new NotFoundException("Robot not found");

    const status = this.computeLicenseStatus(validUntil, robot.revokedAt);

    // Renewal extends validity on the SAME license_key
    return this.prisma.robot.update({
      where: { id: robotId },
      data: { validUntil, licenseStatus: status },
      select: this.robotSelect,
    });
  }

  async rotateCredential(
    robotId: number,
    actor: {
      userId: number | null;
      orgId: number | null;
      isSuperAdmin: boolean;
    },
    correlationId?: string,
  ) {
    if (!actor.isSuperAdmin)
      throw new ForbiddenException(
        "Only Super Admin can rotate robot credentials",
      );

    const robot = await this.getRobotOrThrow(robotId);
    const licenseKey = await this.generateUniqueLicenseKey();

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          licenseKey: null,
          licenseKeyCiphertext: encryptLicenseKey(licenseKey),
          licenseKeyFingerprint: licenseFingerprint(licenseKey),
        },
        select: this.robotEnrollmentSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "robot.credential_rotated",
          targetType: "robot",
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
            licenseStatus: robot.licenseStatus,
          },
        },
        tx,
      );

      return this.toSuperAdminRobotResponse(updated);
    });
  }

  async revokeCredential(
    robotId: number,
    actor: {
      userId: number | null;
      orgId: number | null;
      isSuperAdmin: boolean;
    },
    correlationId?: string,
  ) {
    if (!actor.isSuperAdmin)
      throw new ForbiddenException(
        "Only Super Admin can revoke robot credentials",
      );

    const robot = await this.getRobotOrThrow(robotId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          revokedAt: new Date(),
          licenseStatus: LicenseStatus.REVOKED,
        },
        select: this.robotSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "robot.credential_revoked",
          targetType: "robot",
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
            previousLicenseStatus: robot.licenseStatus,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async lockRobot(robotId: number, lock: boolean) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
    });
    if (!robot) throw new NotFoundException("Robot not found");

    if (lock) {
      return this.prisma.robot.update({
        where: { id: robotId },
        data: { revokedAt: new Date(), licenseStatus: LicenseStatus.REVOKED },
        select: this.robotSelect,
      });
    }

    // unlock (revokedAt cleared; status recalculated)
    const status = this.computeLicenseStatus(robot.validUntil, null);

    return this.prisma.robot.update({
      where: { id: robotId },
      data: { revokedAt: null, licenseStatus: status },
      select: this.robotSelect,
    });
  }

  async reassignRobot(
    robotId: number,
    newOrgId: number,
    actor: {
      userId: number | null;
      orgId: number | null;
      isSuperAdmin: boolean;
    },
    correlationId?: string,
  ) {
    if (!actor.isSuperAdmin)
      throw new ForbiddenException("Only Super Admin can reassign robots");

    const robot = await this.getRobotOrThrow(robotId);
    if (robot.orgId === newOrgId) {
      return this.prisma.robot.findUnique({
        where: { id: robotId },
        select: {
          ...this.robotSelect,
          org: { select: { id: true, name: true, tenantVersion: true } },
        },
      });
    }

    const targetOrg = await this.prisma.organization.findUnique({
      where: { id: newOrgId },
      select: { id: true, isActive: true },
    });
    if (!targetOrg)
      throw new NotFoundException("Target organization not found");
    if (!targetOrg.isActive)
      throw new ForbiddenException("Target organization is inactive");

    return this.prisma.$transaction(async (tx) => {
      await tx.organization.update({
        where: { id: robot.orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { id: true },
      });

      const updatedOrg = await tx.organization.update({
        where: { id: newOrgId },
        data: { tenantVersion: { increment: 1 } },
        select: { id: true, tenantVersion: true },
      });

      const updated = await tx.robot.update({
        where: { id: robotId },
        data: { orgId: newOrgId },
        select: {
          ...this.robotSelect,
          org: { select: { id: true, name: true, tenantVersion: true } },
        },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "robot.reassigned",
          targetType: "robot",
          targetId: robotId,
          targetOrgId: newOrgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
            oldOrgId: robot.orgId,
            newOrgId,
            newTenantVersion: updatedOrg.tenantVersion,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async listReassignmentHistory(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
    limit = 50,
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    const take = Math.min(
      Math.max(Number.isFinite(limit) ? Math.trunc(limit) : 50, 1),
      100,
    );
    const events = await this.prisma.auditEvent.findMany({
      where: {
        action: "robot.reassigned",
        targetType: "robot",
        targetId: String(robotId),
      },
      orderBy: { createdAt: "desc" },
      take,
    });

    return events.map((event) => this.toRobotReassignmentHistoryItem(event));
  }

  async getEffectiveCapabilities(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    const entitlements = await this.entitlements.resolve({
      orgId: robot.orgId,
      robotId: robot.id,
      hardwareModel: robot.hardwareModel,
      hardwareProfile: robot.hardwareProfile,
      hardwareCapabilities: robot.hardwareCapabilities,
      enforceHardware: true,
    });

    return {
      robotId,
      orgId: robot.orgId,
      subscription: entitlements.subscription,
      capabilities: entitlements.paidCapabilities,
    };
  }

  async listCapabilityAssignments(
    robotId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    const assignments = await this.prisma.robotCapabilityAssignment.findMany({
      where: { robotId },
      include: { capability: true, robot: { select: { orgId: true } } },
      orderBy: { capability: { stableKey: "asc" } },
    });

    return assignments.map((assignment) =>
      this.toRobotCapabilityAssignmentResponse(assignment),
    );
  }

  async upsertCapabilityAssignment(
    robotId: number,
    dto: UpsertRobotCapabilityAssignmentDto,
    actor: {
      userId: number | null;
      orgId: number | null;
      isSuperAdmin: boolean;
    },
    correlationId?: string,
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    const stableKey = dto.capabilityStableKey.trim();
    const capability = await this.prisma.capability.findUnique({
      where: { stableKey },
    });
    if (!capability || !capability.isActive)
      throw new NotFoundException("Capability not found");

    const effectiveKeys = await this.getOrgEffectiveCapabilityKeys(
      robot.orgId,
      {
        hardwareModel: robot.hardwareModel,
        hardwareProfile: robot.hardwareProfile,
        hardwareCapabilities: robot.hardwareCapabilities,
      },
    );
    if (!effectiveKeys.has(capability.stableKey)) {
      throw new ForbiddenException(
        "Capability is not available to robot organization",
      );
    }

    const limits = this.sanitizeCapabilityLimits(dto.limits);
    const nextEnabled = dto.isEnabled ?? true;
    const previous = await this.prisma.robotCapabilityAssignment.findUnique({
      where: { robotId_capabilityId: { robotId, capabilityId: capability.id } },
      include: { capability: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.robotCapabilityAssignment.upsert({
        where: {
          robotId_capabilityId: { robotId, capabilityId: capability.id },
        },
        create: {
          robotId,
          capabilityId: capability.id,
          isEnabled: nextEnabled,
          limits: limits ?? Prisma.JsonNull,
          createdByUserId: actor.userId,
        },
        update: {
          isEnabled: nextEnabled,
          limits: limits ?? Prisma.JsonNull,
        },
        include: { capability: true, robot: { select: { orgId: true } } },
      });

      const org = await tx.organization.update({
        where: { id: robot.orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { id: true, tenantVersion: true },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "robot.capability_assignment.upserted",
          targetType: "robot",
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            capabilityId: capability.id,
            capabilityStableKey: capability.stableKey,
            previous: previous
              ? {
                  isEnabled: previous.isEnabled,
                  limits: previous.limits,
                }
              : null,
            next: {
              isEnabled: assignment.isEnabled,
              limits: assignment.limits,
              tenantVersion: org.tenantVersion,
            },
          },
        },
        tx,
      );

      return this.toRobotCapabilityAssignmentResponse(assignment);
    });
  }

  async clearDeviceMetadata(
    robotId: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const robot = await this.getRobotOrThrow(robotId);
    await this.ensureOrgAccess(actor, robot.orgId);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.robot.update({
        where: { id: robotId },
        data: {
          appVersion: null,
          deviceModel: null,
          deviceMetadata: Prisma.DbNull,
        },
        select: this.robotSelect,
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "robot.device_metadata_erased",
          targetType: "robot",
          targetId: robotId,
          targetOrgId: robot.orgId,
          correlationId,
          metadata: {
            serialNumber: robot.serialNumber,
          },
        },
        tx,
      );

      return updated;
    });
  }

  async getRobotOrThrow(robotId: number) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
    });
    if (!robot) throw new NotFoundException("Robot not found");
    return robot;
  }

  async ensureOrgAccess(
    actor: { orgId: number | null; isSuperAdmin: boolean },
    targetOrgId: number,
  ) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId) throw new ForbiddenException("Org scope required");
    if (actor.orgId !== targetOrgId)
      throw new ForbiddenException("Cannot access other org");
  }
}
