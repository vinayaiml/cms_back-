import { ForbiddenException, Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { DashboardSection } from "@prisma/client";

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService) {}

  private subscriptionPlansSection(): DashboardSection {
    return {
      id: -2,
      key: "subscription-plans",
      label: "Plans",
      path: "/subscription-plans",
      icon: "layers",
      sortOrder: 16,
      requiredPermission: "subscription.read",
      isSuperAdminOnly: false,
      isActive: true,
      templateType: "NONE",
      templateConfig: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  private capabilityAssignmentsSection(): DashboardSection {
    return {
      id: -3,
      key: "capability-assignments",
      label: "Capability Access",
      path: "/capability-assignments",
      icon: "sliders",
      sortOrder: 17,
      requiredPermission: "subscription.manage",
      isSuperAdminOnly: false,
      isActive: true,
      templateType: "NONE",
      templateConfig: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
  }

  async getUserPermissionKeys(userId: number): Promise<Set<string>> {
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

    if (!user) throw new ForbiddenException("User not found");
    if (!user.orgId) return new Set();

    const orgPermissions = await this.prisma.orgPermission.findMany({
      where: { orgId: user.orgId },
      include: { permission: true },
    });
    const orgAllowedKeys = new Set(
      orgPermissions.map((row) => row.permission.key),
    );

    const permKeys = new Set<string>();
    for (const up of user.directPermissions) {
      if (orgAllowedKeys.has(up.permission.key))
        permKeys.add(up.permission.key);
    }
    for (const ur of user.roles) {
      for (const rp of ur.role.permissions) {
        if (orgAllowedKeys.has(rp.permission.key))
          permKeys.add(rp.permission.key);
      }
    }

    return permKeys;
  }

  async getNavigation(actor: {
    userId: number;
    isSuperAdmin: boolean;
    orgId: number | null;
  }) {
    if (actor.isSuperAdmin) {
      const orgCount = await this.prisma.organization.count();

      // Super admin sees active sections except tenant user-management page.
      const sections = await this.prisma.dashboardSection.findMany({
        where: { isActive: true, key: { notIn: ["users", "roles"] } },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });

      // Hard fallback: keep Organizations visible for super admin even if
      // dashboard section config was edited/deleted.
      if (!sections.some((s) => s.key === "organizations")) {
        sections.push({
          id: -1,
          key: "organizations",
          label: "Organizations",
          path: "/organizations",
          icon: "building",
          sortOrder: 2,
          requiredPermission: "org.read",
          isSuperAdminOnly: true,
          isActive: true,
          templateType: "NONE",
          templateConfig: null,
          createdAt: new Date(0),
          updatedAt: new Date(0),
        });
      }

      if (!sections.some((s) => s.key === "subscription-plans")) {
        sections.push(this.subscriptionPlansSection());
      }
      if (!sections.some((s) => s.key === "capability-assignments")) {
        sections.push(this.capabilityAssignmentsSection());
      }

      const sorted = sections.sort(
        (a, b) => a.sortOrder - b.sortOrder || a.id - b.id,
      );

      // If no organizations exist yet, force setup flow first.
      if (orgCount === 0) {
        return sorted.filter((s) => s.key === "organizations");
      }

      return sorted;
    }

    if (!actor.orgId) throw new ForbiddenException("Org scope required");

    const permKeys = await this.getUserPermissionKeys(actor.userId);

    const sections: DashboardSection[] =
      await this.prisma.dashboardSection.findMany({
        where: { isActive: true, isSuperAdminOnly: false },
        orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      });

    if (
      permKeys.has("subscription.read") &&
      !sections.some((s) => s.key === "subscription-plans")
    ) {
      sections.push(this.subscriptionPlansSection());
    }
    if (
      permKeys.has("subscription.manage") &&
      !sections.some((s) => s.key === "capability-assignments")
    ) {
      sections.push(this.capabilityAssignmentsSection());
    }

    return sections.filter(
      (s: DashboardSection) =>
        !s.requiredPermission || permKeys.has(s.requiredPermission),
    );
  }

  async getMe(actor: {
    userId: number;
    isSuperAdmin: boolean;
    orgId: number | null;
  }) {
    const user = await this.prisma.user.findUnique({
      where: { id: actor.userId },
      select: {
        id: true,
        email: true,
        fullName: true,
        orgId: true,
        isSuperAdmin: true,
        createdAt: true,
      },
    });

    if (!user) throw new ForbiddenException("User not found");

    const permissions = actor.isSuperAdmin
      ? ["superadmin.*"]
      : Array.from(await this.getUserPermissionKeys(actor.userId));

    return { user, permissions };
  }
}
