import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseAccessType, CourseSource, CourseVisibility, LicenseStatus, LessonVisibility, Prisma, SubscriptionStatus } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { normalizeRobotHardwareProfile } from '../robots/robot-hardware-profile';

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

export type RobotSyncHeartbeat = {
  appVersion?: string;
  deviceModel?: string;
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
  constructor(private prisma: PrismaService) {}

  private toOrganizationContext(org: OrgContext) {
    return {
      orgId: org.id,
      orgName: org.name,
      displayName: org.name,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      tenantVersion: org.tenantVersion,
      cacheVersion: `org-${org.id}-v${org.tenantVersion}`,
    };
  }

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private toApprovedDeviceMetadata(input: RobotDeviceProfileUpdate): Prisma.InputJsonObject {
    return {
      schemaVersion: 2,
      storage: 'approved-device-profile',
      manufacturer: input.manufacturer.trim(),
      model: input.deviceModel.trim(),
      androidVersion: input.androidVersion.trim(),
      apiLevel: input.apiLevel,
      appVersionName: input.appVersionName.trim(),
      appVersionCode: input.appVersionCode,
    };
  }

  private getStoredAppVersionCode(deviceMetadata: Prisma.JsonValue | null): number | null {
    if (!deviceMetadata || typeof deviceMetadata !== 'object' || Array.isArray(deviceMetadata)) {
      return null;
    }

    const value = (deviceMetadata as Record<string, unknown>).appVersionCode;
    return typeof value === 'number' && Number.isInteger(value) ? value : null;
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

  private async assertRobotProfileUpdateAllowed(robot: Awaited<ReturnType<RobotSyncService['findRobotForProtectedAccess']>>) {
    if (!robot) {
      throw new DomainLockedException('ROBOT_NOT_FOUND', 'Robot not found');
    }

    if (!robot.org.isActive) {
      await this.prisma.event.create({
        data: {
          orgId: robot.orgId,
          robotId: robot.id,
          type: 'ROBOT_ACCESS_REJECTED_ORG_INACTIVE',
          payload: {
            reason: 'ORG_INACTIVE',
            endpoint: 'robot.device-profile',
          },
        },
      });
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    if (robot.licenseStatus !== status) {
      await this.prisma.robot.update({
        where: { id: robot.id },
        data: { licenseStatus: status },
      });
    }

    if (status === LicenseStatus.EXPIRED) {
      throw new DomainLockedException('LICENSE_EXPIRED', 'Robot license is expired');
    }
    if (status === LicenseStatus.REVOKED) {
      throw new DomainLockedException('LICENSE_REVOKED', 'Robot license is revoked');
    }

    return { robot, status };
  }

  private async getEffectiveEntitlements(orgId: number) {
    const subscription = await this.prisma.organizationSubscription.findFirst({
      where: { orgId },
      orderBy: { updatedAt: 'desc' },
      include: {
        plan: {
          include: {
            capabilities: {
              include: { capability: true },
              orderBy: { capability: { stableKey: 'asc' as const } },
            },
          },
        },
      },
    });

    if (!subscription) {
      return {
        subscription: {
          status: 'NONE',
          planStableKey: null,
          validFrom: null,
          validUntil: null,
        },
        paidCapabilities: [],
      };
    }

    const now = new Date();
    const isCurrent = subscription.status === SubscriptionStatus.ACTIVE && subscription.plan.isActive && subscription.validFrom <= now && subscription.validUntil >= now;
    const status =
      !subscription.plan.isActive || subscription.status !== SubscriptionStatus.ACTIVE
        ? 'INACTIVE'
        : subscription.validUntil < now
          ? 'EXPIRED'
          : subscription.validFrom > now
            ? 'NOT_YET_ACTIVE'
            : 'ACTIVE';

    return {
      subscription: {
        status,
        planId: subscription.planId,
        planStableKey: subscription.plan.stableKey,
        planVersion: subscription.plan.version,
        validFrom: subscription.validFrom,
        validUntil: subscription.validUntil,
      },
      paidCapabilities: isCurrent
        ? subscription.plan.capabilities
            .map((row) => row.capability)
            .filter((capability) => capability.isActive)
            .map((capability) => ({
              id: capability.id,
              stableKey: capability.stableKey,
              name: capability.name,
              description: capability.description,
              category: capability.category,
              version: capability.version,
              requiredHardware: capability.requiredHardware,
            }))
        : [],
    };
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
      } else if (a.accessType === CourseAccessType.CHAPTER_ONLY && a.chapterId) {
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
      const keptChapters = (level.chapters || []).filter((ch: any) => allowed.chapterIds.has(ch.id));
      if (keptChapters.length > 0) {
        filteredLevels.push({
          ...level,
          chapters: keptChapters,
          // lessons without chapter are NOT included unless the level itself is granted
          lessons: [],
        });
      }
    }

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
      return { locked: true, reason: 'ROBOT_NOT_FOUND' };
    }

    if (!robot.org.isActive) {
      await this.prisma.event.create({
        data: {
          orgId: robot.orgId,
          robotId: robot.id,
          type: 'ROBOT_ACCESS_REJECTED_ORG_INACTIVE',
          payload: {
            reason: 'ORG_INACTIVE',
            endpoint: 'robot.sync',
          },
        },
      });
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    const status = this.computeLicenseStatus(robot.validUntil, robot.revokedAt);
    const locked = status === LicenseStatus.EXPIRED || status === LicenseStatus.REVOKED;

    await this.prisma.robot.update({
      where: { id: robot.id },
      data: {
        lastSeenAt: new Date(),
        ...(heartbeat.appVersion ? { appVersion: heartbeat.appVersion } : {}),
        ...(heartbeat.deviceModel ? { deviceModel: heartbeat.deviceModel } : {}),
        ...(robot.licenseStatus !== status ? { licenseStatus: status } : {}),
      },
    });

    if (locked) {
      return {
        locked: true,
        reason: status,
        license: {
          status,
          validFrom: robot.validFrom,
          validUntil: robot.validUntil,
        },
      };
    }

    // 1) Org-owned courses (always full access)
    const orgOwnedCourses: CourseWithLevels[] = await this.prisma.course.findMany({
      where: { ownerOrgId: robot.orgId },
      orderBy: { id: 'asc' },
      include: {
        levels: {
          orderBy: { sequence: 'asc' },
          include: {
            chapters: {
              orderBy: { sequence: 'asc' },
              include: { lessons: { orderBy: { sequence: 'asc' } } },
            },
            lessons: {
              where: { chapterId: null },
              orderBy: { sequence: 'asc' },
            },
          },
        },
      },
    });

    // 2) Assigned platform courses with access control (full/level/chapter)
    const assignments: AssignmentRow[] = await this.prisma.orgCourseAccess.findMany({
      where: { orgId: robot.orgId },
      select: {
        courseId: true,
        accessType: true,
        levelId: true,
        chapterId: true,
      },
    });

    const allowedMap = this.buildAllowedMap(assignments);

    const assignedCourseIds: number[] = Array.from(new Set(assignments.map((a) => a.courseId)));

    const assignedPlatformCourses: CourseWithLevels[] = assignedCourseIds.length
      ? await this.prisma.course.findMany({
          where: {
            id: { in: assignedCourseIds },
            source: CourseSource.PLATFORM,
          },
          orderBy: { id: 'asc' },
          include: {
            levels: {
              orderBy: { sequence: 'asc' },
              include: {
                chapters: {
                  orderBy: { sequence: 'asc' },
                  include: { lessons: { orderBy: { sequence: 'asc' } } },
                },
                lessons: {
                  where: { chapterId: null },
                  orderBy: { sequence: 'asc' },
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
        return this.filterCourseByAllowed(c, allow);
      })
      .filter((c): c is CourseWithLevels => Boolean(c));

    const myCourses: CourseWithLevels[] = [...orgOwnedCourses, ...filteredAssigned];
    const entitlements = await this.getEffectiveEntitlements(robot.orgId);

    // 3) Public catalog = PUBLIC courses, only intro level, only PUBLIC_PREVIEW lessons
    const publicCourses: PublicCourse[] = await this.prisma.course.findMany({
      where: {
        visibility: CourseVisibility.PUBLIC,
        introLevelId: { not: null },
      },
      orderBy: { id: 'asc' },
      include: {
        introLevel: {
          include: {
            chapters: {
              orderBy: { sequence: 'asc' },
              include: {
                lessons: {
                  where: { visibility: LessonVisibility.PUBLIC_PREVIEW },
                  orderBy: { sequence: 'asc' },
                },
              },
            },
            lessons: {
              where: {
                chapterId: null,
                visibility: LessonVisibility.PUBLIC_PREVIEW,
              },
              orderBy: { sequence: 'asc' },
            },
          },
        },
      },
    });

    return {
      locked: false,
      license: {
        status,
        validFrom: robot.validFrom,
        validUntil: robot.validUntil,
      },
      organization: this.toOrganizationContext(robot.org),
      entitlements,
      myCourses,
      publicCatalog: publicCourses.map((c: PublicCourse) => ({
        id: c.id,
        courseCode: c.courseCode,
        courseName: c.courseName,
        description: c.description,
        courseImageUrl: c.courseImageUrl,
        logoUrl: c.logoUrl,
        introLevel: c.introLevel,
      })),
      syncedAt: new Date().toISOString(),
    };
  }

  async updateDeviceProfile(robotId: number, input: RobotDeviceProfileUpdate) {
    const hardware = normalizeRobotHardwareProfile({
      ...input.hardwareProfile,
      manufacturer: input.hardwareProfile.manufacturer ?? input.manufacturer,
    });
    const { robot, status } = await this.assertRobotProfileUpdateAllowed(await this.findRobotForProtectedAccess(robotId));
    const storedAppVersionCode = this.getStoredAppVersionCode(robot.deviceMetadata);
    if (storedAppVersionCode !== null && input.appVersionCode < storedAppVersionCode) {
      throw new BadRequestException('Stale robot device profile update');
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
