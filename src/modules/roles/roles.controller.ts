import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Delete, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RolesService } from './roles.service';
import { AddRolePermissionDto, CreateRoleDto, RemoveRolePermissionDto } from './roles.dto';

@Controller('roles')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class RolesController {
  constructor(private roles: RolesService) {}

  @Get()
  @RequirePermissions('role.read')
  async list(@CurrentUser() actor: JwtPayload, @Query('orgId') orgId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    // Super Admin may list roles for a specific org (required for Section Builder grant tools)
    if (actor.isSuperAdmin) {
      const parsed = orgId ? Number(orgId) : null;
      if (!parsed) return [];
      return this.roles.list(parsed);
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    return this.roles.list(actor.orgId);
  }

  @Post()
  @RequirePermissions('role.create')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateRoleDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (actor.isSuperAdmin) throw new ForbiddenException('Organizations must create roles themselves');
    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    return this.roles.create(actor.orgId, dto.name, dto.description);
  }

  @Post(':id/permissions')
  @RequirePermissions('role.update')
  async addPerm(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: AddRolePermissionDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (actor.isSuperAdmin) throw new ForbiddenException('Organizations manage role permissions themselves');
    return this.roles.addPermission(id, dto.permissionKey, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Delete(':id/permissions')
  @RequirePermissions('role.update')
  async removePerm(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: RemoveRolePermissionDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (actor.isSuperAdmin) throw new ForbiddenException('Organizations manage role permissions themselves');
    return this.roles.removePermission(id, dto.permissionKey, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }
}
