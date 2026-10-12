import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LicenseStatus, Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { ConversationConfigService } from "../conversation-config/conversation-config.service";
import { safeAiProviderReference } from "../ai-gateway/ai-provider-reference";
import { IdentityService } from "../identity/identity.service";

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

type ManifestInput = {
  robot: RobotContext;
  licenseStatus: LicenseStatus;
  locked: boolean;
  reason?: string;
  appVersionCode?: number | null;
  myCourses?: unknown[];
  publicCatalog?: unknown[];
  identityGalleryRecords?: unknown[];
  identityGallerySummary?: { version: string; count: number };
  syncedAt?: string;
};

const APP_UPDATE_POLICY = {
  minimumSupportedVersionName: "0.1.0",
  minimumSupportedVersionCode: 1,
  recommendedVersionName: "0.1.0",
  recommendedVersionCode: 1,
};

const DEFAULT_CONVERSATION_CONFIG = {
  schemaVersion: 1,
  source: "systemDefault",
  version: {
    organization: 0,
    robot: 0,
    effective: "conversation-system-v0",
  },
  publishedAt: null,
  personaName: "WhizRobot Assistant",
  personaPrompt:
    "Use only approved CMS context and registered tools. Do not reveal private data or backend configuration.",
  greetingText: "Hello, I am your WhizRobot assistant.",
  voiceStyle: "friendly",
  language: "en",
  tone: "helpful",
  policies: {
    schemaVersion: 1,
    language: {
      default: "en",
      supported: ["en"],
    },
    speech: {
      speed: 1,
    },
    session: {
      maxSeconds: 600,
      idleTimeoutSeconds: 120,
      dailyLimit: 50,
    },
    cooldown: {
      seconds: 5,
    },
  },
  approvedContext: {
    schemaVersion: 1,
    version: {
      context: 0,
      qa: 0,
      effective: "approved-context-v0-qa-v0",
    },
    contexts: [],
    approvedQa: [],
  },
};

@Injectable()
export class RobotManifestResolver {
  constructor(
    private entitlements: EntitlementsService,
    private conversationConfig?: ConversationConfigService,
    private config?: ConfigService,
    private identity?: IdentityService,
  ) {}

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
    identityGalleryRecords?: unknown[];
    identityGallerySummary?: { version: string; count: number };
    syncedAt?: string;
    appVersionCode?: number | null;
    conversation?: unknown;
    identity?: unknown;
  }) {
    const myCourses = input.myCourses ?? [];
    const publicCatalog = input.publicCatalog ?? [];
    const identityGalleryRecords = input.identityGalleryRecords ?? [];
    const syncedAt = input.syncedAt ?? new Date().toISOString();
    const galleryVersion =
      input.identityGallerySummary?.version ??
      `identity-gallery-org-${input.tenant.orgId}-${this.manifestHash(identityGalleryRecords).slice(0, 12)}`;
    const galleryCount =
      input.identityGallerySummary?.count ?? identityGalleryRecords.length;
    const identityGallery = {
      schemaVersion: 1,
      orgId: input.tenant.orgId,
      version: galleryVersion,
      count: galleryCount,
    };
    const contentVersions = {
      cacheVersion: input.tenant.cacheVersion,
      tenantVersion: input.tenant.tenantVersion,
      myCoursesVersion: `my-courses-org-${input.tenant.orgId}-v${input.tenant.tenantVersion}-${this.manifestHash(myCourses).slice(0, 12)}`,
      publicCatalogVersion: `public-catalog-v1-${publicCatalog.length}`,
      identityGalleryVersion: identityGallery.version,
      myCoursesCount: myCourses.length,
      publicCatalogCount: publicCatalog.length,
      identityGalleryCount: galleryCount,
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
      conversation: input.conversation,
    };
    const identity = {
      ...(input.identity ?? {
        enabled: false,
        tier: "standard",
        models: [],
        thresholds: {},
        galleryPollSeconds: 60,
      }),
      galleryVersion: identityGallery.version,
    };
    const capabilities = {
      schemaVersion: 1,
      effective: input.entitlements.paidCapabilities,
      resolver: "cms-entitlements-v1",
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
      conversation: input.conversation,
      identityGallery,
      identity,
      myCourses,
      publicCatalog,
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
      conversation: input.conversation,
      identity,
      identityGallery,
      contentVersions,
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
    const resolvedConversation = this.conversationConfig
      ? await this.conversationConfig.resolveForRobot(input.robot.id)
      : {
          ...DEFAULT_CONVERSATION_CONFIG,
          orgId: input.robot.orgId,
          robotId: input.robot.id,
        };
    const conversation = {
      ...resolvedConversation,
      provider: safeAiProviderReference(this.config),
    };
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
    const capabilityKeys = new Set(
      (entitlements.paidCapabilities ?? [])
        .map((capability: any) =>
          typeof capability === "string" ? capability : capability?.stableKey,
        )
        .filter(Boolean),
    );
    const identityGallerySummary =
      input.identityGallerySummary ??
      (input.locked || !this.identity
        ? undefined
        : await this.identity.getAuthorizedGallerySummaryForOrg(input.robot.orgId));
    const identity =
      input.locked || !this.identity
        ? undefined
        : await this.resolveIdentityPolicy(
            input.robot.orgId,
            input.robot.id,
            capabilityKeys,
          );

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
      identityGalleryRecords: input.identityGalleryRecords,
      identityGallerySummary,
      syncedAt: input.syncedAt,
      conversation,
      identity,
      appVersionCode:
        input.appVersionCode ?? this.getStoredAppVersionCode(input.robot.deviceMetadata),
    });
  }

  private async resolveIdentityPolicy(
    orgId: number,
    robotId: number,
    capabilityKeys: Set<string>,
  ) {
    try {
      return await this.identity?.resolveRecognitionPolicy(orgId, robotId, capabilityKeys);
    } catch {
      return {
        enabled: capabilityKeys.has("identity.recognition"),
        tier: "standard",
        models: [
          {
            modelId: "face-std-sface-int8-v1",
            tier: "standard",
            version: "1.0.0",
            sha256:
              "1111111111111111111111111111111111111111111111111111111111111111",
            url: "/api/v1/robot/identity/models/face-std-sface-int8-v1",
          },
        ],
        thresholds: {
          "face-std-sface-int8-v1": {
            accept: 0.363,
            margin: 0.08,
            reject: 0.25,
            votes: 3,
          },
        },
        galleryPollSeconds: 60,
      };
    }
  }
}
