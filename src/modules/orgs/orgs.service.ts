import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateOrgDto, UpdateOrgDto } from './orgs.dto';

@Injectable()
export class OrgsService {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  async listAll() {
    return this.prisma.organization.findMany({ orderBy: { id: 'desc' } });
  }

  async create(dto: CreateOrgDto) {
    const existingAdmin = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existingAdmin) throw new ConflictException('Admin email already exists');

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        state: dto.state,
        city: dto.city,
        authorizedPersonName: dto.authorizedPersonName,
        contactNo: dto.contactNo,
      },
    });

    // Default org policy excludes superadmin.* and org.* permissions.
    const allNonSuperAdminPerms = await this.prisma.permission.findMany({
      where: { key: { not: 'superadmin.*' } },
      select: { id: true, key: true },
    });
    const defaultPerms = allNonSuperAdminPerms.filter(
      (p) => !p.key.startsWith('org.') && !p.key.startsWith('superadmin.'),
    );

    if (defaultPerms.length) {
      await this.prisma.orgPermission.createMany({
        data: defaultPerms.map((p) => ({ orgId: org.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }

    await this.prisma.role.upsert({
      where: { orgId_name: { orgId: org.id, name: 'Org Admin' } },
      update: { description: 'Organization administrator' },
      create: { orgId: org.id, name: 'Org Admin', description: 'Organization administrator' },
    });

    if (defaultPerms.length) {
      const orgAdminRole = await this.prisma.role.findUnique({
        where: { orgId_name: { orgId: org.id, name: 'Org Admin' } },
        select: { id: true },
      });

      if (orgAdminRole) {
        await this.prisma.rolePermission.createMany({
          data: defaultPerms.map((p) => ({ roleId: orgAdminRole.id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    }

    return org;
  }

  async update(id: number, dto: UpdateOrgDto) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.organization.update({
      where: { id },
      data: {
        name: dto.name,
        state: dto.state,
        city: dto.city,
        authorizedPersonName: dto.authorizedPersonName,
        contactNo: dto.contactNo,
      },
    });
  }

  async getById(id: number) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async delete(id: number) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.organization.delete({ where: { id } });
  }

  async toggleActive(
    id: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id },
        data: { isActive: !org.isActive },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: updated.isActive ? 'organization.reactivated' : 'organization.deactivated',
          targetType: 'organization',
          targetId: updated.id,
          targetOrgId: updated.id,
          correlationId,
          metadata: {
            previousStatus: org.isActive ? 'active' : 'inactive',
            newStatus: updated.isActive ? 'active' : 'inactive',
          },
        },
        tx,
      );

      return updated;
    });
  }

  async getMyOrg(orgId: number | null) {
    if (!orgId) return null;
    return this.getById(orgId);
  }

  async listPermissions(orgId: number) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const rows = await this.prisma.orgPermission.findMany({
      where: { orgId },
      include: { permission: true },
      orderBy: { permission: { key: 'asc' } },
    });

    return rows.map((r) => r.permission);
  }

  async setPermissions(orgId: number, permissionKeys: string[]) {
    const org = await this.prisma.organization.findUnique({ where: { id: orgId } });
    if (!org) throw new NotFoundException('Organization not found');

    const keys = Array.from(new Set(permissionKeys.map((k) => k.trim()).filter(Boolean)));
    if (keys.some((k) => k.startsWith('org.') || k.startsWith('superadmin.'))) {
      throw new ForbiddenException('org.* and superadmin.* permissions cannot be granted to organizations');
    }
    const perms = keys.length ? await this.prisma.permission.findMany({ where: { key: { in: keys } } }) : [];
    const found = new Set(perms.map((p) => p.key));
    const missing = keys.filter((k) => !found.has(k));
    if (missing.length) throw new NotFoundException(`Unknown permission keys: ${missing.join(', ')}`);

    await this.prisma.$transaction(async (tx) => {
      await tx.orgPermission.deleteMany({ where: { orgId } });
      if (!perms.length) return;
      await tx.orgPermission.createMany({
        data: perms.map((p) => ({ orgId, permissionId: p.id })),
      });

      // Keep default Org Admin role aligned with org policy.
      const orgAdminRole = await tx.role.findFirst({
        where: { orgId, name: 'Org Admin' },
        select: { id: true },
      });

      if (orgAdminRole) {
        await tx.rolePermission.deleteMany({ where: { roleId: orgAdminRole.id } });
        await tx.rolePermission.createMany({
          data: perms.map((p) => ({ roleId: orgAdminRole.id, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    });

    return this.listPermissions(orgId);
  }
}
