import { Body, Controller, Delete, ForbiddenException, Get, Headers, Param, ParseIntPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload, JwtUserPayload } from '../../common/auth/jwt.types';
import { OrgsService } from './orgs.service';
import { AssignOrgSubscriptionDto, CreateOrgDto, UpdateOrgDto, UpdateOrgPermissionsDto } from './orgs.dto';

@Controller('orgs')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrgsController {
  constructor(private orgs: OrgsService) {}

  private assertSuperAdmin(actor: JwtPayload): asserts actor is JwtUserPayload {
    if (actor.type !== 'user' || !actor.isSuperAdmin) {
      throw new ForbiddenException('Only Super Admin can manage organizations');
    }
  }

  // Super Admin: list all orgs
  @Get()
  @RequirePermissions('org.read')
  async list(@CurrentUser() actor: JwtPayload) {
    this.assertSuperAdmin(actor);
    return this.orgs.listAll();
  }

  @Post()
  @RequirePermissions('org.create')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateOrgDto) {
    this.assertSuperAdmin(actor);
    return this.orgs.create(dto);
  }

  @Get('me')
  async myOrg(@CurrentUser() actor: JwtPayload) {
    this.assertSuperAdmin(actor);
    return this.orgs.getMyOrg(actor.orgId ?? null);
  }

  @Get(':id')
  @RequirePermissions('org.read')
  async get(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    this.assertSuperAdmin(actor);
    return this.orgs.getById(id);
  }

  @Put(':id')
  @RequirePermissions('org.update')
  async update(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrgDto) {
    this.assertSuperAdmin(actor);
    return this.orgs.update(id, dto);
  }

  @Delete(':id')
  @RequirePermissions('org.delete')
  async delete(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    this.assertSuperAdmin(actor);
    return this.orgs.delete(id);
  }

  @Patch(':id/toggle-active')
  @RequirePermissions('org.update')
  async toggleActive(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Headers('x-correlation-id') correlationId?: string) {
    this.assertSuperAdmin(actor);
    return this.orgs.toggleActive(
      id,
      {
        userId: actor.sub,
        orgId: actor.orgId,
        isSuperAdmin: actor.isSuperAdmin,
      },
      correlationId,
    );
  }

  @Get(':id/subscription')
  @RequirePermissions('subscription.read')
  async getSubscription(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    this.assertSuperAdmin(actor);
    return this.orgs.getSubscription(id);
  }

  @Put(':id/subscription')
  @RequirePermissions('subscription.manage')
  async assignSubscription(
    @CurrentUser() actor: JwtPayload,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AssignOrgSubscriptionDto,
    @Headers('x-correlation-id') correlationId?: string,
  ) {
    this.assertSuperAdmin(actor);
    return this.orgs.assignSubscription(
      id,
      dto,
      {
        userId: actor.sub,
        orgId: actor.orgId,
        isSuperAdmin: actor.isSuperAdmin,
      },
      correlationId,
    );
  }

  @Get(':id/permissions')
  @RequirePermissions('role.read')
  async listPermissions(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    this.assertSuperAdmin(actor);
    return this.orgs.listPermissions(id);
  }

  @Put(':id/permissions')
  @RequirePermissions('permission.manage')
  async setPermissions(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateOrgPermissionsDto) {
    this.assertSuperAdmin(actor);
    return this.orgs.setPermissions(id, dto.permissionKeys || []);
  }
}
