import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RobotOnlyGuard } from '../../common/guards/robot-only.guard';
import { RobotOnly } from '../../common/decorators/robot-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { UploadUsageLogsDto } from './usage-logs.dto';
import { UsageLogsService } from './usage-logs.service';

@Controller(['robot/logs', 'v1/robot/logs'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class UsageLogsController {
  constructor(private usage: UsageLogsService) {}

  @Post('batch')
  async upload(@CurrentUser() actor: JwtPayload, @Body() dto: UploadUsageLogsDto) {
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');

    const logs = dto.logs.map((l) => ({
      eventId: l.eventId,
      courseId: l.courseId,
      lessonId: l.lessonId,
      openedAt: new Date(l.openedAt),
      durationSec: l.durationSec,
    }));

    return this.usage.upload(actor.sub, actor.orgId, logs);
  }
}
