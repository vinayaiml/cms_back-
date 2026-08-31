import { Body, Controller, ForbiddenException, Get, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { PermissionsService } from './permissions.service';
import { CreatePermissionDto } from './permissions.dto';

@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PermissionsController {
  constructor(private perms: PermissionsService) {}

  // Read-only catalog (org admins can use it to build roles)
  @Get('catalog')
  @RequirePermissions('role.read')
  async catalog(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    // Super admin bypasses PermissionsGuard anyway; org users need role.read
    return this.perms.list();
  }

  // Manage (Super Admin only)
  @Get()
  @RequirePermissions('permission.manage')
  async list(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.perms.list();
  }

  @Post()
  @RequirePermissions('permission.manage')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreatePermissionDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    void dto;
    throw new ForbiddenException('Permission catalog is fixed in backend code. Assign existing permissions to roles.');
  }
}
