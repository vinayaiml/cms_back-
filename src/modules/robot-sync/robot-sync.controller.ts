import { Controller, Get, UseGuards, ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RobotOnlyGuard } from '../../common/guards/robot-only.guard';
import { RobotOnly } from '../../common/decorators/robot-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RobotSyncService } from './robot-sync.service';

@Controller(['robot/sync', 'v1/robot/sync'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class RobotSyncController {
  constructor(private syncService: RobotSyncService) {}

  @Get()
  async sync(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');
    return this.syncService.sync(actor.sub);
  }
}
