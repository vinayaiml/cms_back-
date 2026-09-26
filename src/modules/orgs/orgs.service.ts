import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { SubscriptionStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AssignOrgSubscriptionDto, CreateOrgDto, UpdateOrgDto } from './orgs.dto';

@Injectable()
export class OrgsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private readonly organizationSelect = {
    id: true,
    name: true,
    state: true,
    city: true,
    authorizedPersonName: true,
    contactNo: true,
    logoUrl: true,
    primaryColor: true,
    secondaryColor: true,
    tenantVersion: true,
    isActive: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  async listAll() {
    return this.prisma.organization.findMany({
      orderBy: { id: 'desc' },
      select: this.organizationSelect,
    });
  }

  async create(dto: CreateOrgDto) {
    const existingAdmin = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (existingAdmin) throw new ConflictException('Admin email already exists');

    const org = await this.prisma.organization.create({
      data: {
        name: dto.name,
        state: dto.state,
        city: dto.city,
        authorizedPersonName: dto.authorizedPersonName,
        contactNo: dto.contactNo,
      },
      select: this.organizationSelect,
    });

    // Default org policy excludes superadmin.* and org.* permissions.
    const allNonSuperAdminPerms = await this.prisma.permission.findMany({
      where: { key: { not: 'superadmin.*' } },
      select: { id: true, key: true },
    });
    const defaultPerms = allNonSuperAdminPerms.filter((p) => !p.key.startsWith('org.') && !p.key.startsWith('superadmin.'));

    if (defaultPerms.length) {
      await this.prisma.orgPermission.createMany({
        data: defaultPerms.map((p) => ({ orgId: org.id, permissionId: p.id })),
        skipDuplicates: true,
      });
    }

    await this.prisma.role.upsert({
      where: { orgId_name: { orgId: org.id, name: 'Org Admin' } },
      update: { description: 'Organization administrator' },
      create: {
        orgId: org.id,
        name: 'Org Admin',
        description: 'Organization administrator',
      },
    });

    if (defaultPerms.length) {
      const orgAdminRole = await this.prisma.role.findUnique({
        where: { orgId_name: { orgId: org.id, name: 'Org Admin' } },
        select: { id: true },
      });

      if (orgAdminRole) {
        await this.prisma.rolePermission.createMany({
          data: defaultPerms.map((p) => ({
            roleId: orgAdminRole.id,
            permissionId: p.id,
          })),
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
      select: this.organizationSelect,
    });
  }

  async getById(id: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id },
      select: this.organizationSelect,
    });
    if (!org) throw new NotFoundException('Organization not found');
    return org;
  }

  async delete(id: number) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.organization.delete({
      where: { id },
      select: this.organizationSelect,
    });
  }

  async toggleActive(id: number, actor: { userId: number; orgId: number | null; isSuperAdmin: boolean }, correlationId?: string) {
    const org = await this.prisma.organization.findUnique({ where: { id } });
    if (!org) throw new NotFoundException('Organization not found');

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.organization.update({
        where: { id },
        data: { isActive: !org.isActive },
        select: this.organizationSelect,
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

  private normalizeSubscriptionWindow(dto: AssignOrgSubscriptionDto) {
    const validFrom = new Date(dto.validFrom);
    const validUntil = new Date(dto.validUntil);
    if (Number.isNaN(validFrom.getTime()) || Number.isNaN(validUntil.getTime())) {
      throw new BadRequestException('Subscription validity dates must be valid ISO-8601 date strings');
    }
    if (validUntil <= validFrom) {
      throw new BadRequestException('Subscription validUntil must be after validFrom');
    }

    return {
      validFrom,
      validUntil,
      status: dto.status ?? SubscriptionStatus.ACTIVE,
    };
  }

  private subscriptionInclude() {
    return {
      plan: {
        include: {
          capabilities: {
            include: { capability: true },
            orderBy: { capability: { stableKey: 'asc' as const } },
          },
        },
      },
    };
  }

  private toSubscriptionResponse(subscription: any) {
    return {
      id: subscription.id,
      orgId: subscription.orgId,
      planId: subscription.planId,
      status: subscription.status,
      validFrom: subscription.validFrom,
      validUntil: subscription.validUntil,
      createdAt: subscription.createdAt,
      updatedAt: subscription.updatedAt,
      plan: {
        id: subscription.plan.id,
        stableKey: subscription.plan.stableKey,
        name: subscription.plan.name,
        description: subscription.plan.description,
        version: subscription.plan.version,
        isActive: subscription.plan.isActive,
        capabilities: subscription.plan.capabilities
          .map((row: any) => row.capability)
          .filter((capability: any) => capability.isActive)
          .sort((a: any, b: any) => a.stableKey.localeCompare(b.stableKey)),
      },
    };
  }

  async getSubscription(orgId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const subscription = await this.prisma.organizationSubscription.findFirst({
      where: { orgId },
      include: this.subscriptionInclude(),
      orderBy: { updatedAt: 'desc' },
    });

    return subscription ? this.toSubscriptionResponse(subscription) : null;
  }

  async assignSubscription(orgId: number, dto: AssignOrgSubscriptionDto, actor: { userId: number; orgId: number | null; isSuperAdmin: boolean }, correlationId?: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { id: true, tenantVersion: true },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const plan = await this.prisma.subscriptionPlan.findUnique({
      where: { id: dto.planId },
      select: { id: true, stableKey: true, isActive: true },
    });
    if (!plan) throw new NotFoundException('Subscription plan not found');
    if (!plan.isActive) throw new ForbiddenException('Subscription plan is inactive');

    const window = this.normalizeSubscriptionWindow(dto);
    const previous = await this.prisma.organizationSubscription.findFirst({
      where: { orgId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        planId: true,
        status: true,
        validFrom: true,
        validUntil: true,
      },
    });

    const assigned = await this.prisma.$transaction(async (tx) => {
      await tx.organizationSubscription.deleteMany({ where: { orgId } });
      const created = await tx.organizationSubscription.create({
        data: {
          orgId,
          planId: plan.id,
          status: window.status,
          validFrom: window.validFrom,
          validUntil: window.validUntil,
        },
        include: this.subscriptionInclude(),
      });

      const updatedOrg = await tx.organization.update({
        where: { id: orgId },
        data: { tenantVersion: { increment: 1 } },
        select: { tenantVersion: true },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: 'organization.subscription.assigned',
          targetType: 'organization',
          targetId: orgId,
          targetOrgId: orgId,
          correlationId,
          metadata: {
            previous: previous
              ? {
                  subscriptionId: previous.id,
                  planId: previous.planId,
                  status: previous.status,
                  validFrom: previous.validFrom.toISOString(),
                  validUntil: previous.validUntil.toISOString(),
                }
              : null,
            next: {
              planId: plan.id,
              planStableKey: plan.stableKey,
              status: window.status,
              validFrom: window.validFrom.toISOString(),
              validUntil: window.validUntil.toISOString(),
              tenantVersion: updatedOrg.tenantVersion,
            },
          },
        },
        tx,
      );

      return created;
    });

    return this.toSubscriptionResponse(assigned);
  }

  async listPermissions(orgId: number) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
    if (!org) throw new NotFoundException('Organization not found');

    const rows = await this.prisma.orgPermission.findMany({
      where: { orgId },
      include: { permission: true },
      orderBy: { permission: { key: 'asc' } },
    });

    return rows.map((r) => r.permission);
  }

  async setPermissions(orgId: number, permissionKeys: string[]) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
    });
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
        await tx.rolePermission.deleteMany({
          where: { roleId: orgAdminRole.id },
        });
        await tx.rolePermission.createMany({
          data: perms.map((p) => ({
            roleId: orgAdminRole.id,
            permissionId: p.id,
          })),
          skipDuplicates: true,
        });
      }
    });

    return this.listPermissions(orgId);
  }
}
