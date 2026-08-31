import { Body, Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { SectionsService } from './sections.service';
import { CreateSectionDto, UpdateSectionDto } from './sections.dto';

@Controller('dashboard/sections')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SectionsController {
  constructor(private sections: SectionsService) {}

  @Get()
  @RequirePermissions('dashboard.section.manage')
  async list(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.sections.list();
  }

  @Post()
  @RequirePermissions('dashboard.section.manage')
  async create(@CurrentUser() actor: JwtPayload, @Body() dto: CreateSectionDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.sections.create(dto);
  }

  @Put(':id')
  @RequirePermissions('dashboard.section.manage')
  async update(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number, @Body() dto: UpdateSectionDto) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    if (!actor.isSuperAdmin) throw new ForbiddenException('Super Admin only');
    return this.sections.update(id, dto);
  }
}
