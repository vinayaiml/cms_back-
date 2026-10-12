import { BadRequestException } from "@nestjs/common";
import {
  CapabilityOverrideEffect,
  CourseAccessType,
  LicenseStatus,
  SubscriptionStatus,
} from "@prisma/client";
import { DomainLockedException } from "../../common/errors/domain-locked.exception";
import { PrismaService } from "../../prisma/prisma.service";
import { RobotSyncService } from "./robot-sync.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { RobotManifestResolver } from "./robot-manifest.resolver";
import { ContentDeliveryService } from "../content-delivery/content-delivery.service";
import { IdentityService } from "../identity/identity.service";

function buildRobot(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    orgId: 1,
    serialNumber: "TEST-ACTIVE-001",
    name: "Test Robot",
    licenseKey: "WHRB900001",
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date("2099-01-01T00:00:00.000Z"),
    licenseStatus: LicenseStatus.ACTIVE,
    revokedAt: null,
    appVersion: null,
    deviceModel: null,
    deviceMetadata: null,
    hardwareModel: null,
    hardwareProfile: null,
    hardwareCapabilities: null,
    lastSeenAt: null,
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    org: {
      id: 1,
      name: "Demo School",
      isActive: true,
      logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
      primaryColor: "#1D4ED8",
      secondaryColor: "#F97316",
      tenantVersion: 1,
    },
    ...overrides,
  };
}

function buildManifestCourse(id: number, name = `Course ${id}`) {
  return {
    id,
    courseCode: `COURSE-${id}`,
    courseName: name,
    source: "PLATFORM",
    visibility: "PRIVATE",
    levels: [
      {
        id: id * 10,
        name: "Level 1",
        sequence: 1,
        chapters: [
          {
            id: id * 100,
            name: "Chapter 1",
            sequence: 1,
            lessons: [
              {
                id: id * 1000,
                name: "Lesson 1",
                sequence: 1,
                contentUrl: `https://cdn.whizrobo.test/course-${id}.mp4`,
              },
            ],
          },
        ],
        lessons: [],
      },
    ],
  };
}

describe("RobotSyncService heartbeat updates", () => {
  const prisma = {
    robot: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    event: {
      create: jest.fn(),
    },
    course: {
      findMany: jest.fn(),
    },
    orgCourseAccess: {
      findMany: jest.fn(),
    },
    organizationSubscription: {
      findFirst: jest.fn(),
    },
    organizationCapabilityOverride: {
      findMany: jest.fn(),
    },
    robotCapabilityAssignment: {
      findMany: jest.fn(),
    },
    robotCourseAccess: {
      findMany: jest.fn(),
    },
    userCapabilityAssignment: {
      findMany: jest.fn(),
    },
    identityEmbeddingRecord: {
      findMany: jest.fn(),
    },
    identityTemplate: {
      findMany: jest.fn(),
    },
  };

  let service: RobotSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LICENSE_SECRET_KEY =
      "robot-sync-test-license-secret-key-32chars";
    prisma.identityTemplate.findMany.mockResolvedValue([]);
    const entitlements = new EntitlementsService(
      prisma as unknown as PrismaService,
    );
    const conversationConfig = {
      resolveForRobot: jest.fn().mockResolvedValue({
        schemaVersion: 1,
        source: "organizationDefault",
        orgId: 1,
        robotId: 10,
        personaName: "Demo Guide",
        personaPrompt: "Use approved CMS context only.",
        greetingText: "Welcome to Demo School.",
        voiceStyle: "friendly",
        language: "en",
        tone: "helpful",
        version: {
          organization: 1,
          robot: 0,
          effective: "conversation-org-1-v1-robot-10-v0",
        },
        publishedAt: "2026-10-07T00:00:00.000Z",
      }),
    };
    service = new RobotSyncService(
      prisma as unknown as PrismaService,
      new RobotManifestResolver(entitlements, conversationConfig as any),
      new ContentDeliveryService(prisma as unknown as PrismaService),
    );
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});
    prisma.course.findMany.mockResolvedValue([]);
    prisma.orgCourseAccess.findMany.mockResolvedValue([]);
    prisma.organizationSubscription.findFirst.mockResolvedValue(null);
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([]);
    prisma.robotCourseAccess.findMany.mockResolvedValue([]);
    prisma.userCapabilityAssignment.findMany.mockResolvedValue([]);
    prisma.identityEmbeddingRecord.findMany.mockResolvedValue([]);
  });

  it("updates last seen, app version and device model for the authenticated robot during sync", async () => {
    await service.sync(10, {
      appVersion: "0.1.0",
      deviceModel: "Mini ELF",
    });

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      include: {
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            logoUrl: true,
            primaryColor: true,
            secondaryColor: true,
            tenantVersion: true,
          },
        },
      },
    });
    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
        appVersion: "0.1.0",
        deviceModel: "Mini ELF",
      },
    });
  });

  it("keeps sync idempotent by only touching the same robot heartbeat row", async () => {
    await service.sync(10);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
      },
    });
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it("returns a stable manifest hash for unchanged configuration", async () => {
    const first = await service.sync(10);
    const second = await service.sync(10);

    expect((first as any).sync.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect((second as any).sync.manifestHash).toBe(
      (first as any).sync.manifestHash,
    );
    expect((second as any).sync.configVersion).toBe(
      (first as any).sync.configVersion,
    );
  });

  it("syncs only the authenticated robot organization identity gallery", async () => {
    const identity = new IdentityService(prisma as any, { recordCritical: jest.fn() } as any);
    service = new RobotSyncService(
      prisma as unknown as PrismaService,
      new RobotManifestResolver(
        new EntitlementsService(prisma as unknown as PrismaService),
        undefined,
        undefined,
        identity,
      ),
      new ContentDeliveryService(prisma as unknown as PrismaService),
    );
    prisma.identityEmbeddingRecord.findMany.mockResolvedValue([
      {
        id: 1,
        orgId: 1,
        subjectRef: "visitor.demo-001",
        consentGranted: true,
        status: "ACTIVE",
        consentPolicyVersion: "identity-v1",
        consentGrantedAt: new Date("2026-10-09T00:00:00.000Z"),
        embeddingFingerprint: "abc123",
        embeddingSchemaVersion: 1,
        retentionExpiresAt: null,
        deletedAt: null,
        updatedAt: new Date("2026-10-09T01:00:00.000Z"),
      },
    ]);

    const result = (await service.sync(10)) as any;

    expect(prisma.identityEmbeddingRecord.findMany).toHaveBeenCalledWith({
      where: {
        orgId: 1,
      },
      orderBy: [{ updatedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        subjectRef: true,
        consentGranted: true,
        status: true,
        embeddingFingerprint: true,
        retentionExpiresAt: true,
        deletedAt: true,
        updatedAt: true,
      },
    });
    expect(result.identityGallery).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        orgId: 1,
        count: 1,
      }),
    );
    expect(result.contentVersions.identityGalleryVersion).toMatch(
      /^identity-gallery-org-1-[0-9a-f]{24}$/,
    );
    expect(JSON.stringify(result.identityGallery)).not.toMatch(
      /embeddingCiphertext|licenseKey|WHRB|Bearer|@/,
    );
  });

  it("excludes revoked identities from subsequent sync and updates identityGalleryVersion", async () => {
    const identity = new IdentityService(prisma as any, { recordCritical: jest.fn() } as any);
    service = new RobotSyncService(
      prisma as unknown as PrismaService,
      new RobotManifestResolver(
        new EntitlementsService(prisma as unknown as PrismaService),
        undefined,
        undefined,
        identity,
      ),
      new ContentDeliveryService(prisma as unknown as PrismaService),
    );
    // Initial sync with active consented identity
    prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([
      {
        id: 1,
        orgId: 1,
        subjectRef: "visitor.demo-001",
        consentGranted: true,
        status: "ACTIVE",
        consentPolicyVersion: "identity-v1",
        consentGrantedAt: new Date("2026-10-09T00:00:00.000Z"),
        embeddingFingerprint: "abc123",
        embeddingSchemaVersion: 1,
        retentionExpiresAt: null,
        deletedAt: null,
        updatedAt: new Date("2026-10-09T01:00:00.000Z"),
      },
    ]);

    const initialResult = (await service.sync(10)) as any;
    expect(initialResult.identityGallery.count).toBe(1);
    const initialVersion = initialResult.contentVersions.identityGalleryVersion;

    // Subsequent sync after consent revocation (query excludes revoked record)
    prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([]);

    const subsequentResult = (await service.sync(10)) as any;
    expect(subsequentResult.identityGallery.count).toBe(0);
    expect(subsequentResult.identityGallery.records).toBeUndefined();
    expect(subsequentResult.contentVersions.identityGalleryVersion).not.toBe(initialVersion);
  });

  it("returns identity gallery as an incremental change when the gallery version differs", async () => {
    const identity = new IdentityService(prisma as any, { recordCritical: jest.fn() } as any);
    service = new RobotSyncService(
      prisma as unknown as PrismaService,
      new RobotManifestResolver(
        new EntitlementsService(prisma as unknown as PrismaService),
        undefined,
        undefined,
        identity,
      ),
      new ContentDeliveryService(prisma as unknown as PrismaService),
    );
    prisma.identityEmbeddingRecord.findMany.mockResolvedValue([
      {
        id: 1,
        orgId: 1,
        subjectRef: "visitor.demo-001",
        consentGranted: true,
        status: "ACTIVE",
        consentPolicyVersion: "identity-v1",
        consentGrantedAt: new Date("2026-10-09T00:00:00.000Z"),
        embeddingFingerprint: "abc123",
        embeddingSchemaVersion: 1,
        retentionExpiresAt: null,
        deletedAt: null,
        updatedAt: new Date("2026-10-09T01:00:00.000Z"),
      },
    ]);

    const result = (await service.syncChanges(10, {
      manifestHash: "0".repeat(64),
      cacheVersion: "org-1-v1",
      tenantVersion: 1,
      myCoursesVersion: "my-courses-org-1-v1-e3b0c44298fc",
      publicCatalogVersion: "public-catalog-v1-0",
      identityGalleryVersion: "identity-gallery-org-1-old",
    })) as any;

    expect(result.requiresFullSync).toBe(false);
    expect(result.changed.identityGallery).toEqual(
      expect.objectContaining({
        orgId: 1,
        count: 1,
      }),
    );
  });

  it("asks for a full sync when incremental client versions are missing", async () => {
    const result = await service.syncChanges(10, {});

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        manifestVersion: "1.0.0",
        requiresFullSync: true,
        fullSyncReason: "MISSING_OR_UNSUPPORTED_CLIENT_VERSIONS",
        changed: {},
        currentManifestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        currentConfigVersion: expect.stringMatching(/^manifest-[0-9a-f]{16}$/),
      }),
    );
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("asks for a full sync when identity gallery version is missing", async () => {
    const full = (await service.sync(10)) as any;

    const result = await service.syncChanges(10, {
      manifestHash: full.sync.manifestHash,
      cacheVersion: full.contentVersions.cacheVersion,
      tenantVersion: full.contentVersions.tenantVersion,
      myCoursesVersion: full.contentVersions.myCoursesVersion,
      publicCatalogVersion: full.contentVersions.publicCatalogVersion,
    });

    expect(result).toEqual(
      expect.objectContaining({
        requiresFullSync: true,
        fullSyncReason: "MISSING_OR_UNSUPPORTED_CLIENT_VERSIONS",
        changed: {},
      }),
    );
  });

  it("returns only changed manifest sections when incremental versions are stale", async () => {
    const publicCourse = {
      id: 201,
      courseCode: "PUBLIC-INTRO",
      courseName: "Public Intro",
      description: "Intro preview",
      courseImageUrl: null,
      logoUrl: null,
      introLevel: { id: 301, name: "Intro", chapters: [], lessons: [] },
    };
    prisma.course.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([publicCourse]);

    const full = (await service.sync(10)) as any;
    prisma.course.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([publicCourse]);

    const result = await service.syncChanges(10, {
      manifestHash: "0".repeat(64),
      cacheVersion: full.contentVersions.cacheVersion,
      tenantVersion: full.contentVersions.tenantVersion,
      myCoursesVersion: full.contentVersions.myCoursesVersion,
      publicCatalogVersion: "public-catalog-v1-stale",
      identityGalleryVersion: full.contentVersions.identityGalleryVersion,
    });

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        manifestVersion: "1.0.0",
        requiresFullSync: false,
        currentManifestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        currentConfigVersion: expect.stringMatching(/^manifest-[0-9a-f]{16}$/),
        contentVersions: expect.objectContaining({
          publicCatalogVersion: "public-catalog-v1-1",
        }),
      }),
    );
    expect((result as any).changed.publicCatalog).toEqual([publicCourse]);
    expect((result as any).changed.license).toEqual(full.license);
    expect((result as any).changed.policies).toEqual(full.policies);
    expect((result as any).changed).not.toHaveProperty("tenant");
    expect((result as any).changed).not.toHaveProperty("myCourses");
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("returns the versioned bootstrap manifest contract", async () => {
    const result = await service.sync(10);

    expect(result).toEqual(
      expect.objectContaining({
        schemaVersion: 1,
        manifestVersion: "1.0.0",
        locked: false,
        tenant: {
          orgId: 1,
          orgName: "Demo School",
          displayName: "Demo School",
          logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
          primaryColor: "#1D4ED8",
          secondaryColor: "#F97316",
          tenantVersion: 1,
          cacheVersion: "org-1-v1",
        },
        license: {
          status: LicenseStatus.ACTIVE,
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2099-01-01T00:00:00.000Z"),
        },
        capabilities: {
          schemaVersion: 1,
          effective: [],
          resolver: "cms-entitlements-v1",
        },
        policies: {
          schemaVersion: 1,
          offlineCache: {
            enabled: true,
            scope: "tenant",
            cacheVersion: "org-1-v1",
          },
          sync: {
            fullSyncRequired: false,
            retryAfterSeconds: 30,
          },
          appUpdate: {
            minimumSupportedVersionName: "0.1.0",
            minimumSupportedVersionCode: 1,
            recommendedVersionName: "0.1.0",
            recommendedVersionCode: 1,
            currentVersionCode: null,
            updateRequired: false,
            updateRecommended: false,
          },
          conversation: expect.objectContaining({
            schemaVersion: 1,
            source: "organizationDefault",
            version: expect.objectContaining({
              effective: "conversation-org-1-v1-robot-10-v0",
            }),
          }),
        },
        conversation: expect.objectContaining({
          schemaVersion: 1,
          source: "organizationDefault",
          personaName: "Demo Guide",
          greetingText: "Welcome to Demo School.",
          provider: {
            schemaVersion: 1,
            gateway: "cms-ai-gateway",
            providerAlias: "cms-ai-provider",
            modelAlias: "default-conversation-model",
            policyVersion: "ai-provider-policy-v1",
            directProviderAccess: false,
          },
        }),
        contentVersions: {
          cacheVersion: "org-1-v1",
          tenantVersion: 1,
          myCoursesVersion: expect.stringMatching(/^my-courses-org-1-v1-[0-9a-f]{12}$/),
          publicCatalogVersion: "public-catalog-v1-0",
          identityGalleryVersion: expect.stringMatching(/^identity-gallery-org-1-[0-9a-f]{12}$/),
          myCoursesCount: 0,
          publicCatalogCount: 0,
          identityGalleryCount: 0,
        },
        sync: expect.objectContaining({
          serverTime: expect.any(String),
          syncedAt: expect.any(String),
          idempotencyKey: "robot-10-org-1-org-1-v1",
          configVersion: expect.stringMatching(/^manifest-[0-9a-f]{16}$/),
          manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    );
    expect((result as any).organization).toEqual((result as any).tenant);
    expect((result as any).entitlements.paidCapabilities).toBe(
      (result as any).capabilities.effective,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("marks app update as required when robot app version code is below minimum", async () => {
    const result = await service.sync(10, {
      appVersion: "0.0.1",
      appVersionCode: 0,
    });

    expect((result as any).policies.appUpdate).toEqual({
      minimumSupportedVersionName: "0.1.0",
      minimumSupportedVersionCode: 1,
      recommendedVersionName: "0.1.0",
      recommendedVersionCode: 1,
      currentVersionCode: 0,
      updateRequired: true,
      updateRecommended: true,
    });
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("uses stored approved device profile app version code when heartbeat omits it", async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        deviceMetadata: {
          schemaVersion: 2,
          storage: "approved-device-profile",
          appVersionCode: 2,
        },
      }),
    );

    const result = await service.sync(10);

    expect((result as any).policies.appUpdate).toEqual(
      expect.objectContaining({
        currentVersionCode: 2,
        updateRequired: false,
        updateRecommended: false,
      }),
    );
  });

  it.each([
    {
      name: "expired",
      robot: buildRobot({
        validUntil: new Date("2025-01-01T00:00:00.000Z"),
        licenseStatus: LicenseStatus.ACTIVE,
      }),
      expectedStatus: LicenseStatus.EXPIRED,
    },
    {
      name: "revoked",
      robot: buildRobot({
        revokedAt: new Date("2026-02-01T00:00:00.000Z"),
        licenseStatus: LicenseStatus.ACTIVE,
      }),
      expectedStatus: LicenseStatus.REVOKED,
    },
  ])(
    "returns the versioned bootstrap manifest contract when a robot license is $name",
    async ({ robot, expectedStatus }) => {
      prisma.robot.findUnique.mockResolvedValue(robot);

      const result = await service.sync(10);

      expect(result).toEqual(
        expect.objectContaining({
          schemaVersion: 1,
          manifestVersion: "1.0.0",
          locked: true,
          reason: expectedStatus,
          tenant: expect.objectContaining({
            orgId: 1,
            tenantVersion: 1,
            cacheVersion: "org-1-v1",
          }),
          license: {
            status: expectedStatus,
            validFrom: new Date("2026-01-01T00:00:00.000Z"),
            validUntil: robot.validUntil,
          },
          capabilities: {
            schemaVersion: 1,
            effective: [],
            resolver: "cms-entitlements-v1",
          },
          policies: expect.objectContaining({
            schemaVersion: 1,
            offlineCache: expect.objectContaining({ cacheVersion: "org-1-v1" }),
          }),
          contentVersions: expect.objectContaining({
            cacheVersion: "org-1-v1",
            myCoursesCount: 0,
            publicCatalogCount: 0,
          }),
          sync: expect.objectContaining({
            serverTime: expect.any(String),
            syncedAt: expect.any(String),
            configVersion: expect.stringMatching(/^manifest-[0-9a-f]{16}$/),
            manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/),
          }),
        }),
      );
      expect((result as any).organization).toEqual((result as any).tenant);
      expect((result as any).entitlements.paidCapabilities).toEqual([]);
      expect(prisma.course.findMany).not.toHaveBeenCalled();
      expect(JSON.stringify(result)).not.toMatch(
        /licenseKey|token|password|secret/i,
      );
    },
  );

  it("rejects inactive organization sync with the shared locked error before building content", async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        org: {
          id: 1,
          name: "Demo School",
          isActive: false,
          logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
          primaryColor: "#1D4ED8",
          secondaryColor: "#F97316",
          tenantVersion: 1,
        },
      }),
    );

    await expect(service.sync(10)).rejects.toBeInstanceOf(
      DomainLockedException,
    );
    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        robotId: 10,
        type: "ROBOT_ACCESS_REJECTED_ORG_INACTIVE",
        payload: {
          reason: "ORG_INACTIVE",
          endpoint: "robot.sync",
        },
      },
    });
    expect(prisma.course.findMany).not.toHaveBeenCalled();
  });

  it("returns safe organization context for the authenticated robot tenant", async () => {
    const result = await service.sync(10);

    expect(result).toEqual(
      expect.objectContaining({
        organization: {
          orgId: 1,
          orgName: "Demo School",
          displayName: "Demo School",
          logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
          primaryColor: "#1D4ED8",
          secondaryColor: "#F97316",
          tenantVersion: 1,
          cacheVersion: "org-1-v1",
        },
      }),
    );
    expect((result as any).organization).not.toHaveProperty(
      "authorizedPersonName",
    );
    expect((result as any).organization).not.toHaveProperty("contactNo");
  });

  it("returns distinct organization context for another tenant without cross-tenant leakage", async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        id: 11,
        orgId: 2,
        org: {
          id: 2,
          name: "Test School 2",
          isActive: true,
          logoUrl: "https://assets.whizrobo.test/orgs/test-school-2-logo.png",
          primaryColor: "#7C3AED",
          secondaryColor: "#22C55E",
          tenantVersion: 2,
        },
      }),
    );

    const result = await service.sync(11);

    expect((result as any).organization).toEqual({
      orgId: 2,
      orgName: "Test School 2",
      displayName: "Test School 2",
      logoUrl: "https://assets.whizrobo.test/orgs/test-school-2-logo.png",
      primaryColor: "#7C3AED",
      secondaryColor: "#22C55E",
      tenantVersion: 2,
      cacheVersion: "org-2-v2",
    });
    expect((result as any).organization.orgId).not.toBe(1);
  });

  it("returns a complete manifest with content and effective entitlements for the test robot", async () => {
    const orgCourse = {
      id: 101,
      courseCode: "ORG-MATH-1",
      courseName: "Org Math",
      source: "ORGANIZATION",
      visibility: "PRIVATE",
      levels: [],
    };
    const publicCourse = {
      id: 201,
      courseCode: "PUBLIC-INTRO",
      courseName: "Public Intro",
      description: "Intro preview",
      courseImageUrl: null,
      logoUrl: null,
      introLevel: { id: 301, name: "Intro", chapters: [], lessons: [] },
    };
    prisma.course.findMany
      .mockResolvedValueOnce([orgCourse])
      .mockResolvedValueOnce([publicCourse]);
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "speech-plus",
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 1,
              stableKey: "audio.speaker",
              name: "Speaker Output",
              description: null,
              category: "audio",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
          {
            capability: {
              id: 2,
              stableKey: "speech.recognition",
              name: "Speech Recognition",
              description: null,
              category: "speech",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
        ],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([
      {
        id: 1,
        orgId: 1,
        capabilityId: 2,
        effect: CapabilityOverrideEffect.DENY,
        reason: "Disabled for pilot",
        capability: {
          id: 2,
          stableKey: "speech.recognition",
          name: "Speech Recognition",
          description: null,
          category: "speech",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
    ]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([
      {
        id: 1,
        robotId: 10,
        capabilityId: 1,
        isEnabled: true,
        limits: { maxVolume: 80 },
        capability: {
          id: 1,
          stableKey: "audio.speaker",
          name: "Speaker Output",
          description: null,
          category: "audio",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
      {
        id: 2,
        robotId: 10,
        capabilityId: 2,
        isEnabled: true,
        limits: null,
        capability: {
          id: 2,
          stableKey: "speech.recognition",
          name: "Speech Recognition",
          description: null,
          category: "speech",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
    ]);

    const result = await service.sync(10);

    expect((result as any).schemaVersion).toBe(1);
    expect((result as any).manifestVersion).toBe("1.0.0");
    expect((result as any).tenant).toEqual({
      orgId: 1,
      orgName: "Demo School",
      displayName: "Demo School",
      logoUrl: "https://assets.whizrobo.test/orgs/demo-school-logo.png",
      primaryColor: "#1D4ED8",
      secondaryColor: "#F97316",
      tenantVersion: 1,
      cacheVersion: "org-1-v1",
    });
    expect(
      (result as any).capabilities.effective.map(
        (capability: any) => capability.stableKey,
      ),
    ).toEqual(["audio.speaker"]);
    expect((result as any).capabilities.effective[0].limits).toEqual({
      maxVolume: 80,
    });
    expect((result as any).entitlements.paidCapabilities).toBe(
      (result as any).capabilities.effective,
    );
    expect((result as any).myCourses).toEqual([orgCourse]);
    expect((result as any).publicCatalog).toEqual([publicCourse]);
    expect((result as any).contentVersions).toEqual({
      cacheVersion: "org-1-v1",
      tenantVersion: 1,
      myCoursesVersion: expect.stringMatching(/^my-courses-org-1-v1-[0-9a-f]{12}$/),
      publicCatalogVersion: "public-catalog-v1-1",
      identityGalleryVersion: expect.stringMatching(/^identity-gallery-org-1-[0-9a-f]{12}$/),
      myCoursesCount: 1,
      publicCatalogCount: 1,
      identityGalleryCount: 0,
    });
    expect((result as any).policies.offlineCache.cacheVersion).toBe("org-1-v1");
    expect((result as any).policies.appUpdate).toEqual(
      expect.objectContaining({
        minimumSupportedVersionName: "0.1.0",
        minimumSupportedVersionCode: 1,
        updateRequired: false,
      }),
    );
    expect((result as any).sync.idempotencyKey).toBe("robot-10-org-1-org-1-v1");
    expect((result as any).sync.configVersion).toMatch(/^manifest-[0-9a-f]{16}$/);
    expect((result as any).sync.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("returns signed resumable content delivery links for assigned LMS lessons", async () => {
    const course = buildManifestCourse(701, "Signed Delivery Course") as any;
    course.levels[0].chapters[0].lessons[0] = {
      ...course.levels[0].chapters[0].lessons[0],
      contentVersion: 2,
      contentSizeBytes: 2048,
      contentChecksum: "b".repeat(64),
    };
    prisma.orgCourseAccess.findMany.mockResolvedValue([
      {
        courseId: 701,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);
    prisma.course.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([course])
      .mockResolvedValueOnce([]);

    const result = await service.sync(10);
    const lesson = (result as any).myCourses[0].levels[0].chapters[0].lessons[0];

    expect(lesson.contentUrl).toMatch(/^\/api\/v1\/content\/delivery\/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    expect(lesson.contentDelivery).toEqual({
      url: lesson.contentUrl,
      expiresInSeconds: 900,
      resumable: true,
      method: "GET",
    });
    expect(JSON.stringify(result)).not.toMatch(/licenseKey|password|secret/i);
  });

  it("requests only published courses and lessons for new manifests", async () => {
    prisma.orgCourseAccess.findMany.mockResolvedValue([
      {
        courseId: 701,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);
    prisma.course.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);

    await service.sync(10);

    expect(prisma.course.findMany).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: { ownerOrgId: 1, isPublished: true },
        include: expect.objectContaining({
          levels: expect.objectContaining({
            include: expect.objectContaining({
              chapters: expect.objectContaining({
                include: {
                  lessons: expect.objectContaining({
                    where: { isPublished: true },
                  }),
                },
              }),
              lessons: expect.objectContaining({
                where: { chapterId: null, isPublished: true },
              }),
            }),
          }),
        }),
      }),
    );
    expect(prisma.course.findMany).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: [701] },
          source: "PLATFORM",
          isPublished: true,
        }),
      }),
    );
    expect(prisma.course.findMany).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        where: expect.objectContaining({
          visibility: "PUBLIC",
          isPublished: true,
        }),
        include: expect.objectContaining({
          introLevel: expect.objectContaining({
            include: expect.objectContaining({
              chapters: expect.objectContaining({
                include: {
                  lessons: expect.objectContaining({
                    where: {
                      visibility: "PUBLIC_PREVIEW",
                      isPublished: true,
                    },
                  }),
                },
              }),
              lessons: expect.objectContaining({
                where: {
                  chapterId: null,
                  visibility: "PUBLIC_PREVIEW",
                  isPublished: true,
                },
              }),
            }),
          }),
        }),
      }),
    );
  });

  it("returns assigned LMS content only for the explicitly allowed robot", async () => {
    const allowedCourse = buildManifestCourse(301, "Allowed Robot Course");
    const otherRobotCourse = buildManifestCourse(302, "Other Robot Course");

    prisma.orgCourseAccess.findMany.mockResolvedValue([
      {
        courseId: 301,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
      {
        courseId: 302,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);
    prisma.robotCourseAccess.findMany.mockResolvedValue([
      {
        robotId: 10,
        courseId: 301,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
      {
        robotId: 11,
        courseId: 302,
        accessType: CourseAccessType.FULL_COURSE,
        levelId: null,
        chapterId: null,
      },
    ]);
    prisma.course.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([allowedCourse, otherRobotCourse])
      .mockResolvedValueOnce([]);

    const result = await service.sync(10);

    expect((result as any).myCourses.map((course: any) => course.id)).toEqual([301]);
    expect((result as any).contentVersions.myCoursesCount).toBe(1);
    expect((result as any).contentVersions.myCoursesVersion).toMatch(
      /^my-courses-org-1-v1-[0-9a-f]{12}$/,
    );
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("intersects robot LMS scope with organization course access before returning manifest content", async () => {
    const platformCourse = buildManifestCourse(401, "Scoped Platform Course");

    prisma.orgCourseAccess.findMany.mockResolvedValue([
      {
        courseId: 401,
        accessType: CourseAccessType.CHAPTER_ONLY,
        levelId: null,
        chapterId: 40100,
      },
    ]);
    prisma.robotCourseAccess.findMany.mockResolvedValue([
      {
        robotId: 10,
        courseId: 401,
        accessType: CourseAccessType.LEVEL_ONLY,
        levelId: 4010,
        chapterId: null,
      },
    ]);
    prisma.course.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([platformCourse])
      .mockResolvedValueOnce([]);

    const result = await service.sync(10);

    expect((result as any).myCourses).toHaveLength(1);
    expect((result as any).myCourses[0].levels).toEqual([
      expect.objectContaining({
        id: 4010,
        chapters: [
          expect.objectContaining({
            id: 40100,
          }),
        ],
        lessons: [],
      }),
    ]);
  });

  it("returns active subscription paid capabilities exactly from the assigned plan", async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "speech-plus",
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 2,
              stableKey: "display.touch",
              name: "Touch Display",
              description: null,
              category: "display",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
          {
            capability: {
              id: 1,
              stableKey: "audio.speaker",
              name: "Speaker Output",
              description: null,
              category: "audio",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
          {
            capability: {
              id: 9,
              stableKey: "disabled.capability",
              name: "Disabled",
              description: null,
              category: "test",
              version: 1,
              requiredHardware: null,
              isActive: false,
            },
          },
        ],
      },
    });
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([
      {
        id: 1,
        robotId: 10,
        capabilityId: 1,
        isEnabled: true,
        limits: { maxVolume: 80 },
        capability: {
          id: 1,
          stableKey: "audio.speaker",
          name: "Speaker Output",
          description: null,
          category: "audio",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
      {
        id: 2,
        robotId: 10,
        capabilityId: 2,
        isEnabled: true,
        limits: { maxTouches: 2 },
        capability: {
          id: 2,
          stableKey: "display.touch",
          name: "Touch Display",
          description: null,
          category: "display",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
      {
        id: 3,
        robotId: 10,
        capabilityId: 99,
        isEnabled: true,
        limits: null,
        capability: {
          id: 99,
          stableKey: "not.in.plan",
          name: "Not In Plan",
          description: null,
          category: "test",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
    ]);

    const result = await service.sync(10);

    expect(prisma.organizationSubscription.findFirst).toHaveBeenCalledWith({
      where: { orgId: 1 },
      orderBy: { updatedAt: "desc" },
      include: expect.any(Object),
    });
    expect(prisma.organizationCapabilityOverride.findMany).toHaveBeenCalledWith(
      {
        where: { orgId: 1 },
        include: { capability: true },
        orderBy: { capability: { stableKey: "asc" } },
      },
    );
    expect((result as any).entitlements.subscription).toEqual({
      status: "ACTIVE",
      planId: 2,
      planStableKey: "speech-plus",
      planVersion: 1,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
    });
    expect(prisma.robotCapabilityAssignment.findMany).toHaveBeenCalledWith({
      where: { robotId: 10 },
      include: { capability: true },
      orderBy: { capability: { stableKey: "asc" } },
    });
    expect(
      (result as any).entitlements.paidCapabilities.map(
        (capability: any) => capability.stableKey,
      ),
    ).toEqual(["audio.speaker", "display.touch"]);
    expect((result as any).entitlements.paidCapabilities[0].limits).toEqual({
      maxVolume: 80,
    });
    expect(
      (result as any).entitlements.paidCapabilities.map(
        (capability: any) => capability.stableKey,
      ),
    ).not.toContain("not.in.plan");
    expect(JSON.stringify((result as any).entitlements)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("applies capability overrides only to the authenticated robot organization", async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "speech-plus",
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 1,
              stableKey: "audio.speaker",
              name: "Speaker Output",
              description: null,
              category: "audio",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
          {
            capability: {
              id: 2,
              stableKey: "speech.recognition",
              name: "Speech Recognition",
              description: null,
              category: "speech",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
        ],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([
      {
        id: 1,
        orgId: 1,
        capabilityId: 2,
        effect: CapabilityOverrideEffect.DENY,
        reason: "Pilot disabled",
        capability: {
          id: 2,
          stableKey: "speech.recognition",
          name: "Speech Recognition",
          description: null,
          category: "speech",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
      {
        id: 2,
        orgId: 1,
        capabilityId: 3,
        effect: CapabilityOverrideEffect.ALLOW,
        reason: "Temporary trial",
        capability: {
          id: 3,
          stableKey: "camera.capture",
          name: "Camera Capture",
          description: null,
          category: "vision",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
    ]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([
      {
        id: 1,
        robotId: 10,
        capabilityId: 1,
        isEnabled: true,
        limits: null,
        capability: {
          id: 1,
          stableKey: "audio.speaker",
          name: "Speaker Output",
          description: null,
          category: "audio",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
      {
        id: 2,
        robotId: 10,
        capabilityId: 2,
        isEnabled: true,
        limits: null,
        capability: {
          id: 2,
          stableKey: "speech.recognition",
          name: "Speech Recognition",
          description: null,
          category: "speech",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
      {
        id: 3,
        robotId: 10,
        capabilityId: 3,
        isEnabled: true,
        limits: { maxPhotosPerMinute: 3 },
        capability: {
          id: 3,
          stableKey: "camera.capture",
          name: "Camera Capture",
          description: null,
          category: "vision",
          version: 1,
          requiredHardware: null,
          isActive: true,
        },
      },
    ]);

    const result = await service.sync(10);

    expect(
      (result as any).entitlements.paidCapabilities.map(
        (capability: any) => capability.stableKey,
      ),
    ).toEqual(["audio.speaker", "camera.capture"]);
    expect(
      (result as any).entitlements.paidCapabilities.map(
        (capability: any) => capability.stableKey,
      ),
    ).not.toContain("speech.recognition");
  });

  it("removes paid capabilities for an expired organization subscription", async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2025-01-01T00:00:00.000Z"),
      validUntil: new Date("2025-02-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "starter",
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 1,
              stableKey: "audio.speaker",
              name: "Speaker Output",
              version: 1,
              isActive: true,
            },
          },
        ],
      },
    });

    const result = await service.sync(10);

    expect((result as any).entitlements.subscription.status).toBe("EXPIRED");
    expect((result as any).entitlements.paidCapabilities).toEqual([]);
  });

  it("applies entitlement revocation on the next manifest sync", async () => {
    const audio = {
      id: 1,
      stableKey: "audio.speaker",
      name: "Speaker Output",
      description: null,
      category: "audio",
      version: 1,
      requiredHardware: null,
      isActive: true,
    };
    const speech = {
      id: 2,
      stableKey: "speech.recognition",
      name: "Speech Recognition",
      description: null,
      category: "speech",
      version: 1,
      requiredHardware: null,
      isActive: true,
    };

    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "speech-plus",
        version: 1,
        isActive: true,
        capabilities: [{ capability: audio }, { capability: speech }],
      },
    });
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([
      {
        id: 1,
        robotId: 10,
        capabilityId: 1,
        isEnabled: true,
        limits: null,
        capability: audio,
      },
      {
        id: 2,
        robotId: 10,
        capabilityId: 2,
        isEnabled: true,
        limits: null,
        capability: speech,
      },
    ]);

    prisma.organizationCapabilityOverride.findMany.mockResolvedValueOnce([]);
    const beforeRevocation = await service.sync(10);
    expect(
      (beforeRevocation as any).entitlements.paidCapabilities.map(
        (capability: any) => capability.stableKey,
      ),
    ).toEqual(["audio.speaker", "speech.recognition"]);

    prisma.organizationCapabilityOverride.findMany.mockResolvedValueOnce([
      {
        id: 10,
        orgId: 1,
        capabilityId: 2,
        effect: CapabilityOverrideEffect.DENY,
        reason: "Revoked after QA failure",
        capability: speech,
      },
    ]);
    const afterRevocation = await service.sync(10);

    expect(
      (afterRevocation as any).entitlements.paidCapabilities.map(
        (capability: any) => capability.stableKey,
      ),
    ).toEqual(["audio.speaker"]);
    expect(JSON.stringify((afterRevocation as any).entitlements)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("removes paid capabilities on the next manifest sync when subscription is inactive", async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.INACTIVE,
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        id: 2,
        stableKey: "starter",
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 1,
              stableKey: "audio.speaker",
              name: "Speaker Output",
              description: null,
              category: "audio",
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
        ],
      },
    });

    const result = await service.sync(10);

    expect((result as any).entitlements.subscription.status).toBe("INACTIVE");
    expect((result as any).entitlements.paidCapabilities).toEqual([]);
    expect(JSON.stringify((result as any).entitlements)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("stores the approved Android device and hardware profile for the authenticated robot", async () => {
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = buildRobot();
    prisma.robot.update.mockResolvedValue({
      ...robotWithoutLicenseKey,
      appVersion: "0.1.0",
      deviceModel: "Mini ELF",
      deviceMetadata: {
        schemaVersion: 2,
        storage: "approved-device-profile",
        manufacturer: "Sanbot",
        model: "Mini ELF",
        androidVersion: "7.1.2",
        apiLevel: 25,
        appVersionName: "0.1.0",
        appVersionCode: 2,
      },
      hardwareModel: "MINI_ELF",
      hardwareProfile: {
        schemaVersion: 1,
        model: "MINI_ELF",
        label: "Mini ELF",
        manufacturer: "Sanbot",
        androidApiLevel: 25,
        abi: "arm64-v8a",
        display: { width: 1920, height: 1200 },
      },
      hardwareCapabilities: {
        camera: true,
        microphone: true,
        speaker: true,
        touchDisplay: true,
        videoPlayback: true,
        speechRecognition: true,
        autonomousNavigation: false,
        armMotion: false,
      },
    });

    const result = await service.updateDeviceProfile(10, {
      manufacturer: "Sanbot",
      deviceModel: "Mini ELF",
      androidVersion: "7.1.2",
      apiLevel: 25,
      appVersionName: "0.1.0",
      appVersionCode: 2,
      hardwareProfile: {
        model: "MINI_ELF",
        manufacturer: "Sanbot",
        androidApiLevel: 25,
        abi: "arm64-v8a",
        display: { width: 1920, height: 1200 },
        capabilities: {
          camera: true,
          autonomousNavigation: true,
          armMotion: true,
        },
      },
    });

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
        appVersion: "0.1.0",
        deviceModel: "Mini ELF",
        deviceMetadata: {
          schemaVersion: 2,
          storage: "approved-device-profile",
          manufacturer: "Sanbot",
          model: "Mini ELF",
          androidVersion: "7.1.2",
          apiLevel: 25,
          appVersionName: "0.1.0",
          appVersionCode: 2,
        },
        hardwareModel: "MINI_ELF",
        hardwareProfile: {
          schemaVersion: 1,
          model: "MINI_ELF",
          label: "Mini ELF",
          manufacturer: "Sanbot",
          androidApiLevel: 25,
          abi: "arm64-v8a",
          display: { width: 1920, height: 1200 },
        },
        hardwareCapabilities: {
          camera: true,
          microphone: true,
          speaker: true,
          touchDisplay: true,
          videoPlayback: true,
          speechRecognition: true,
          autonomousNavigation: false,
          armMotion: false,
        },
      },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
    expect(result.robot).not.toHaveProperty("licenseKey");
    expect(
      (result.robot as any).hardwareCapabilities.autonomousNavigation,
    ).toBe(false);
  });

  it("rejects invalid hardware profile updates before overwriting stored device values", async () => {
    await expect(
      service.updateDeviceProfile(10, {
        manufacturer: "Sanbot",
        deviceModel: "Mini ELF",
        androidVersion: "7.1.2",
        apiLevel: 25,
        appVersionName: "0.1.0",
        appVersionCode: 2,
        hardwareProfile: {
          model: "MINI_ELF",
          manufacturer: "Sanbot",
          androidApiLevel: 31,
          abi: "arm64-v8a",
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.robot.update).not.toHaveBeenCalled();
  });

  it("rejects stale device profile updates before overwriting a newer approved profile", async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        deviceMetadata: {
          schemaVersion: 2,
          storage: "approved-device-profile",
          appVersionCode: 5,
        },
      }),
    );

    await expect(
      service.updateDeviceProfile(10, {
        manufacturer: "Sanbot",
        deviceModel: "Mini ELF",
        androidVersion: "7.1.2",
        apiLevel: 25,
        appVersionName: "0.1.0",
        appVersionCode: 4,
        hardwareProfile: {
          model: "MINI_ELF",
          manufacturer: "Sanbot",
          androidApiLevel: 25,
          abi: "arm64-v8a",
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.robot.update).not.toHaveBeenCalled();
  });

  it("accepts device profile updates with the same app version code", async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        deviceMetadata: {
          schemaVersion: 2,
          storage: "approved-device-profile",
          appVersionCode: 2,
        },
      }),
    );
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = buildRobot();
    prisma.robot.update.mockResolvedValue(robotWithoutLicenseKey);

    await service.updateDeviceProfile(10, {
      manufacturer: "Sanbot",
      deviceModel: "Mini ELF",
      androidVersion: "7.1.2",
      apiLevel: 25,
      appVersionName: "0.1.0",
      appVersionCode: 2,
      hardwareProfile: {
        model: "MINI_ELF",
        manufacturer: "Sanbot",
        androidApiLevel: 25,
        abi: "arm64-v8a",
        display: { width: 1920, height: 1200 },
      },
    });

    expect(prisma.robot.update).toHaveBeenCalled();
  });

  it("keeps repeated device profile updates idempotent for the same approved values", async () => {
    const payload = {
      manufacturer: "Sanbot",
      deviceModel: "Mini ELF",
      androidVersion: "7.1.2",
      apiLevel: 25,
      appVersionName: "0.1.0",
      appVersionCode: 2,
      hardwareProfile: {
        model: "MINI_ELF",
        manufacturer: "Sanbot",
        androidApiLevel: 25,
        abi: "arm64-v8a",
        display: { width: 1920, height: 1200 },
      },
    };
    prisma.robot.update.mockResolvedValue(buildRobot());

    await service.updateDeviceProfile(10, payload);
    await service.updateDeviceProfile(10, payload);

    const [firstCall, secondCall] = prisma.robot.update.mock.calls;
    expect(firstCall[0].data.deviceMetadata).toEqual(
      secondCall[0].data.deviceMetadata,
    );
    expect(firstCall[0].data.hardwareProfile).toEqual(
      secondCall[0].data.hardwareProfile,
    );
  });

  it("blocks device profile updates when the license is expired", async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        validUntil: new Date("2020-01-01T00:00:00.000Z"),
        licenseStatus: LicenseStatus.ACTIVE,
      }),
    );

    await expect(
      service.updateDeviceProfile(10, {
        manufacturer: "Sanbot",
        deviceModel: "Mini ELF",
        androidVersion: "7.1.2",
        apiLevel: 25,
        appVersionName: "0.1.0",
        appVersionCode: 2,
        hardwareProfile: {
          model: "MINI_ELF",
          manufacturer: "Sanbot",
          androidApiLevel: 25,
          abi: "arm64-v8a",
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(DomainLockedException);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { licenseStatus: LicenseStatus.EXPIRED },
    });
  });
});
