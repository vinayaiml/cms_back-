import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma/prisma.service';
import { PERMISSIONS_KEY } from '../decorators/permissions.decorator';
import { JwtPayload } from '../auth/jwt.types';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private reflector: Reflector, private prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // If no permissions required, allow.
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;

    if (!user) throw new ForbiddenException('Missing auth token');

    if (user.type !== 'user') throw new ForbiddenException('User token required');

    if (user.isSuperAdmin) return true;

    if (!user.orgId) throw new ForbiddenException('Organization scope required');

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: {
        directPermissions: { include: { permission: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });

    if (!dbUser) throw new ForbiddenException('User not found');

    const permKeys = new Set<string>();

    for (const up of dbUser.directPermissions) permKeys.add(up.permission.key);
    for (const ur of dbUser.roles) {
      for (const rp of ur.role.permissions) permKeys.add(rp.permission.key);
    }

    const ok = required.every((k) => permKeys.has(k));
    if (!ok) throw new ForbiddenException('Insufficient permissions');

    return true;
  }
}
