import { ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LicenseStatus } from '@prisma/client';

type CourseMini = { id: number; courseName: string; courseCode: string };
type LessonMini = { id: number; name: string };

export type AnalyticsScope =
  | { type: 'ORG'; orgId: number }
  | { type: 'GLOBAL' };

function startFromDays(days: number): Date {
  const now = new Date();
  const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
  return from;
}

@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}

  private async robotCounts(scope: AnalyticsScope) {
    const whereOrg = scope.type === 'ORG' ? { orgId: scope.orgId } : {};

    const total = await this.prisma.robot.count({ where: whereOrg });

    const active = await this.prisma.robot.count({
      where: {
        ...whereOrg,
        licenseStatus: { in: [LicenseStatus.ACTIVE, LicenseStatus.EXPIRING_SOON] },
      },
    });

    const expiringSoon = await this.prisma.robot.count({
      where: {
        ...whereOrg,
        licenseStatus: LicenseStatus.EXPIRING_SOON,
      },
    });

    const locked = await this.prisma.robot.count({
      where: {
        ...whereOrg,
        licenseStatus: { in: [LicenseStatus.EXPIRED, LicenseStatus.REVOKED] },
      },
    });

    return { total, active, expiringSoon, locked };
  }

  private async usageCounts(scope: AnalyticsScope, days: number) {
    const from = startFromDays(days);

    const whereBase: any = {
      openedAt: { gte: from },
    };

    if (scope.type === 'ORG') {
      whereBase.orgId = scope.orgId;
    }

    const plays = await this.prisma.robotUsageLog.count({ where: whereBase });
    const sum = await this.prisma.robotUsageLog.aggregate({
      where: whereBase,
      _sum: { durationSec: true },
    });

    const durationSec = sum._sum.durationSec ?? 0;

    const uniqueRobots = (await this.prisma.robotUsageLog.findMany({
      where: whereBase,
      distinct: ['robotId'],
      select: { robotId: true },
    })).length;

    const uniqueLessons = (await this.prisma.robotUsageLog.findMany({
      where: { ...whereBase, lessonId: { not: null } },
      distinct: ['lessonId'],
      select: { lessonId: true },
    })).length;

    return { plays, durationSec, uniqueRobots, uniqueLessons, from };
  }

  async getOverview(params: { scope: AnalyticsScope; days: number; topLimit?: number }) {
    const days = Math.max(1, Math.min(365, params.days || 7));

    const robots = await this.robotCounts(params.scope);
    const usage = await this.usageCounts(params.scope, days);

    const topLimit = params.topLimit ?? 5;

    const topCourses = await this.getTopCourses({ scope: params.scope, days, limit: topLimit });
    const topLessons = await this.getTopLessons({ scope: params.scope, days, limit: topLimit });

    const to = new Date();

    return {
      scope: params.scope.type,
      orgId: params.scope.type === 'ORG' ? params.scope.orgId : null,
      days,
      from: usage.from.toISOString(),
      to: to.toISOString(),
      robots,
      usage: {
        plays: usage.plays,
        durationSec: usage.durationSec,
        uniqueRobots: usage.uniqueRobots,
        uniqueLessons: usage.uniqueLessons,
      },
      topCourses,
      topLessons,
    };
  }

  async getTopCourses(params: { scope: AnalyticsScope; days: number; limit: number }) {
    const from = startFromDays(params.days);

    const where: any = {
      openedAt: { gte: from },
      courseId: { not: null },
    };

    if (params.scope.type === 'ORG') {
      where.orgId = params.scope.orgId;
    }

    const grouped = await this.prisma.robotUsageLog.groupBy({
      by: ['courseId'],
      where,
      _count: { _all: true },
      _sum: { durationSec: true },
      orderBy: { _count: { id: 'desc' } },
      take: params.limit,
    });

    const ids = grouped.map((g) => g.courseId).filter((id): id is number => typeof id === 'number');

    const courses: CourseMini[] = ids.length
      ? await this.prisma.course.findMany({
          where: { id: { in: ids } },
          select: { id: true, courseName: true, courseCode: true },
        })
      : [];

    const byId = new Map<number, CourseMini>(courses.map((c) => [c.id, c]));

    return grouped
      .map((g) => {
        const c = g.courseId ? byId.get(g.courseId) : null;
        return {
          courseId: g.courseId,
          courseName: c?.courseName || 'Unknown',
          courseCode: c?.courseCode || null,
          plays: g._count._all,
          durationSec: g._sum?.durationSec ?? 0,
        };
      })
      .filter((x) => x.courseId !== null);
  }

  async getTopLessons(params: { scope: AnalyticsScope; days: number; limit: number }) {
    const from = startFromDays(params.days);

    const where: any = {
      openedAt: { gte: from },
      lessonId: { not: null },
    };

    if (params.scope.type === 'ORG') {
      where.orgId = params.scope.orgId;
    }

    const grouped = await this.prisma.robotUsageLog.groupBy({
      by: ['lessonId'],
      where,
      _count: { _all: true },
      _sum: { durationSec: true },
      orderBy: { _count: { id: 'desc' } },
      take: params.limit,
    });

    const ids = grouped.map((g) => g.lessonId).filter((id): id is number => typeof id === 'number');

    const lessons: LessonMini[] = ids.length
      ? await this.prisma.lesson.findMany({
          where: { id: { in: ids } },
          select: { id: true, name: true },
        })
      : [];

    const byId = new Map<number, LessonMini>(lessons.map((l) => [l.id, l]));

    return grouped
      .map((g) => {
        const l = g.lessonId ? byId.get(g.lessonId) : null;
        return {
          lessonId: g.lessonId,
          lessonName: l?.name || 'Unknown',
          plays: g._count._all,
          durationSec: g._sum?.durationSec ?? 0,
        };
      })
      .filter((x) => x.lessonId !== null);
  }

  // Helpers for controller
  static resolveScope(actor: { isSuperAdmin: boolean; orgId: number | null }, orgIdParam?: number | null): AnalyticsScope {
    if (actor.isSuperAdmin) {
      if (orgIdParam) return { type: 'ORG', orgId: orgIdParam };
      return { type: 'GLOBAL' };
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    return { type: 'ORG', orgId: actor.orgId };
  }
}
