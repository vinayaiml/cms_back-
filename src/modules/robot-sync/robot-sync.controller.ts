import { BadRequestException, Controller, ForbiddenException, Get, Headers, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RobotOnlyGuard } from '../../common/guards/robot-only.guard';
import { RobotOnly } from '../../common/decorators/robot-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RobotSyncHeartbeat, RobotSyncService } from './robot-sync.service';

function optionalHeader(value: string | string[] | undefined) {
  if (Array.isArray(value)) return value[0];
  return value;
}

function validateOptionalHeader(value: string | undefined, name: string, maxLength: number, pattern: RegExp) {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;

  if (trimmed.length > maxLength || !pattern.test(trimmed)) {
    throw new BadRequestException(`${name} is invalid`);
  }

  return trimmed;
}

@Controller(['robot/sync', 'v1/robot/sync'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class RobotSyncController {
  constructor(private syncService: RobotSyncService) {}

  @Get()
  async sync(
    @CurrentUser() actor: JwtPayload,
    @Headers('x-robot-app-version') appVersionHeader?: string | string[],
    @Headers('x-robot-device-model') deviceModelHeader?: string | string[],
  ) {
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');

    const heartbeat: RobotSyncHeartbeat = {
      appVersion: validateOptionalHeader(
        optionalHeader(appVersionHeader),
        'x-robot-app-version',
        40,
        /^[0-9A-Za-z._+-]+$/,
      ),
      deviceModel: validateOptionalHeader(
        optionalHeader(deviceModelHeader),
        'x-robot-device-model',
        80,
        /^[0-9A-Za-z._+() -]+$/,
      ),
    };

    return this.syncService.sync(actor.sub, heartbeat);
  }
}
