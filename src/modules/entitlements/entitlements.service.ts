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
  hardwareModel?: string | null;
  hardwareProfile?: Prisma.JsonValue | null;
  hardwareCapabilities?: Prisma.JsonValue | null;
  enforceHardware?: boolean;
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

  private hasHardwareValue(
    hardwareProfile: Prisma.JsonValue | null | undefined,
    key: string,
    predicate: (value: unknown) => boolean,
  ) {
    if (
      !hardwareProfile ||
      typeof hardwareProfile !== "object" ||
      Array.isArray(hardwareProfile)
    )
      return false;
    return predicate((hardwareProfile as Record<string, unknown>)[key]);
  }

  private supportsRequiredHardware(
    requiredHardware: Prisma.JsonValue | null,
    hardware: {
      hardwareModel?: string | null;
      hardwareProfile?: Prisma.JsonValue | null;
      hardwareCapabilities?: Prisma.JsonValue | null;
    },
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
      if (!this.hasHardwareCapability(hardware.hardwareCapabilities, capability))
        return false;
    }

    const requiredModels = Array.isArray(policy.models) ? policy.models : [];
    if (requiredModels.length) {
      const hardwareModel =
        hardware.hardwareModel ||
        (this.hasHardwareValue(
          hardware.hardwareProfile,
          "model",
          (value) => typeof value === "string",
        )
          ? (hardware.hardwareProfile as Record<string, unknown>).model
          : null);
      if (
        typeof hardwareModel !== "string" ||
        !requiredModels.every((model) => typeof model === "string") ||
        !requiredModels.includes(hardwareModel)
      )
        return false;
    }

    if (policy.minAndroidApiLevel !== undefined) {
      const minAndroidApiLevel = Number(policy.minAndroidApiLevel);
      if (!Number.isFinite(minAndroidApiLevel)) return false;
      const supportsAndroidApi = this.hasHardwareValue(
        hardware.hardwareProfile,
        "androidApiLevel",
        (value) => typeof value === "number" && value >= minAndroidApiLevel,
      );
      if (!supportsAndroidApi) return false;
    }

    const requiredAbi = Array.isArray(policy.abi) ? policy.abi : [];
    if (requiredAbi.length) {
      const supportsAbi = this.hasHardwareValue(
        hardware.hardwareProfile,
        "abi",
        (value) =>
          typeof value === "string" &&
          requiredAbi.every((abi) => typeof abi === "string") &&
          requiredAbi.includes(value),
      );
      if (!supportsAbi) return false;
    }

    for (const [key, value] of Object.entries(policy)) {
      if (
        key === "capabilities" ||
        key === "models" ||
        key === "minAndroidApiLevel" ||
        key === "abi"
      )
        continue;
      if (
        typeof value === "boolean" &&
        value &&
        !this.hasHardwareCapability(hardware.hardwareCapabilities, key)
      )
        return false;
    }

    return true;
  }

  private applyHardwareFilter(
    capabilities: Map<string, ReturnType<EntitlementsService["toCapability"]>>,
    hardware: {
      hardwareModel?: string | null;
      hardwareProfile?: Prisma.JsonValue | null;
      hardwareCapabilities?: Prisma.JsonValue | null;
    },
  ) {
    const next = new Map<
      string,
      ReturnType<EntitlementsService["toCapability"]>
    >();
    for (const [stableKey, capability] of capabilities) {
      if (
        this.supportsRequiredHardware(
          capability.requiredHardware,
          hardware,
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

    // CMS-81: a robot with zero assignments inherits the org's effective
    // capabilities (open decision resolved: inherit by default).
    // A robot that *has* assignments (even disabled ones) is still subject to
    // the intersection so that explicit per-robot scoping is respected.
    const robotHasAssignments = robotAssignments.length > 0;
    let effective = input.robotId && robotHasAssignments
      ? this.intersects(capabilities, robotAssignments)
      : capabilities;
    effective = input.userId
      ? this.intersects(effective, userAssignments)
      : effective;
    if (input.enforceHardware) {
      effective = this.applyHardwareFilter(
        effective,
        {
          hardwareModel: input.hardwareModel,
          hardwareProfile: input.hardwareProfile,
          hardwareCapabilities: input.hardwareCapabilities,
        },
      );
    }

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
