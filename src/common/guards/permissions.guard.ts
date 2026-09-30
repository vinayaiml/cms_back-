import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { PrismaService } from "../../prisma/prisma.service";
import {
  ANY_PERMISSIONS_KEY,
  PERMISSIONS_KEY,
} from "../decorators/permissions.decorator";
import { JwtPayload } from "../auth/jwt.types";

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private reflector: Reflector,
    private prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );
    const anyRequired = this.reflector.getAllAndOverride<string[]>(
      ANY_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    // If no permissions required, allow.
    if (
      (!required || required.length === 0) &&
      (!anyRequired || anyRequired.length === 0)
    )
      return true;

    const req = context.switchToHttp().getRequest();
    const user = req.user as JwtPayload | undefined;

    if (!user) throw new ForbiddenException("Missing auth token");

    if (user.type !== "user")
      throw new ForbiddenException("User token required");

    if (user.isSuperAdmin) return true;

    if (!user.orgId)
      throw new ForbiddenException("Organization scope required");

    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.sub },
      include: {
        directPermissions: { include: { permission: true } },
        roles: {
          include: {
            role: {
              include: { permissions: { include: { permission: true } } },
            },
          },
        },
      },
    });

    if (!dbUser) throw new ForbiddenException("User not found");

    const orgPermissions = await this.prisma.orgPermission.findMany({
      where: { orgId: user.orgId },
      include: { permission: true },
    });
    const orgAllowedKeys = new Set(
      orgPermissions.map((row) => row.permission.key),
    );

    const permKeys = new Set<string>();

    for (const up of dbUser.directPermissions) {
      if (orgAllowedKeys.has(up.permission.key))
        permKeys.add(up.permission.key);
    }
    for (const ur of dbUser.roles) {
      for (const rp of ur.role.permissions) {
        if (orgAllowedKeys.has(rp.permission.key))
          permKeys.add(rp.permission.key);
      }
    }

    const hasAllRequired = !required || required.every((k) => permKeys.has(k));
    const hasAnyRequired =
      !anyRequired ||
      anyRequired.length === 0 ||
      anyRequired.some((k) => permKeys.has(k));
    if (!hasAllRequired || !hasAnyRequired)
      throw new ForbiddenException("Insufficient permissions");

    return true;
  }
}
