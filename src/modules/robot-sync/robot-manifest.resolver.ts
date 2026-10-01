import { Injectable } from "@nestjs/common";
import { LicenseStatus, Prisma } from "@prisma/client";
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
  hardwareCapabilities: Prisma.JsonValue | null;
  org: OrgContext;
};

type ManifestInput = {
  robot: RobotContext;
  licenseStatus: LicenseStatus;
  locked: boolean;
  reason?: string;
  myCourses?: unknown[];
  publicCatalog?: unknown[];
  syncedAt?: string;
};

@Injectable()
export class RobotManifestResolver {
  constructor(private entitlements: EntitlementsService) {}

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
  }) {
    const myCourses = input.myCourses ?? [];
    const publicCatalog = input.publicCatalog ?? [];
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    const contentVersions = {
      cacheVersion: input.tenant.cacheVersion,
      tenantVersion: input.tenant.tenantVersion,
      myCoursesVersion: `my-courses-org-${input.tenant.orgId}-v${input.tenant.tenantVersion}-${myCourses.length}`,
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
    };
    const capabilities = {
      schemaVersion: 1,
      effective: input.entitlements.paidCapabilities,
      resolver: "cms-entitlements-v1",
    };

    return {
      manifestVersion: "1.0.0",
      locked: input.locked,
      ...(input.reason ? { reason: input.reason } : {}),
      tenant: input.tenant,
      license: input.license,
      capabilities,
      policies,
      contentVersions,
      sync: {
        serverTime: syncedAt,
        syncedAt,
        idempotencyKey: `robot-${input.robotId}-org-${input.tenant.orgId}-${input.tenant.cacheVersion}`,
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
    });
  }
}
