import { Controller, ForbiddenException, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/guards/permissions.guard';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class NotificationsController {
  constructor(private notifications: NotificationsService) {}

  @Get()
  @RequirePermissions('notification.read')
  async list(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.notifications.list({ userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }

  @Post(':id/read')
  @RequirePermissions('notification.read')
  async markRead(@CurrentUser() actor: JwtPayload, @Param('id', ParseIntPipe) id: number) {
    if (actor.type !== 'user') throw new ForbiddenException('User token required');
    return this.notifications.markRead(id, { userId: actor.sub, orgId: actor.orgId, isSuperAdmin: actor.isSuperAdmin });
  }
}
