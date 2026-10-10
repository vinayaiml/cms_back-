import { BadRequestException, Injectable, Optional } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import {
  CourseAccessType,
  CourseSource,
  CourseVisibility,
  LicenseStatus,
  LessonVisibility,
  Prisma,
} from "@prisma/client";
import { DomainLockedException } from "../../common/errors/domain-locked.exception";
import { normalizeRobotHardwareProfile } from "../robots/robot-hardware-profile";
import { RobotManifestResolver } from "./robot-manifest.resolver";
import { ContentDeliveryService } from "../content-delivery/content-delivery.service";

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

export type RobotSyncHeartbeat = {
  appVersion?: string;
  deviceModel?: string;
  appVersionCode?: number;
};

export type RobotSyncChangesInput = {
  manifestHash?: string;
  cacheVersion?: string;
  tenantVersion?: number;
  myCoursesVersion?: string;
  publicCatalogVersion?: string;
};

export type RobotDeviceProfileUpdate = {
  manufacturer: string;
  deviceModel: string;
  androidVersion: string;
  apiLevel: number;
  appVersionName: string;
  appVersionCode: number;
  hardwareProfile: {
    model: string;
    manufacturer?: string;
    androidApiLevel: number;
    abi: string;
    display: {
      width: number;
      height: number;
    };
    capabilities?: Record<string, unknown>;
  };
};

type OrgContext = {
  id: number;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tenantVersion: number;
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
export class RobotSyncService {
  constructor(
    private prisma: PrismaService,
    private manifestResolver: RobotManifestResolver,
    @Optional()
    private contentDelivery?: ContentDeliveryService,
  ) {}

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

  private toApprovedDeviceMetadata(
    input: RobotDeviceProfileUpdate,
  ): Prisma.InputJsonObject {
    return {
      schemaVersion: 2,
      storage: "approved-device-profile",
      manufacturer: input.manufacturer.trim(),
      model: input.deviceModel.trim(),
      androidVersion: input.androidVersion.trim(),
      apiLevel: input.apiLevel,
      appVersionName: input.appVersionName.trim(),
      appVersionCode: input.appVersionCode,
    };
  }

  private getStoredAppVersionCode(
    deviceMetadata: Prisma.JsonValue | null,
  ): number | null {
    if (
      !deviceMetadata ||
      typeof deviceMetadata !== "object" ||
      Array.isArray(deviceMetadata)
    ) {
      return null;
    }

    const value = (deviceMetadata as Record<string, unknown>).appVersionCode;
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  }

  private async findRobotForProtectedAccess(robotId: number) {
    return this.prisma.robot.findUnique({
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
  }

  private async assertRobotProfileUpdateAllowed(
    robot: Awaited<ReturnType<RobotSyncService["findRobotForProtectedAccess"]>>,
  ) {
    if (!robot) {
      throw new DomainLockedException("ROBOT_NOT_FOUND", "Robot not found");
    }

    if (!robot.org.isActive) {
      await this.prisma.event.create({
        data: {
          orgId: robot.orgId,
          robotId: robot.id,
          type: "ROBOT_ACCESS_REJECTED_ORG_INACTIVE",
          payload: {
            reason: "ORG_INACTIVE",
            endpoint: "robot.device-profile",
          },
        },
      });
      throw new DomainLockedException(
        "ORG_INACTIVE",
        "Organization is inactive",
      );
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    if (robot.licenseStatus !== status) {
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: { licenseStatus: status },
      });
    }

    if (status === LicenseStatus.EXPIRED) {
      throw new DomainLockedException(
        "LICENSE_EXPIRED",
        "Robot license is expired",
      );
    }
    if (status === LicenseStatus.REVOKED) {
      throw new DomainLockedException(
        "LICENSE_REVOKED",
        "Robot license is revoked",
      );
    }

    return { robot, status };
  }

  private buildAllowedMap(
    assignments: Array<{
      courseId: number;
      accessType: CourseAccessType;
      levelId: number | null;
      chapterId: number | null;
    }>,
  ) {
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
      // Level-only access grants entire level
      if (allowed.levelIds.has(level.id)) {
        filteredLevels.push(level);
        continue;
      }

      // Chapter-only access grants only selected chapters inside a level
      const keptChapters = (level.chapters || []).filter((ch: any) =>
        allowed.chapterIds.has(ch.id),
      );
      if (keptChapters.length > 0) {
        filteredLevels.push({
          ...level,
          chapters: keptChapters,
          // lessons without chapter are NOT included unless the level itself is granted
          lessons: [],
        });
      }
    }

    if (!filteredLevels.length) return null;
    return { ...course, levels: filteredLevels };
  }

  async sync(robotId: number, heartbeat: RobotSyncHeartbeat = {}) {
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
    if (!robot) {
      return { locked: true, reason: "ROBOT_NOT_FOUND" };
    }

    if (!robot.org.isActive) {
      await this.prisma.event.create({
        data: {
          orgId: robot.orgId,
          robotId: robot.id,
          type: "ROBOT_ACCESS_REJECTED_ORG_INACTIVE",
          payload: {
            reason: "ORG_INACTIVE",
            endpoint: "robot.sync",
          },
        },
      });
      throw new DomainLockedException(
        "ORG_INACTIVE",
        "Organization is inactive",
      );
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    const locked =
      status === LicenseStatus.EXPIRED || status === LicenseStatus.REVOKED;

    await this.prisma.robot.update({
      where: { id: robot.id },
      data: {
        lastSeenAt: new Date(),
        ...(heartbeat.appVersion ? { appVersion: heartbeat.appVersion } : {}),
        ...(heartbeat.deviceModel
          ? { deviceModel: heartbeat.deviceModel }
          : {}),
        ...(robot.licenseStatus !== status ? { licenseStatus: status } : {}),
      },
    });

    const appVersionCode =
      heartbeat.appVersionCode ?? this.getStoredAppVersionCode(robot.deviceMetadata);

    if (locked) {
      return this.manifestResolver.resolve({
        robot,
        licenseStatus: status,
        locked: true,
        reason: status,
        appVersionCode,
        approvedContext: {
          context: null,
          approvedQa: [],
        },
      });
    }

    // 1) Org-owned courses (always full access)
    const orgOwnedCourses: CourseWithLevels[] =
      await this.prisma.course.findMany({
        where: { ownerOrgId: robot.orgId, isPublished: true } as any,
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

    // 2) Assigned platform courses with access control (full/level/chapter)
    const assignments: AssignmentRow[] =
      await this.prisma.orgCourseAccess.findMany({
        where: { orgId: robot.orgId },
        select: {
          courseId: true,
          accessType: true,
          levelId: true,
          chapterId: true,
        },
      });

    const allowedMap = this.buildAllowedMap(assignments);
    const robotCourseAssignments: ScopedAssignmentRow[] =
      await (this.prisma as any).robotCourseAccess.findMany({
        where: { isEnabled: true, robot: { orgId: robot.orgId } },
        select: {
          robotId: true,
          courseId: true,
          accessType: true,
          levelId: true,
          chapterId: true,
        },
      });
    const robotRestrictedCourseIds = new Set(
      robotCourseAssignments.map((assignment) => assignment.courseId),
    );
    const robotAllowedMap = this.buildAllowedMap(
      robotCourseAssignments.filter((assignment) => assignment.robotId === robot.id),
    );

    const assignedCourseIds: number[] = Array.from(
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
      .map((c: CourseWithLevels) => {
        const allow = allowedMap.get(c.id);
        if (!allow) return null;
        const orgFiltered = this.filterCourseByAllowed(c, allow);
        if (!orgFiltered) return null;
        if (!robotRestrictedCourseIds.has(c.id)) return orgFiltered;
        const robotAllow = robotAllowedMap.get(c.id);
        if (!robotAllow) return null;
        return this.filterCourseByAllowed(orgFiltered, robotAllow);
      })
      .filter((c): c is CourseWithLevels => Boolean(c));

    const robotScopedOrgCourses = robotRestrictedCourseIds.size
      ? orgOwnedCourses
          .map((c: CourseWithLevels) => {
            if (!robotRestrictedCourseIds.has(c.id)) return c;
            const robotAllow = robotAllowedMap.get(c.id);
            if (!robotAllow) return null;
            return this.filterCourseByAllowed(c, robotAllow);
          })
          .filter((c): c is CourseWithLevels => Boolean(c))
      : orgOwnedCourses;

    const myCourses: CourseWithLevels[] = [
      ...robotScopedOrgCourses,
      ...filteredAssigned,
    ];
    // 3) Public catalog = PUBLIC courses, only intro level, only PUBLIC_PREVIEW lessons
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

    const publicCatalog = publicCourses.map((c: PublicCourse) => ({
      id: c.id,
      courseCode: c.courseCode,
      courseName: c.courseName,
      description: c.description,
      courseImageUrl: c.courseImageUrl,
      logoUrl: c.logoUrl,
      introLevel: c.introLevel,
    }));
    const rawContext = await (this.prisma as any).organizationConversationContext?.findUnique?.({
      where: { orgId: robot.orgId },
    });
    const rawApprovedQa = (await (this.prisma as any).organizationApprovedQa?.findMany?.({
      where: { orgId: robot.orgId, isPublished: true },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    })) ?? [];

    const approvedContext = {
      context:
        rawContext && rawContext.isPublished
          ? {
              companyOverview: rawContext.companyOverview,
              operatingHours: rawContext.operatingHours,
              locationDetails: rawContext.locationDetails,
              visitorGuidelines: rawContext.visitorGuidelines,
              eventsSummary: rawContext.eventsSummary,
              version: rawContext.version,
            }
          : null,
      approvedQa: rawApprovedQa.map((item: any) => ({
        id: item.id,
        question: item.question,
        answer: item.answer,
        category: item.category,
        version: item.version,
        sortOrder: item.sortOrder,
      })),
    };

    const rawOrgPersona = await (this.prisma as any).organizationPersonaConfig?.findUnique?.({
      where: { orgId: robot.orgId },
    });
    const rawRobotPersona = await (this.prisma as any).robotPersonaConfig?.findUnique?.({
      where: { robotId: robot.id },
    });

    const isPersonaOverridden = Boolean(rawRobotPersona && rawRobotPersona.isPublished);
    const defaultLanguage =
      (isPersonaOverridden && rawRobotPersona?.language) ||
      rawOrgPersona?.language ||
      "en-US";
    const rawSupported =
      (isPersonaOverridden && rawRobotPersona?.supportedLanguages) ||
      rawOrgPersona?.supportedLanguages ||
      "en-US";
    const supportedLanguages =
      typeof rawSupported === "string"
        ? rawSupported.split(",").map((s: string) => s.trim()).filter(Boolean)
        : ["en-US"];
    if (!supportedLanguages.includes(defaultLanguage)) {
      supportedLanguages.unshift(defaultLanguage);
    }
    const speechSpeed =
      isPersonaOverridden && rawRobotPersona?.speechSpeed != null
        ? rawRobotPersona.speechSpeed
        : (rawOrgPersona?.speechSpeed ?? 1.0);
    const sessionMaxSeconds =
      isPersonaOverridden && rawRobotPersona?.sessionMaxSeconds != null
        ? rawRobotPersona.sessionMaxSeconds
        : (rawOrgPersona?.sessionMaxSeconds ?? 300);
    const sessionIdleTimeoutSeconds =
      isPersonaOverridden && rawRobotPersona?.sessionIdleTimeoutSeconds != null
        ? rawRobotPersona.sessionIdleTimeoutSeconds
        : (rawOrgPersona?.sessionIdleTimeoutSeconds ?? 60);
    const cooldownSeconds =
      isPersonaOverridden && rawRobotPersona?.cooldownSeconds != null
        ? rawRobotPersona.cooldownSeconds
        : (rawOrgPersona?.cooldownSeconds ?? 5);
    const dailySessionLimit =
      isPersonaOverridden && rawRobotPersona?.dailySessionLimit != null
        ? rawRobotPersona.dailySessionLimit
        : (rawOrgPersona?.dailySessionLimit ?? 1000);
    const policyVersion =
      (rawOrgPersona?.version || 1) + (isPersonaOverridden ? (rawRobotPersona?.version || 0) : 0);

    const policy = {
      defaultLanguage,
      supportedLanguages,
      speechSpeed,
      sessionMaxSeconds,
      sessionIdleTimeoutSeconds,
      cooldownSeconds,
      dailySessionLimit,
      version: policyVersion,
    };

    const manifest = await this.manifestResolver.resolve({
      robot,
      licenseStatus: status,
      locked: false,
      appVersionCode,
      myCourses,
      publicCatalog,
      approvedContext,
      policy,
    });
    return this.decorateManifestContent(manifest, robot.id, robot.orgId);
  }

  private decorateManifestContent(manifest: any, robotId: number, orgId: number) {
    if (!this.contentDelivery || manifest?.locked) return manifest;

    return {
      ...manifest,
      myCourses: this.contentDelivery.decorateManifestContent(
        manifest.myCourses ?? [],
        { robotId, orgId },
      ),
      publicCatalog: this.contentDelivery.decorateManifestContent(
        manifest.publicCatalog ?? [],
        { robotId, orgId },
      ),
    };
  }

  async syncChanges(
    robotId: number,
    client: RobotSyncChangesInput,
    heartbeat: RobotSyncHeartbeat = {},
  ) {
    const manifest = (await this.sync(robotId, heartbeat)) as any;
    const syncedAt = manifest?.sync?.syncedAt ?? new Date().toISOString();
    const baseResponse = {
      schemaVersion: 1,
      manifestVersion: manifest?.manifestVersion ?? "1.0.0",
      locked: Boolean(manifest?.locked),
      ...(manifest?.reason ? { reason: manifest.reason } : {}),
      currentManifestHash: manifest?.sync?.manifestHash ?? null,
      currentConfigVersion: manifest?.sync?.configVersion ?? null,
      contentVersions: manifest?.contentVersions ?? null,
      sync: {
        serverTime: syncedAt,
        syncedAt,
        idempotencyKey: manifest?.sync?.idempotencyKey ?? `robot-${robotId}-changes`,
        configVersion: manifest?.sync?.configVersion ?? null,
        manifestHash: manifest?.sync?.manifestHash ?? null,
      },
    };

    const hasIncrementalBaseline = Boolean(
      client.manifestHash &&
        client.cacheVersion &&
        client.tenantVersion !== undefined &&
        client.myCoursesVersion &&
        client.publicCatalogVersion,
    );

    if (!hasIncrementalBaseline || !manifest?.contentVersions || !manifest?.sync) {
      return {
        ...baseResponse,
        requiresFullSync: true,
        fullSyncReason: "MISSING_OR_UNSUPPORTED_CLIENT_VERSIONS",
        changed: {},
      };
    }

    const changed: Record<string, unknown> = {};
    const cacheChanged =
      client.cacheVersion !== manifest.contentVersions.cacheVersion ||
      client.tenantVersion !== manifest.contentVersions.tenantVersion;

    if (cacheChanged) {
      changed.tenant = manifest.tenant;
      changed.capabilities = manifest.capabilities;
      changed.policies = manifest.policies;
      changed.conversation = manifest.conversation;
    }

    if (client.myCoursesVersion !== manifest.contentVersions.myCoursesVersion) {
      changed.myCourses = manifest.myCourses ?? [];
    }

    if (
      client.publicCatalogVersion !==
      manifest.contentVersions.publicCatalogVersion
    ) {
      changed.publicCatalog = manifest.publicCatalog ?? [];
    }

    if (client.manifestHash !== manifest.sync.manifestHash) {
      changed.license = manifest.license;
      if (!changed.policies) {
        changed.policies = manifest.policies;
      }
    }

    return {
      ...baseResponse,
      requiresFullSync: false,
      changed,
    };
  }

  async updateDeviceProfile(robotId: number, input: RobotDeviceProfileUpdate) {
    const hardware = normalizeRobotHardwareProfile({
      ...input.hardwareProfile,
      manufacturer: input.hardwareProfile.manufacturer ?? input.manufacturer,
    });
    const { robot, status } = await this.assertRobotProfileUpdateAllowed(
      await this.findRobotForProtectedAccess(robotId),
    );
    const storedAppVersionCode = this.getStoredAppVersionCode(
      robot.deviceMetadata,
    );
    if (
      storedAppVersionCode !== null &&
      input.appVersionCode < storedAppVersionCode
    ) {
      throw new BadRequestException("Stale robot device profile update");
    }

    const updated = await this.prisma.robot.update({
      where: { id: robot.id },
      data: {
        lastSeenAt: new Date(),
        appVersion: input.appVersionName.trim(),
        deviceModel: input.deviceModel.trim(),
        deviceMetadata: this.toApprovedDeviceMetadata(input),
        hardwareModel: hardware.hardwareModel,
        hardwareProfile: hardware.hardwareProfile ?? Prisma.JsonNull,
        hardwareCapabilities: hardware.hardwareCapabilities ?? Prisma.JsonNull,
      },
      select: {
        id: true,
        orgId: true,
        serialNumber: true,
        name: true,
        licenseStatus: true,
        validFrom: true,
        validUntil: true,
        revokedAt: true,
        lastSeenAt: true,
        appVersion: true,
        deviceModel: true,
        deviceMetadata: true,
        hardwareModel: true,
        hardwareProfile: true,
        hardwareCapabilities: true,
        updatedAt: true,
      },
    });

    return {
      robot: updated,
      license: {
        status,
        validFrom: robot.validFrom,
        validUntil: robot.validUntil,
      },
      updatedAt: updated.updatedAt,
    };
  }
}
