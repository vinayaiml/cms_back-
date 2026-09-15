import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROBOT_ONLY_KEY } from '../decorators/robot-only.decorator';
import { JwtPayload } from '../auth/jwt.types';

@Injectable()
export class RobotOnlyGuard implements CanActivate {
  constructor(private reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const robotOnly = this.reflector.getAllAndOverride<boolean>(ROBOT_ONLY_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (!robotOnly) return true;

    const req = context.switchToHttp().getRequest();
    const actor = req.user as JwtPayload | undefined;

    if (!actor) throw new ForbiddenException('Missing auth token');
    if (actor.type !== 'robot') throw new ForbiddenException('Robot token required');
    if (actor.tokenUse !== 'access') throw new ForbiddenException('Robot access token required');

    return true;
  }
}
