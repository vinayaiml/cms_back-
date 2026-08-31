import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CourseAccessType, CourseSource, CourseVisibility, LicenseStatus, LessonVisibility, Prisma } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';

type Allowed = {
  full: boolean;
  levelIds: Set<number>;
  chapterIds: Set<number>;
};

type AssignmentRow = { courseId: number; accessType: CourseAccessType; levelId: number | null; chapterId: number | null };

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

  private computeLicenseStatus(validUntil: Date, revokedAt: Date | null): LicenseStatus {
    if (revokedAt) return LicenseStatus.REVOKED;
    const now = new Date();
    if (now > validUntil) return LicenseStatus.EXPIRED;

    const daysLeft = (validUntil.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
    if (daysLeft <= 30) return LicenseStatus.EXPIRING_SOON;

    return LicenseStatus.ACTIVE;
  }

  private buildAllowedMap(assignments: Array<{ courseId: number; accessType: CourseAccessType; levelId: number | null; chapterId: number | null }>) {
    const map = new Map<number, Allowed>();

    for (const a of assignments) {
      const entry = map.get(a.courseId) || { full: false, levelIds: new Set<number>(), chapterIds: new Set<number>() };

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

  async sync(robotId: number) {
    const robot = await this.prisma.robot.findUnique({
      where: { id: robotId },
      include: { org: { select: { isActive: true } } },
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

    // Keep DB consistent
    if (robot.licenseStatus !== status) {
      await this.prisma.robot.update({ where: { id: robot.id }, data: { licenseStatus: status } });
    }

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
      select: { courseId: true, accessType: true, levelId: true, chapterId: true },
    });

    const allowedMap = this.buildAllowedMap(assignments);

    const assignedCourseIds: number[] = Array.from(new Set(assignments.map((a) => a.courseId)));

    const assignedPlatformCourses: CourseWithLevels[] = assignedCourseIds.length
      ? await this.prisma.course.findMany({
          where: { id: { in: assignedCourseIds }, source: CourseSource.PLATFORM },
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

    // 3) Public catalog = PUBLIC courses, only intro level, only PUBLIC_PREVIEW lessons
    const publicCourses: PublicCourse[] = await this.prisma.course.findMany({
      where: { visibility: CourseVisibility.PUBLIC, introLevelId: { not: null } },
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
              where: { chapterId: null, visibility: LessonVisibility.PUBLIC_PREVIEW },
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
}
