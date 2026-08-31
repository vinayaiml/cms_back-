import { ExecutionContext, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly logger = new Logger(JwtAuthGuard.name);

  handleRequest(err: any, user: any, info: any, context: ExecutionContext) {
    if (err || !user) {
      const req = context.switchToHttp().getRequest();
      const method = req?.method || 'UNKNOWN';
      const url = req?.originalUrl || req?.url || 'UNKNOWN';
      const authHeader = req?.headers?.authorization ? 'present' : 'missing';
      const reason = info?.message || err?.message || 'Unauthorized';

      this.logger.warn(`401 ${method} ${url} auth=${authHeader} reason="${reason}"`);
      throw err || new UnauthorizedException(reason);
    }
    return user;
  }
}
