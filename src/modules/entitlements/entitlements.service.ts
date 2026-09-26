import { Injectable } from "@nestjs/common";
import {
  CapabilityOverrideEffect,
  Prisma,
  SubscriptionStatus,
} from "@prisma/client";
import { PrismaService } from "../../prisma/prisma.service";

type CapabilityLike = {
  id: number;
  stableKey: string;
  name: string;
  description: string | null;
  category: string | null;
  version: number;
  requiredHardware: Prisma.JsonValue | null;
};

type AssignmentLike = {
  isEnabled: boolean;
  limits: Prisma.JsonValue | null;
  capability: CapabilityLike & { isActive: boolean };
};

type ResolveInput = {
  orgId: number;
  robotId?: number;
  userId?: number;
  hardwareCapabilities?: Prisma.JsonValue | null;
};

@Injectable()
export class EntitlementsService {
  constructor(private prisma: PrismaService) {}

  private toCapability(
    capability: CapabilityLike,
    limits: Prisma.JsonValue | null = null,
  ) {
    return {
      id: capability.id,
      stableKey: capability.stableKey,
      name: capability.name,
      description: capability.description,
      category: capability.category,
      version: capability.version,
      requiredHardware: capability.requiredHardware,
      limits,
    };
  }

  private capabilityMapFromAssignments(assignments: AssignmentLike[]) {
    const map = new Map<
      string,
      ReturnType<EntitlementsService["toCapability"]>
    >();
    for (const assignment of assignments) {
      if (!assignment.isEnabled || !assignment.capability.isActive) continue;
      map.set(
        assignment.capability.stableKey,
        this.toCapability(assignment.capability, assignment.limits),
      );
    }
    return map;
  }

  private intersects(
    base: Map<string, ReturnType<EntitlementsService["toCapability"]>>,
    assignments: AssignmentLike[],
  ) {
    const assignmentMap = this.capabilityMapFromAssignments(assignments);
    const next = new Map<
      string,
      ReturnType<EntitlementsService["toCapability"]>
    >();
    for (const [stableKey, assigned] of assignmentMap) {
      if (!base.has(stableKey)) continue;
      next.set(stableKey, { ...base.get(stableKey)!, limits: assigned.limits });
    }
    return next;
  }

  private hasHardwareCapability(
    hardwareCapabilities: Prisma.JsonValue | null | undefined,
    key: string,
  ) {
    if (
      !hardwareCapabilities ||
      typeof hardwareCapabilities !== "object" ||
      Array.isArray(hardwareCapabilities)
    )
      return false;
    return (hardwareCapabilities as Record<string, unknown>)[key] === true;
  }

  private supportsRequiredHardware(
    requiredHardware: Prisma.JsonValue | null,
    hardwareCapabilities: Prisma.JsonValue | null | undefined,
  ) {
    if (!requiredHardware) return true;
    if (typeof requiredHardware !== "object" || Array.isArray(requiredHardware))
      return true;

    const policy = requiredHardware as Record<string, unknown>;
    const requiredCapabilities = Array.isArray(policy.capabilities)
      ? policy.capabilities
      : [];
    for (const capability of requiredCapabilities) {
      if (typeof capability !== "string") return false;
      if (!this.hasHardwareCapability(hardwareCapabilities, capability))
        return false;
    }

    for (const [key, value] of Object.entries(policy)) {
      if (key === "capabilities") continue;
      if (
        typeof value === "boolean" &&
        value &&
        !this.hasHardwareCapability(hardwareCapabilities, key)
      )
        return false;
    }

    return true;
  }

  private applyHardwareFilter(
    capabilities: Map<string, ReturnType<EntitlementsService["toCapability"]>>,
    hardwareCapabilities: Prisma.JsonValue | null | undefined,
  ) {
    const next = new Map<
      string,
      ReturnType<EntitlementsService["toCapability"]>
    >();
    for (const [stableKey, capability] of capabilities) {
      if (
        this.supportsRequiredHardware(
          capability.requiredHardware,
          hardwareCapabilities,
        )
      ) {
        next.set(stableKey, capability);
      }
    }
    return next;
  }

  async resolve(input: ResolveInput) {
    const [subscription, overrides, robotAssignments, userAssignments] =
      await Promise.all([
        this.prisma.organizationSubscription.findFirst({
          where: { orgId: input.orgId },
          orderBy: { updatedAt: "desc" },
          include: {
            plan: {
              include: {
                capabilities: {
                  include: { capability: true },
                  orderBy: { capability: { stableKey: "asc" as const } },
                },
              },
            },
          },
        }),
        this.prisma.organizationCapabilityOverride.findMany({
          where: { orgId: input.orgId },
          include: { capability: true },
          orderBy: { capability: { stableKey: "asc" as const } },
        }),
        input.robotId
          ? this.prisma.robotCapabilityAssignment.findMany({
              where: { robotId: input.robotId },
              include: { capability: true },
              orderBy: { capability: { stableKey: "asc" as const } },
            })
          : Promise.resolve([]),
        input.userId
          ? this.prisma.userCapabilityAssignment.findMany({
              where: { userId: input.userId },
              include: { capability: true },
              orderBy: { capability: { stableKey: "asc" as const } },
            })
          : Promise.resolve([]),
      ]);

    const capabilities = new Map<
      string,
      ReturnType<EntitlementsService["toCapability"]>
    >();
    const now = new Date();
    let subscriptionSummary: Record<string, unknown> = {
      status: "NONE",
      planStableKey: null,
      validFrom: null,
      validUntil: null,
    };

    if (subscription) {
      const isCurrent =
        subscription.status === SubscriptionStatus.ACTIVE &&
        subscription.plan.isActive &&
        subscription.validFrom <= now &&
        subscription.validUntil >= now;
      const status =
        !subscription.plan.isActive ||
        subscription.status !== SubscriptionStatus.ACTIVE
          ? "INACTIVE"
          : subscription.validUntil < now
            ? "EXPIRED"
            : subscription.validFrom > now
              ? "NOT_YET_ACTIVE"
              : "ACTIVE";

      subscriptionSummary = {
        status,
        planId: subscription.planId,
        planStableKey: subscription.plan.stableKey,
        planVersion: subscription.plan.version,
        validFrom: subscription.validFrom,
        validUntil: subscription.validUntil,
      };

      if (isCurrent) {
        for (const row of subscription.plan.capabilities) {
          if (row.capability.isActive)
            capabilities.set(
              row.capability.stableKey,
              this.toCapability(row.capability),
            );
        }
      }
    }

    for (const override of overrides) {
      if (!override.capability.isActive) continue;
      if (override.effect === CapabilityOverrideEffect.DENY)
        capabilities.delete(override.capability.stableKey);
      if (override.effect === CapabilityOverrideEffect.ALLOW)
        capabilities.set(
          override.capability.stableKey,
          this.toCapability(override.capability),
        );
    }

    let effective = input.robotId
      ? this.intersects(capabilities, robotAssignments)
      : capabilities;
    effective = input.userId
      ? this.intersects(effective, userAssignments)
      : effective;
    effective = this.applyHardwareFilter(effective, input.hardwareCapabilities);

    const paidCapabilities = Array.from(effective.values()).sort((a, b) =>
      a.stableKey.localeCompare(b.stableKey),
    );

    return {
      subscription: subscriptionSummary,
      paidCapabilities,
    };
  }

  async resolveCapabilityKeys(input: ResolveInput) {
    const entitlements = await this.resolve(input);
    return new Set(
      entitlements.paidCapabilities.map((capability) => capability.stableKey),
    );
  }
}
