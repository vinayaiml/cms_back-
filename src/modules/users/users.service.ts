import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";
import * as bcrypt from "bcrypt";
import { AuditService } from "../audit/audit.service";
import { UpsertUserCapabilityAssignmentDto } from "./users.dto";
import { EntitlementsService } from "../entitlements/entitlements.service";

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private entitlements: EntitlementsService,
  ) {}

  private validateCapabilityLimits(
    value: unknown,
    depth = 0,
  ): Prisma.JsonValue {
    if (depth > 4)
      throw new BadRequestException("Capability limits are too deeply nested");
    if (value === null) return null;
    if (typeof value === "boolean") return value;
    if (typeof value === "number") {
      if (!Number.isFinite(value) || Math.abs(value) > 1_000_000)
        throw new BadRequestException(
          "Capability limits contain invalid numeric value",
        );
      return value;
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed.length > 120)
        throw new BadRequestException(
          "Capability limits contain invalid text value",
        );
      if (
        /token|secret|password|license|jwt|authorization|cookie|private/i.test(
          trimmed,
        )
      )
        throw new BadRequestException(
          "Capability limits contain prohibited value",
        );
      return trimmed;
    }
    if (Array.isArray(value)) {
      if (value.length > 20)
        throw new BadRequestException(
          "Capability limits contain too many values",
        );
      return value.map((item) =>
        this.validateCapabilityLimits(item, depth + 1),
      ) as Prisma.JsonArray;
    }
    if (typeof value === "object") {
      const entries = Object.entries(value as Record<string, unknown>);
      if (entries.length > 20)
        throw new BadRequestException(
          "Capability limits contain too many keys",
        );
      const clean: Record<string, Prisma.JsonValue> = {};
      for (const [key, item] of entries) {
        const normalizedKey = key.trim();
        if (!/^[A-Za-z][A-Za-z0-9_.-]{0,63}$/.test(normalizedKey))
          throw new BadRequestException(
            "Capability limits contain invalid key",
          );
        if (
          /password|passcode|token|jwt|secret|authorization|cookie|hash|apiKey|licenseKey|privateKey|accessKey|refreshToken/i.test(
            normalizedKey,
          )
        ) {
          throw new BadRequestException(
            "Capability limits contain prohibited key",
          );
        }
        clean[normalizedKey] = this.validateCapabilityLimits(item, depth + 1);
      }
      return clean as Prisma.JsonObject;
    }
    throw new BadRequestException(
      "Capability limits contain unsupported value",
    );
  }

  private sanitizeCapabilityLimits(
    limits?: Record<string, unknown>,
  ): Prisma.InputJsonObject | null {
    if (limits === undefined || limits === null) return null;
    if (typeof limits !== "object" || Array.isArray(limits))
      throw new BadRequestException("Capability limits must be an object");
    return this.validateCapabilityLimits(
      limits,
    ) as unknown as Prisma.InputJsonObject;
  }

  private toUserCapabilityAssignmentResponse(assignment: {
    id: number;
    userId: number;
    capabilityId: number;
    isEnabled: boolean;
    limits: Prisma.JsonValue | null;
    createdByUserId: number | null;
    createdAt: Date;
    updatedAt: Date;
    capability: { stableKey: string; name: string };
    user?: { orgId: number | null };
  }) {
    return {
      id: assignment.id,
      userId: assignment.userId,
      orgId: assignment.user?.orgId,
      capabilityId: assignment.capabilityId,
      capabilityStableKey: assignment.capability.stableKey,
      capabilityName: assignment.capability.name,
      isEnabled: assignment.isEnabled,
      limits: assignment.limits,
      createdByUserId: assignment.createdByUserId,
      createdAt: assignment.createdAt,
      updatedAt: assignment.updatedAt,
    };
  }

  private async getUserOrThrow(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      include: { org: { select: { isActive: true } } },
    });
    if (!user) throw new NotFoundException("User not found");
    return user;
  }

  private assertCanReadUserCapabilities(
    user: { orgId: number | null },
    actor: { orgId: number | null; isSuperAdmin: boolean },
  ) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId) throw new ForbiddenException("Org scope required");
    if (user.orgId !== actor.orgId)
      throw new ForbiddenException("Cannot access other org user");
  }

  private assertCanManageUserCapabilities(
    user: { id: number; orgId: number | null; createdByUserId: number | null },
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    if (actor.isSuperAdmin) return;
    if (!actor.orgId) throw new ForbiddenException("Org scope required");
    if (user.orgId !== actor.orgId)
      throw new ForbiddenException("Cannot modify other org user");
    if (user.id === actor.userId)
      throw new ForbiddenException(
        "You cannot modify your own capability assignments",
      );
    if (user.createdByUserId !== actor.userId)
      throw new ForbiddenException("You can only manage users you created");
  }

  async listUsers(orgId: number) {
    return this.prisma.user.findMany({
      where: { orgId },
      select: {
        id: true,
        email: true,
        fullName: true,
        orgId: true,
        isSuperAdmin: true,
        isLocked: true,
        createdByUserId: true,
        createdAt: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
        directPermissions: {
          select: { permission: { select: { id: true, key: true } } },
        },
      },
      orderBy: { id: "desc" },
    });
  }

  private async getOrgPermissionKeys(orgId: number): Promise<Set<string>> {
    const rows = await this.prisma.orgPermission.findMany({
      where: { orgId },
      include: { permission: true },
    });
    return new Set(rows.map((row) => row.permission.key));
  }

  private async getEffectivePermissionKeys(
    userId: number,
  ): Promise<Set<string>> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
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

    if (!user) throw new NotFoundException("User not found");
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

  private async assertPermissionKeysWithinOrgCeiling(
    orgId: number | null,
    permissionKeys: string[],
  ) {
    if (!orgId || permissionKeys.length === 0) return;

    const allowedKeys = await this.getOrgPermissionKeys(orgId);
    const denied = permissionKeys.filter((key) => !allowedKeys.has(key));
    if (denied.length) {
      throw new ForbiddenException(
        "Permission is not granted to this organization",
      );
    }
  }

  private async assertRolesWithinOrgCeiling(
    orgId: number | null,
    roles: Array<{
      name: string;
      permissions: Array<{ permission: { key: string } }>;
    }>,
  ) {
    if (!orgId || roles.length === 0) return;

    const allowedKeys = await this.getOrgPermissionKeys(orgId);
    for (const role of roles) {
      const denied = role.permissions
        .map((rp) => rp.permission.key)
        .filter((key) => !allowedKeys.has(key));
      if (denied.length) {
        throw new ForbiddenException(
          `Cannot assign role "${role.name}" because it exceeds organization permissions`,
        );
      }
    }
  }

  async createUser(
    data: {
      email: string;
      fullName: string;
      password: string;
      orgId: number | null;
      isSuperAdmin?: boolean;
      roleIds?: number[];
      permissionKeys?: string[];
    },
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const existing = await this.prisma.user.findUnique({
      where: { email: data.email },
    });
    if (existing) throw new ConflictException("Email already exists");

    if (!actor.isSuperAdmin && !actor.orgId)
      throw new ForbiddenException("Org scope required");
    if (!actor.isSuperAdmin && data.orgId !== actor.orgId)
      throw new ForbiddenException("Cannot create user in another org");

    const requestedRoleIds = Array.from(
      new Set((data.roleIds ?? []).filter((id) => Number.isInteger(id))),
    );
    const requestedPermissionKeys = Array.from(
      new Set((data.permissionKeys ?? []).map((k) => k.trim()).filter(Boolean)),
    );
    const actorPermissionKeys = actor.isSuperAdmin
      ? null
      : await this.getEffectivePermissionKeys(actor.userId);

    const roleRows = requestedRoleIds.length
      ? await this.prisma.role.findMany({
          where: { id: { in: requestedRoleIds } },
          include: { permissions: { include: { permission: true } } },
        })
      : [];

    if (roleRows.length !== requestedRoleIds.length)
      throw new NotFoundException("One or more roles not found");
    if (
      !actor.isSuperAdmin &&
      roleRows.some((r) => r.name.trim().toLowerCase() === "org admin")
    ) {
      throw new ForbiddenException(
        "Org Admin role cannot be assigned from Users",
      );
    }

    const roleOrgMismatch = roleRows.some((r) => r.orgId !== data.orgId);
    if (roleOrgMismatch)
      throw new ForbiddenException("Role must belong to the same organization");

    const permissionRows = requestedPermissionKeys.length
      ? await this.prisma.permission.findMany({
          where: { key: { in: requestedPermissionKeys } },
        })
      : [];
    if (permissionRows.length !== requestedPermissionKeys.length)
      throw new NotFoundException("One or more permissions not found");

    await this.assertPermissionKeysWithinOrgCeiling(
      data.orgId,
      requestedPermissionKeys,
    );
    await this.assertRolesWithinOrgCeiling(data.orgId, roleRows);

    // permission.manage allows org admins to manage allowed tenant permissions,
    // but never to exceed the organization's approved permission ceiling.
    const hasPermissionManage = actorPermissionKeys?.has("permission.manage");
    if (!actor.isSuperAdmin && actorPermissionKeys && !hasPermissionManage) {
      for (const key of requestedPermissionKeys) {
        if (!actorPermissionKeys.has(key))
          throw new ForbiddenException(`Cannot grant permission: ${key}`);
      }

      for (const role of roleRows) {
        for (const rp of role.permissions) {
          if (!actorPermissionKeys.has(rp.permission.key)) {
            throw new ForbiddenException(
              `Cannot assign role "${role.name}" because it has higher permissions`,
            );
          }
        }
      }
    }

    const passwordHash = await bcrypt.hash(data.password, 10);

    return this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: data.email,
          fullName: data.fullName,
          passwordHash,
          orgId: data.orgId ?? null,
          createdByUserId: actor.isSuperAdmin ? null : actor.userId,
          isSuperAdmin: data.isSuperAdmin ?? false,
        },
        select: {
          id: true,
          email: true,
          fullName: true,
          orgId: true,
          isSuperAdmin: true,
          createdAt: true,
        },
      });

      if (roleRows.length) {
        await tx.userRole.createMany({
          data: roleRows.map((r) => ({ userId: created.id, roleId: r.id })),
          skipDuplicates: true,
        });
      }

      if (permissionRows.length) {
        await tx.userPermission.createMany({
          data: permissionRows.map((p) => ({
            userId: created.id,
            permissionId: p.id,
          })),
          skipDuplicates: true,
        });
      }

      return created;
    });
  }

  async assignRole(
    userId: number,
    roleId: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    // tenant enforcement: non-super admin can only modify users in their org
    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException("Org scope required");
      if (user.orgId !== actor.orgId)
        throw new ForbiddenException("Cannot modify other org user");
      if (user.id === actor.userId)
        throw new ForbiddenException(
          "You cannot modify your own permissions/roles",
        );
      if (user.createdByUserId !== actor.userId) {
        throw new ForbiddenException("You can only manage users you created");
      }
    }

    const role = await this.prisma.role.findUnique({
      where: { id: roleId },
      include: { permissions: { include: { permission: true } } },
    });
    if (!role) throw new NotFoundException("Role not found");

    if (role.orgId !== user.orgId) {
      throw new ForbiddenException("Role must belong to same org");
    }
    if (role.name.trim().toLowerCase() === "org admin") {
      throw new ForbiddenException(
        "Org Admin role cannot be assigned from Users",
      );
    }

    await this.assertRolesWithinOrgCeiling(user.orgId, [role]);

    if (!actor.isSuperAdmin) {
      const actorPermissionKeys = await this.getEffectivePermissionKeys(
        actor.userId,
      );
      const hasPermissionManage = actorPermissionKeys.has("permission.manage");
      if (!hasPermissionManage) {
        for (const rp of role.permissions) {
          if (!actorPermissionKeys.has(rp.permission.key)) {
            throw new ForbiddenException(
              `Cannot assign role "${role.name}" because it has higher permissions`,
            );
          }
        }
      }
    }

    await this.prisma.userRole.upsert({
      where: { userId_roleId: { userId, roleId } },
      update: {},
      create: { userId, roleId },
    });

    return { ok: true };
  }

  async setDirectPermissions(
    userId: number,
    permissionKeys: string[],
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException("Org scope required");
      if (user.orgId !== actor.orgId)
        throw new ForbiddenException("Cannot modify other org user");
      if (user.id === actor.userId)
        throw new ForbiddenException(
          "You cannot modify your own permissions/roles",
        );
      if (user.createdByUserId !== actor.userId) {
        throw new ForbiddenException("You can only manage users you created");
      }
    }

    const uniqueKeys = Array.from(
      new Set(permissionKeys.map((k) => k.trim()).filter(Boolean)),
    );
    const rows = uniqueKeys.length
      ? await this.prisma.permission.findMany({
          where: { key: { in: uniqueKeys } },
        })
      : [];
    if (rows.length !== uniqueKeys.length)
      throw new NotFoundException("One or more permissions not found");

    await this.assertPermissionKeysWithinOrgCeiling(user.orgId, uniqueKeys);

    if (!actor.isSuperAdmin) {
      const actorPermissionKeys = await this.getEffectivePermissionKeys(
        actor.userId,
      );
      const hasPermissionManage = actorPermissionKeys.has("permission.manage");
      if (!hasPermissionManage) {
        for (const k of uniqueKeys) {
          if (!actorPermissionKeys.has(k))
            throw new ForbiddenException(`Cannot grant permission: ${k}`);
        }
      }
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.userPermission.deleteMany({ where: { userId } });
      if (rows.length) {
        await tx.userPermission.createMany({
          data: rows.map((p) => ({ userId, permissionId: p.id })),
          skipDuplicates: true,
        });
      }
    });

    return { ok: true };
  }

  async listCapabilityAssignments(
    userId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.getUserOrThrow(userId);
    this.assertCanReadUserCapabilities(user, actor);

    const assignments = await this.prisma.userCapabilityAssignment.findMany({
      where: { userId },
      include: { capability: true, user: { select: { orgId: true } } },
      orderBy: { capability: { stableKey: "asc" } },
    });

    return assignments.map((assignment) =>
      this.toUserCapabilityAssignmentResponse(assignment),
    );
  }

  async getEffectiveCapabilities(
    userId: number,
    actor: { orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.getUserOrThrow(userId);
    this.assertCanReadUserCapabilities(user, actor);
    if (!user.orgId || !user.org?.isActive) {
      return { userId, orgId: user.orgId, capabilities: [] };
    }

    const entitlements = await this.entitlements.resolve({
      orgId: user.orgId,
      userId,
    });

    return {
      userId,
      orgId: user.orgId,
      capabilities: entitlements.paidCapabilities,
    };
  }

  async upsertCapabilityAssignment(
    userId: number,
    dto: UpsertUserCapabilityAssignmentDto,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
    correlationId?: string,
  ) {
    const user = await this.getUserOrThrow(userId);
    this.assertCanManageUserCapabilities(user, actor);
    if (!user.orgId)
      throw new ForbiddenException("User has no organization assigned");
    if (!user.org?.isActive)
      throw new ForbiddenException("Organization is inactive");

    const stableKey = dto.capabilityStableKey.trim();
    const capability = await this.prisma.capability.findUnique({
      where: { stableKey },
    });
    if (!capability || !capability.isActive)
      throw new NotFoundException("Capability not found");

    const orgCapabilities = await this.entitlements.resolveCapabilityKeys({
      orgId: user.orgId,
    });
    if (!orgCapabilities.has(capability.stableKey))
      throw new ForbiddenException(
        "Capability is not available to user organization",
      );

    const targetOrgId = user.orgId;
    const limits = this.sanitizeCapabilityLimits(dto.limits);
    const nextEnabled = dto.isEnabled ?? true;
    const previous = await this.prisma.userCapabilityAssignment.findUnique({
      where: { userId_capabilityId: { userId, capabilityId: capability.id } },
      include: { capability: true },
    });

    return this.prisma.$transaction(async (tx) => {
      const assignment = await tx.userCapabilityAssignment.upsert({
        where: { userId_capabilityId: { userId, capabilityId: capability.id } },
        create: {
          userId,
          capabilityId: capability.id,
          isEnabled: nextEnabled,
          limits: limits ?? Prisma.JsonNull,
          createdByUserId: actor.userId,
        },
        update: {
          isEnabled: nextEnabled,
          limits: limits ?? Prisma.JsonNull,
        },
        include: { capability: true, user: { select: { orgId: true } } },
      });

      await tx.organization.update({
        where: { id: targetOrgId },
        data: { tenantVersion: { increment: 1 } },
        select: { id: true },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: "user.capability_assignment.upserted",
          targetType: "user",
          targetId: userId,
          targetOrgId,
          correlationId,
          metadata: {
            capabilityId: capability.id,
            capabilityStableKey: capability.stableKey,
            previous: previous
              ? { isEnabled: previous.isEnabled, limits: previous.limits }
              : null,
            next: {
              isEnabled: assignment.isEnabled,
              limits: assignment.limits,
            },
          },
        },
        tx,
      );

      return this.toUserCapabilityAssignmentResponse(assignment);
    });
  }

  async updateUser(
    userId: number,
    data: { fullName?: string; email?: string; password?: string },
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException("Org scope required");
      if (user.orgId !== actor.orgId)
        throw new ForbiddenException("Cannot modify other org user");
      if (user.id === actor.userId)
        throw new ForbiddenException("You cannot modify yourself");
      if (user.createdByUserId !== actor.userId) {
        throw new ForbiddenException("You can only manage users you created");
      }
    }

    if (data.email && data.email !== user.email) {
      const existing = await this.prisma.user.findUnique({
        where: { email: data.email },
      });
      if (existing) throw new ConflictException("Email already exists");
    }

    const updateData: any = {};
    if (data.fullName) updateData.fullName = data.fullName;
    if (data.email) updateData.email = data.email;
    if (data.password)
      updateData.passwordHash = await bcrypt.hash(data.password, 10);

    await this.prisma.user.update({
      where: { id: userId },
      data: updateData,
    });

    return { ok: true };
  }

  async deleteUser(
    userId: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException("Org scope required");
      if (user.orgId !== actor.orgId)
        throw new ForbiddenException("Cannot delete other org user");
      if (user.id === actor.userId)
        throw new ForbiddenException("You cannot delete yourself");
      if (user.createdByUserId !== actor.userId) {
        throw new ForbiddenException("You can only manage users you created");
      }
    }

    await this.prisma.user.delete({ where: { id: userId } });
    return { ok: true };
  }

  private assertCanManageUserLock(
    user: { id: number; orgId: number | null; createdByUserId: number | null },
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    if (user.id === actor.userId)
      throw new ForbiddenException("You cannot lock yourself");

    if (!actor.isSuperAdmin) {
      if (!actor.orgId) throw new ForbiddenException("Org scope required");
      if (user.orgId !== actor.orgId)
        throw new ForbiddenException("Cannot modify other org user");
      if (user.createdByUserId !== actor.userId) {
        throw new ForbiddenException("You can only manage users you created");
      }
    }
  }

  async setLock(
    userId: number,
    locked: boolean,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");

    this.assertCanManageUserLock(user, actor);

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: userId },
        data: { isLocked: locked },
        select: { id: true, orgId: true, isLocked: true },
      });

      await this.audit.recordCritical(
        {
          actor,
          action: updated.isLocked ? "user.locked" : "user.unlocked",
          targetType: "user",
          targetId: updated.id,
          targetOrgId: updated.orgId,
          metadata: {
            previousStatus: user.isLocked ? "locked" : "unlocked",
            newStatus: updated.isLocked ? "locked" : "unlocked",
          },
        },
        tx,
      );

      return { ok: true, isLocked: updated.isLocked };
    });
  }

  async toggleLock(
    userId: number,
    actor: { userId: number; orgId: number | null; isSuperAdmin: boolean },
  ) {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (!user) throw new NotFoundException("User not found");
    return this.setLock(userId, !user.isLocked, actor);
  }
}
