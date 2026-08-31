import { Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { AnalyticsService } from './analytics.service';

function toInt(v: any): number | null {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

@Controller('analytics')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AnalyticsController {
  constructor(private analytics: AnalyticsService) {}

  @Get('overview')
  @RequirePermissions('analytics.read')
  async overview(
    @CurrentUser() actor: JwtPayload,
    @Query('days') daysQ?: string,
    @Query('orgId') orgIdQ?: string,
    @Query('limit') limitQ?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    const days = toInt(daysQ) ?? 7;
    const orgIdParam = toInt(orgIdQ);
    const limit = toInt(limitQ) ?? 5;

    const scope = AnalyticsService.resolveScope({ isSuperAdmin: actor.isSuperAdmin, orgId: actor.orgId }, orgIdParam);

    return this.analytics.getOverview({ scope, days, topLimit: limit });
  }

  @Get('top-courses')
  @RequirePermissions('analytics.read')
  async topCourses(@CurrentUser() actor: JwtPayload, @Query('days') daysQ?: string, @Query('orgId') orgIdQ?: string, @Query('limit') limitQ?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    const days = toInt(daysQ) ?? 7;
    const limit = toInt(limitQ) ?? 5;
    const orgIdParam = toInt(orgIdQ);

    const scope = AnalyticsService.resolveScope({ isSuperAdmin: actor.isSuperAdmin, orgId: actor.orgId }, orgIdParam);

    return this.analytics.getTopCourses({ scope, days, limit });
  }

  @Get('top-lessons')
  @RequirePermissions('analytics.read')
  async topLessons(@CurrentUser() actor: JwtPayload, @Query('days') daysQ?: string, @Query('orgId') orgIdQ?: string, @Query('limit') limitQ?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    const days = toInt(daysQ) ?? 7;
    const limit = toInt(limitQ) ?? 5;
    const orgIdParam = toInt(orgIdQ);

    const scope = AnalyticsService.resolveScope({ isSuperAdmin: actor.isSuperAdmin, orgId: actor.orgId }, orgIdParam);

    return this.analytics.getTopLessons({ scope, days, limit });
  }
}
