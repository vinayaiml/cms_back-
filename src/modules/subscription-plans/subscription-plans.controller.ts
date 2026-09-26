import { Body, Controller, Delete, ForbiddenException, Get, Param, ParseIntPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { CreateSubscriptionPlanDto, SetPlanCapabilitiesDto, UpdateSubscriptionPlanDto } from './subscription-plans.dto';
import { SubscriptionPlansService } from './subscription-plans.service';

@Controller('subscription-plans')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SubscriptionPlansController {
  constructor(private plans: SubscriptionPlansService) {}

  @Get()
  @RequirePermissions('subscription.read')
  async list(@CurrentUser() actor: JwtPayload, @Query('includeInactive') includeInactive?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.plans.list({ includeInactive: actor.isSuperAdmin && includeInactive === 'true' });
  }

  @Get(':id')
  @RequirePermissions('subscription.read')
  async get(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Query('includeInactive') includeInactive?: string) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.plans.get(id, { includeInactive: actor.isSuperAdmin && includeInactive === 'true' });
  }

  @Post()
  @RequirePermissions('subscription.manage')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateSubscriptionPlanDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.plans.create(dto);
  }

  @Patch(':id')
  @RequirePermissions('subscription.manage')
  async update(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSubscriptionPlanDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.plans.update(id, dto);
  }

  @Put(':id/capabilities')
  @RequirePermissions('subscription.manage')
  async setCapabilities(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: SetPlanCapabilitiesDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.plans.setCapabilities(id, dto.capabilityStableKeys);
  }

  @Delete(':id')
  @RequirePermissions('subscription.manage')
  async disable(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.plans.disable(id);
  }
}
