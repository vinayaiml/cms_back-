import { BadRequestException, Controller, ForbiddenException, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { JwtPayload } from '../../common/auth/jwt.types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { AuditService } from './audit.service';

@Controller('audit-events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AuditController {
  constructor(private audit: AuditService) {}

  @Get()
  @RequirePermissions('audit.read')
  async list(
    @CurrentUser() actor: JwtPayload,
    @Query('orgId') orgId?: string,
    @Query('action') action?: string,
    @Query('targetType') targetType?: string,
    @Query('limit') limit?: string,
  ) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');

    const parsedOrgId = this.parseOptionalInt('orgId', orgId);
    const parsedLimit = this.parseOptionalInt('limit', limit);

    return this.audit.listForActor(
      { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin },
      { orgId: parsedOrgId, action, targetType, limit: parsedLimit },
    );
  }

  private parseOptionalInt(name: string, value?: string) {
    if (!value) return undefined;
    const parsed = Number(value);
    if (!Number.isInteger(parsed)) throw new BadRequestException(`${name} must be an integer`);
    return parsed;
  }
}
