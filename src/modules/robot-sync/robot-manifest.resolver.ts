import { Injectable } from "@nestjs/common";
import { LicenseStatus, Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { EntitlementsService } from "../entitlements/entitlements.service";

type OrgContext = {
  id: number;
  name: string;
  logoUrl: string | null;
  primaryColor: string | null;
  secondaryColor: string | null;
  tenantVersion: number;
};

type RobotContext = {
  id: number;
  orgId: number;
  validFrom: Date;
  validUntil: Date;
  appVersion: string | null;
  deviceMetadata: Prisma.JsonValue | null;
  hardwareCapabilities: Prisma.JsonValue | null;
  org: OrgContext;
};

type ManifestApprovedContext = {
  context: {
    companyOverview: string | null;
    operatingHours: string | null;
    locationDetails: string | null;
    visitorGuidelines: string | null;
    eventsSummary: string | null;
    version: number;
  } | null;
  approvedQa: Array<{
    id: number;
    question: string;
    answer: string;
    category: string | null;
    version: number;
    sortOrder: number;
  }>;
};

type ManifestConversationPolicy = {
  defaultLanguage: string;
  supportedLanguages: string[];
  speechSpeed: number;
  sessionMaxSeconds: number;
  sessionIdleTimeoutSeconds: number;
  cooldownSeconds: number;
  dailySessionLimit: number;
  version: number;
};

type ManifestInput = {
  robot: RobotContext;
  licenseStatus: LicenseStatus;
  locked: boolean;
  reason?: string;
  appVersionCode?: number | null;
  myCourses?: unknown[];
  publicCatalog?: unknown[];
  syncedAt?: string;
  approvedContext?: ManifestApprovedContext;
  policy?: ManifestConversationPolicy;
};

const APP_UPDATE_POLICY = {
  minimumSupportedVersionName: "0.1.0",
  minimumSupportedVersionCode: 1,
  recommendedVersionName: "0.1.0",
  recommendedVersionCode: 1,
};

@Injectable()
export class RobotManifestResolver {
  constructor(private entitlements: EntitlementsService) {}

  private stableStringify(value: unknown): string {
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) {
      return `[${value.map((item) => this.stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
      const record = value as Record<string, unknown>;
      return `{${Object.keys(record)
        .sort()
        .map(
          (key) =>
            `${JSON.stringify(key)}:${this.stableStringify(record[key])}`,
        )
        .join(",")}}`;
    }
    return JSON.stringify(value);
  }

  private manifestHash(value: unknown) {
    return createHash("sha256")
      .update(this.stableStringify(value))
      .digest("hex");
  }

  private toTenant(org: OrgContext) {
    return {
      orgId: org.id,
      orgName: org.name,
      displayName: org.name,
      logoUrl: org.logoUrl,
      primaryColor: org.primaryColor,
      secondaryColor: org.secondaryColor,
      tenantVersion: org.tenantVersion,
      cacheVersion: `org-${org.id}-v${org.tenantVersion}`,
    };
  }

  private getStoredAppVersionCode(deviceMetadata: Prisma.JsonValue | null) {
    if (
      !deviceMetadata ||
      typeof deviceMetadata !== "object" ||
      Array.isArray(deviceMetadata)
    ) {
      return null;
    }

    const value = (deviceMetadata as Record<string, unknown>).appVersionCode;
    return typeof value === "number" && Number.isInteger(value) ? value : null;
  }

  private buildAppUpdatePolicy(appVersionCode: number | null | undefined) {
    const currentVersionCode = appVersionCode ?? null;
    const updateRequired =
      currentVersionCode !== null &&
      currentVersionCode < APP_UPDATE_POLICY.minimumSupportedVersionCode;
    const updateRecommended =
      currentVersionCode !== null &&
      currentVersionCode < APP_UPDATE_POLICY.recommendedVersionCode;

    return {
      ...APP_UPDATE_POLICY,
      currentVersionCode,
      updateRequired,
      updateRecommended,
    };
  }

  private buildManifest(input: {
    robotId: number;
    tenant: ReturnType<RobotManifestResolver["toTenant"]>;
    locked: boolean;
    reason?: string;
    license: {
      status: LicenseStatus;
      validFrom: Date;
      validUntil: Date;
    };
    entitlements: { subscription: unknown; paidCapabilities: unknown[] };
    myCourses?: unknown[];
    publicCatalog?: unknown[];
    syncedAt?: string;
    appVersionCode?: number | null;
    approvedContext?: ManifestApprovedContext;
    policy?: ManifestConversationPolicy;
  }) {
    const myCourses = input.myCourses ?? [];
    const publicCatalog = input.publicCatalog ?? [];
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    const contentVersions = {
      cacheVersion: input.tenant.cacheVersion,
      tenantVersion: input.tenant.tenantVersion,
      myCoursesVersion: `my-courses-org-${input.tenant.orgId}-v${input.tenant.tenantVersion}-${this.manifestHash(myCourses).slice(0, 12)}`,
      publicCatalogVersion: `public-catalog-v1-${publicCatalog.length}`,
      myCoursesCount: myCourses.length,
      publicCatalogCount: publicCatalog.length,
    };
    const policies = {
      schemaVersion: 1,
      offlineCache: {
        enabled: true,
        scope: "tenant",
        cacheVersion: input.tenant.cacheVersion,
      },
      sync: {
        fullSyncRequired: false,
        retryAfterSeconds: 30,
      },
      appUpdate: this.buildAppUpdatePolicy(input.appVersionCode),
    };
    const capabilities = {
      schemaVersion: 1,
      effective: input.entitlements.paidCapabilities,
      resolver: "cms-entitlements-v1",
    };
    const conversation = {
      policy: input.policy ?? {
        defaultLanguage: "en-US",
        supportedLanguages: ["en-US"],
        speechSpeed: 1.0,
        sessionMaxSeconds: 300,
        sessionIdleTimeoutSeconds: 60,
        cooldownSeconds: 5,
        dailySessionLimit: 1000,
        version: 1,
      },
      approvedContext: {
        context: input.approvedContext?.context ?? null,
        approvedQa: input.approvedContext?.approvedQa ?? [],
      },
    };

    const hashSource = {
      schemaVersion: 1,
      manifestVersion: "1.0.0",
      locked: input.locked,
      reason: input.reason ?? null,
      tenant: input.tenant,
      license: input.license,
      capabilities,
      policies,
      contentVersions,
      myCourses,
      publicCatalog,
      conversation,
    };
    const manifestHash = this.manifestHash(hashSource);
    const configVersion = `manifest-${manifestHash.slice(0, 16)}`;

    return {
      schemaVersion: 1,
      manifestVersion: "1.0.0",
      locked: input.locked,
      ...(input.reason ? { reason: input.reason } : {}),
      tenant: input.tenant,
      license: input.license,
      capabilities,
      policies,
      contentVersions,
      conversation,
      sync: {
        serverTime: syncedAt,
        syncedAt,
        idempotencyKey: `robot-${input.robotId}-org-${input.tenant.orgId}-${input.tenant.cacheVersion}`,
        configVersion,
        manifestHash,
      },
      organization: input.tenant,
      entitlements: input.entitlements,
      myCourses,
      publicCatalog,
      syncedAt,
    };
  }

  async resolve(input: ManifestInput) {
    const tenant = this.toTenant(input.robot.org);
    const entitlements = input.locked
      ? {
          subscription: {
            status: input.licenseStatus,
            planStableKey: null,
            validFrom: null,
            validUntil: null,
          },
          paidCapabilities: [],
        }
      : await this.entitlements.resolve({
          orgId: input.robot.orgId,
          robotId: input.robot.id,
          hardwareCapabilities: input.robot.hardwareCapabilities,
          enforceHardware: true,
        });

    return this.buildManifest({
      robotId: input.robot.id,
      tenant,
      locked: input.locked,
      reason: input.reason,
      license: {
        status: input.licenseStatus,
        validFrom: input.robot.validFrom,
        validUntil: input.robot.validUntil,
      },
      entitlements,
      myCourses: input.myCourses,
      publicCatalog: input.publicCatalog,
      syncedAt: input.syncedAt,
      appVersionCode:
        input.appVersionCode ?? this.getStoredAppVersionCode(input.robot.deviceMetadata),
      approvedContext: input.approvedContext,
      policy: input.policy,
    });
  }
}
