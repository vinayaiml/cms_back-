import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { JwtPayload } from '../auth/jwt.types';

export const CurrentUser = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): JwtPayload => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as JwtPayload;
  },
);
