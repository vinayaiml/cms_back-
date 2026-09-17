import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class RolesService {
  constructor(private prisma: PrismaService) {}

  private async getOrgPermissionKeys(orgId: number): Promise<Set<string>> {
    const rows = await this.prisma.orgPermission.findMany({
      where: { orgId },
      include: { permission: true },
    });
    return new Set(rows.map((row) => row.permission.key));
  }

  private async getEffectivePermissionKeys(userId: number): Promise<Set<string>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: {
        directPermissions: { include: { permission: true } },
        roles: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
      },
    });
    if (!user) throw new NotFoundException('User not found');
    if (!user.orgId) return new Set();

    const orgAllowedKeys = await this.getOrgPermissionKeys(user.orgId);

    const keys = new Set<string>();
    for (const up of user.directPermissions) {
      if (orgAllowedKeys.has(up.permission.key)) keys.add(up.permission.key);
    }
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        if (orgAllowedKeys.has(rp.permission.key)) keys.add(rp.permission.key);
      }
    }
    return keys;
  }

  async list(orgId: number) {
    return this.prisma.role.findMany({
      where: { orgId },
      include: { permissions: { include: { permission: true } } },
      orderBy: { id: 'desc' },
    });
  }

  async create(orgId: number, name: string, description?: string) {
    return this.prisma.role.create({
      data: { orgId, name, description },
    });
  }

  async addPermission(
    roleId: number,
    permissionKey: string,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    if (!actor.isSuperAdmin && role.name.trim().toLowerCase() === 'org admin') {
      throw new ForbiddenException('Org Admin role permissions are locked');
    }

    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException('Org scope required');
      if (role.orgId !== actor.orgId) throw new ForbiddenException('Cannot modify other org role');
    }

    const perm = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (!perm) throw new NotFoundException('Permission not found');
    if (!actor.isSuperAdmin && (permissionKey.startsWith('org.') || permissionKey.startsWith('superadmin.'))) {
      throw new ForbiddenException('org.* and superadmin.* permissions are reserved for Super Admin');
    }

    // Org roles can only receive permissions granted to that organization.
    if (role.orgId) {
      const orgPerm = await this.prisma.orgPermission.findFirst({
        where: { orgId: role.orgId, permissionId: perm.id },
      });
      if (!orgPerm) {
        throw new ForbiddenException('Permission is not granted to this organization');
      }
    }

    if (!actor.isSuperAdmin) {
      const actorPermissionKeys = await this.getEffectivePermissionKeys(actor.userId);
      if (!actorPermissionKeys.has(permissionKey)) {
        throw new ForbiddenException('Cannot grant permission outside your own permissions');
      }

      const selfHasRole = await this.prisma.userRole.findFirst({
        where: { userId: actor.userId, roleId },
        select: { id: true },
      });
      if (selfHasRole) {
        throw new ForbiddenException('You cannot change permissions for your own assigned role');
      }
    }

    await this.prisma.rolePermission.upsert({
      where: { roleId_permissionId: { roleId, permissionId: perm.id } },
      update: {},
      create: { roleId, permissionId: perm.id },
    });

    return { ok: true };
  }

  async removePermission(
    roleId: number,
    permissionKey: string,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const role = await this.prisma.role.findUnique({ where: { id: roleId } });
    if (!role) throw new NotFoundException('Role not found');

    if (!actor.isSuperAdmin && role.name.trim().toLowerCase() === 'org admin') {
      throw new ForbiddenException('Org Admin role permissions are locked');
    }

    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException('Org scope required');
      if (role.orgId !== actor.orgId) throw new ForbiddenException('Cannot modify other org role');

      const selfHasRole = await this.prisma.userRole.findFirst({
        where: { userId: actor.userId, roleId },
        select: { id: true },
      });
      if (selfHasRole) {
        throw new ForbiddenException('You cannot change permissions for your own assigned role');
      }
    }

    const perm = await this.prisma.permission.findUnique({ where: { key: permissionKey } });
    if (!perm) throw new NotFoundException('Permission not found');

    await this.prisma.rolePermission.deleteMany({
      where: { roleId, permissionId: perm.id },
    });

    return { ok: true };
  }
}
