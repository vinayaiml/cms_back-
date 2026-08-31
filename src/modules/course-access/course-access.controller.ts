import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { CourseAccessService } from './course-access.service';
import { CreateCourseAccessDto } from './course-access.dto';

@Controller('orgs/:orgId/course-access')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CourseAccessController {
  constructor(private access: CourseAccessService) {}

  @Get()
  @RequirePermissions('content.read')
  async list(@CurrentUser() actor: JwtPayload, @Param('orgId', ParseIntPipe) orgId: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    // Non-super admin can only read their own org
    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException('Org scope required');
      if (actor.orgId !== orgId) throw new ForbiddenException('Cannot access other org');
    }

    return this.access.list(orgId);
  }

  @Post()
  @RequirePermissions('content.assign')
  async create(@CurrentUser() actor: JwtPayload, @Param('orgId', ParseIntPipe) orgId: number, @Body() dto: CreateCourseAccessDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.access.create(orgId, { isSuperAdmin: actor.isSuperAdmin }, dto);
  }

  @Delete(':id')
  @RequirePermissions('content.assign')
  async remove(@CurrentUser() actor: JwtPayload, @Param('orgId', ParseIntPipe) orgId: number, @Param('id', ParseIntPipe) id: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.access.remove(orgId, id, { isSuperAdmin: actor.isSuperAdmin });
  }
}
