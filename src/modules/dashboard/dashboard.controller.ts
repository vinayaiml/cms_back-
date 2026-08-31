import { Controller, Get, ForbiddenException, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { DashboardService } from './dashboard.service';

@Controller('me')
@UseGuards(JwtAuthGuard)
export class DashboardController {
  constructor(private dashboard: DashboardService) {}

  @Get()
  async me(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.dashboard.getMe({ userId: actor.sub, isSuperAdmin: actor.isSuperAdmin, orgId: actor.orgId });
  }

  @Get('navigation')
  async navigation(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.dashboard.getNavigation({ userId: actor.sub, isSuperAdmin: actor.isSuperAdmin, orgId: actor.orgId });
  }
}
