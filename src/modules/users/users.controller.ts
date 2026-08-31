import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { UsersService } from './users.service';
import { AssignRoleDto, CreateUserDto, UpdateUserDto } from './users.dto';

@Controller('users')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UsersController {
  constructor(private users: UsersService) {}

  @Get()
  @RequirePermissions('user.read')
  async list(@CurrentUser() actor: JwtPayload, @Query('orgId') orgId?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    if (actor.isSuperAdmin) {
      // For safety, require explicit orgId filter for now
      const parsed = orgId ? Number(orgId) : null;
      if (!parsed) return [];
      return this.users.listUsers(parsed);
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');
    return this.users.listUsers(actor.orgId);
  }

  @Post()
  @RequirePermissions('user.create')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateUserDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (actor.isSuperAdmin) {
      if (!dto.orgId) throw new ForbiddenException('orgId is required when Super Admin creates a user');
      return this.users.createUser({
        email: dto.email,
        fullName: dto.fullName,
        password: dto.password,
        orgId: dto.orgId,
        roleIds: dto.roleIds,
        permissionKeys: dto.permissionKeys,
      }, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
    }

    const orgId = actor.orgId;
    if (!orgId) throw new ForbiddenException('Org scope required');

    return this.users.createUser({
      email: dto.email,
      fullName: dto.fullName,
      password: dto.password,
      orgId,
      roleIds: dto.roleIds,
      permissionKeys: dto.permissionKeys,
    }, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Post(':id/roles')
  @RequirePermissions('role.update')
  async assignRole(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: AssignRoleDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.users.assignRole(id, dto.roleId, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Post(':id/permissions')
  @RequirePermissions('role.update')
  async setDirectPermissions(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body('permissionKeys') permissionKeys: string[] = []) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.users.setDirectPermissions(id, permissionKeys, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Patch(':id')
  @RequirePermissions('user.update')
  async update(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateUserDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.users.updateUser(id, dto, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Delete(':id')
  @RequirePermissions('user.delete')
  async delete(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.users.deleteUser(id, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Post(':id/toggle-lock')
  @RequirePermissions('user.update')
  async toggleLock(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.users.toggleLock(id, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }
}
