import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { LicenseStatus, Prisma } from "@prisma/client";
import { DomainLockedException } from "../../common/errors/domain-locked.exception";
import { JwtPayload } from "../../common/auth/jwt.types";
import { IdentityController } from "../identity/identity.controller";
import { IdentityService } from "../identity/identity.service";
import { RobotSyncService } from "../robot-sync/robot-sync.service";
import { RobotManifestResolver } from "../robot-sync/robot-manifest.resolver";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { JobsService } from "../jobs/jobs.service";

describe("CMS-81 Cross-Tenant Isolation & Deletion Propagation Regression Suite", () => {
  const orgUser10: JwtPayload = {
    type: "user",
    sub: 101,
    orgId: 10,
    isSuperAdmin: false,
  };

  const orgUser99: JwtPayload = {
    type: "user",
    sub: 202,
    orgId: 99,
    isSuperAdmin: false,
  };

  const superAdminUser: JwtPayload = {
    type: "user",
    sub: 1,
    orgId: 10,
    isSuperAdmin: true,
  };

  const robotToken: JwtPayload = {
    type: "robot",
    sub: 77,
    orgId: 10,
    tokenUse: "access",
  };

  let prisma: any;
  let audit: any;
  let identityService: IdentityService;
  let identityController: IdentityController;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.LICENSE_SECRET_KEY =
      "cms-81-test-license-secret-key-32chars";

    prisma = {
      organization: {
        findUnique: jest.fn().mockImplementation(({ where }) => {
          if (where.id === 10) return Promise.resolve({ id: 10, isActive: true, name: "Org 10" });
          if (where.id === 99) return Promise.resolve({ id: 99, isActive: true, name: "Org 99" });
          if (where.id === 999) return Promise.resolve({ id: 999, isActive: false, name: "Inactive Org" });
          return Promise.resolve(null);
        }),
      },
      identityEmbeddingRecord: {
        findMany: jest.fn(),
        findUnique: jest.fn(),
        upsert: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      identityTemplate: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      robot: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
      event: {
        create: jest.fn(),
      },
      course: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      orgCourseAccess: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      robotCourseAccess: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      userCapabilityAssignment: {
        findMany: jest.fn().mockResolvedValue([]),
      },
      $transaction: jest.fn().mockImplementation((cb) => cb(prisma)),
    };

    audit = {
      recordCritical: jest.fn().mockResolvedValue({ id: 1 }),
    };

    identityService = new IdentityService(prisma as any, audit as any);
    identityController = new IdentityController(identityService);
  });

  describe("Cross-Tenant Administrative Authorization Matrix (F08)", () => {
    it("rejects listing identities across tenant boundaries", async () => {
      await expect(
        identityController.list(orgUser10, 99),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.identityEmbeddingRecord.findMany).not.toHaveBeenCalled();
    });

    it("rejects creating identities in another tenant", async () => {
      const dto = {
        subjectRef: "visitor.demo-01",
        consent: {
          granted: true,
          source: "frontdesk",
          policyVersion: "identity-v1",
          grantedAt: "2026-10-10T00:00:00.000Z",
        },
        embeddingMetadata: { dimensions: 384, provider: "local" },
      };

      await expect(
        identityController.create(orgUser10, 99, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.identityEmbeddingRecord.upsert).not.toHaveBeenCalled();
    });

    it("rejects direct-ID correction when orgId in route belongs to another tenant", async () => {
      const dto = {
        embeddingMetadata: { dimensions: 384, provider: "local-v2" },
      };

      await expect(
        identityController.correct(orgUser10, 99, 50, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects direct-ID correction tampering when record belongs to another tenant", async () => {
      // Record 50 belongs to Org 99, user belongs to Org 10 and accesses /orgs/10/identity-embeddings/50
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue({
        id: 50,
        orgId: 99,
        subjectRef: "visitor.org99-01",
        status: "ACTIVE",
      });

      const dto = {
        embeddingMetadata: { dimensions: 384, provider: "local-v2" },
      };

      await expect(
        identityController.correct(orgUser10, 10, 50, dto),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects direct-ID consent revocation tampering across tenants", async () => {
      // Record 50 belongs to Org 99, user from Org 10 tries to revoke it
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue({
        id: 50,
        orgId: 99,
        subjectRef: "visitor.org99-01",
        status: "ACTIVE",
      });

      await expect(
        identityController.revokeConsent(orgUser10, 10, 50, { reason: "withdrawn" }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("rejects direct-ID erasure tampering across tenants", async () => {
      // Record 50 belongs to Org 99, user from Org 10 tries to erase it
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue({
        id: 50,
        orgId: 99,
        subjectRef: "visitor.org99-01",
        status: "REVOKED",
      });

      await expect(
        identityController.erase(orgUser10, 10, 50, { reason: "subject_request" }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(prisma.identityEmbeddingRecord.update).not.toHaveBeenCalled();
    });

    it("allows Super Admin to administer identities across different organizations", async () => {
      prisma.identityEmbeddingRecord.findMany.mockResolvedValue([]);

      const result = await identityController.list(superAdminUser, 99);
      expect(result).toEqual([]);
      expect(prisma.identityEmbeddingRecord.findMany).toHaveBeenCalledWith({
        where: { orgId: 99 },
        orderBy: { createdAt: "desc" },
      });
    });

    it("rejects robot JWT tokens from accessing identity administration endpoints", async () => {
      await expect(
        identityController.list(robotToken, 10),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(prisma.identityEmbeddingRecord.findMany).not.toHaveBeenCalled();
    });

    it("rejects identity operations against inactive organizations", async () => {
      await expect(
        identityController.list(superAdminUser, 999),
      ).rejects.toBeInstanceOf(ForbiddenException);

      const dto = {
        subjectRef: "visitor.demo-01",
        consent: {
          granted: true,
          source: "frontdesk",
          policyVersion: "identity-v1",
          grantedAt: "2026-10-10T00:00:00.000Z",
        },
        embeddingMetadata: { dimensions: 384, provider: "local" },
      };

      await expect(
        identityController.create(superAdminUser, 999, dto),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(prisma.identityEmbeddingRecord.upsert).not.toHaveBeenCalled();
    });
  });

  describe("Deletion & Consent Revocation Propagation to Robot Sync", () => {
    function setupRobotSyncService() {
      const entitlements = new EntitlementsService(prisma as any);
      jest.spyOn(entitlements, "resolve").mockResolvedValue({
        subscription: {
          status: LicenseStatus.ACTIVE,
          planStableKey: "standard",
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2099-01-01T00:00:00.000Z"),
        },
        paidCapabilities: ["capability.identity"],
      } as any);

      const manifestResolver = new RobotManifestResolver(
        entitlements,
        undefined,
        undefined,
        identityService,
      );

      return new RobotSyncService(
        prisma as any,
        manifestResolver,
      );
    }

    const mockRobot = {
      id: 77,
      orgId: 10,
      serialNumber: "WHIZ-ROBOT-001",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      revokedAt: null,
      licenseStatus: LicenseStatus.ACTIVE,
      appVersion: "1.0.0",
      deviceMetadata: { appVersionCode: 1 },
      hardwareCapabilities: null,
      org: {
        id: 10,
        name: "Test Org 10",
        isActive: true,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
        tenantVersion: 1,
      },
    };

    it("propagates consent revocation into robot sync by omitting revoked record and updating manifest hash", async () => {
      const syncService = setupRobotSyncService();
      prisma.robot.findUnique.mockResolvedValue(mockRobot);

      // 1. Initial state: Org 10 has 1 active consented identity record
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([
        {
          id: 101,
          orgId: 10,
          subjectRef: "visitor.alice",
          consentGranted: true,
          status: "ACTIVE",
          consentPolicyVersion: "identity-v1",
          consentGrantedAt: new Date("2026-10-10T00:00:00.000Z"),
          embeddingFingerprint: "fp-alice-123",
          embeddingSchemaVersion: 1,
          retentionExpiresAt: null,
          deletedAt: null,
          updatedAt: new Date("2026-10-10T01:00:00.000Z"),
        },
      ]);

      const initialSync = (await syncService.sync(77)) as any;
      expect(initialSync.identityGallery.count).toBe(1);
      expect(initialSync.identityGallery.records).toBeUndefined();
      const initialGalleryVersion = initialSync.contentVersions.identityGalleryVersion;
      const initialManifestHash = initialSync.sync.manifestHash;

      // 2. Consent revocation occurs: record becomes REVOKED and is excluded from gallery query
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([]);

      const postRevokeSync = (await syncService.sync(77)) as any;
      expect(postRevokeSync.identityGallery.count).toBe(0);
      expect(postRevokeSync.identityGallery.records).toBeUndefined();
      expect(postRevokeSync.contentVersions.identityGalleryVersion).not.toBe(initialGalleryVersion);
      expect(postRevokeSync.sync.manifestHash).not.toBe(initialManifestHash);

      // 3. Incremental sync detects gallery version change and delivers update
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([]);
      const incrementalSync = (await syncService.syncChanges(77, {
        manifestHash: initialManifestHash,
        cacheVersion: "org-10-v1",
        tenantVersion: 1,
        myCoursesVersion: initialSync.contentVersions.myCoursesVersion,
        publicCatalogVersion: initialSync.contentVersions.publicCatalogVersion,
        identityGalleryVersion: initialGalleryVersion,
      })) as any;

      expect(incrementalSync.changed.identityGallery).toBeDefined();
      expect(incrementalSync.changed.identityGallery.count).toBe(0);
      expect(incrementalSync.changed.identityGallery.records).toBeUndefined();
    });

    it("propagates permanent record erasure (delete API) into robot sync", async () => {
      const syncService = setupRobotSyncService();
      prisma.robot.findUnique.mockResolvedValue(mockRobot);

      // Before erasure: record exists
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([
        {
          id: 102,
          orgId: 10,
          subjectRef: "visitor.bob",
          consentGranted: true,
          status: "ACTIVE",
          consentPolicyVersion: "identity-v1",
          consentGrantedAt: new Date("2026-10-10T00:00:00.000Z"),
          embeddingFingerprint: "fp-bob-456",
          embeddingSchemaVersion: 1,
          retentionExpiresAt: null,
          deletedAt: null,
          updatedAt: new Date("2026-10-10T01:00:00.000Z"),
        },
      ]);
      const initialSync = (await syncService.sync(77)) as any;
      expect(initialSync.identityGallery.count).toBe(1);

      // After erasure: query for active non-deleted records returns empty
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([]);
      const postEraseSync = (await syncService.sync(77)) as any;
      expect(postEraseSync.identityGallery.count).toBe(0);
      expect(postEraseSync.identityGallery.records).toBeUndefined();
    });

    it("propagates background retention job expiry deletion into robot sync", async () => {
      const jobsService = new JobsService(
        new ConfigService({ REDIS_ENABLED: "false" }),
        prisma as any,
        audit as any,
      );

      const retentionExpiresAt = new Date("2026-09-01T00:00:00.000Z");
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([
        {
          id: 103,
          orgId: 10,
          subjectRef: "visitor.expired-subject",
          retentionExpiresAt,
          embeddingSchemaVersion: 1,
        },
      ]);
      prisma.identityEmbeddingRecord.updateMany.mockResolvedValue({ count: 1 });

      // Run retention scan
      await (jobsService as any).runIdentityRetentionScan();

      expect(prisma.identityEmbeddingRecord.updateMany).toHaveBeenCalledWith({
        where: {
          id: 103,
          status: "ACTIVE",
          deletedAt: null,
          retentionExpiresAt: { lte: expect.any(Date) },
        },
        data: expect.objectContaining({
          status: "DELETED",
          embeddingCiphertext: null,
          embeddingFingerprint: null,
          deletionReason: "retention_expired",
        }),
      });

      // Subsequent robot sync excludes the deleted record
      const syncService = setupRobotSyncService();
      prisma.robot.findUnique.mockResolvedValue(mockRobot);
      prisma.identityEmbeddingRecord.findMany.mockResolvedValueOnce([]);

      const syncResult = (await syncService.sync(77)) as any;
      expect(syncResult.identityGallery.count).toBe(0);
      expect(syncResult.identityGallery.records).toBeUndefined();
    });
  });

  describe("Multi-Tenant Robot Sync Isolation Matrix", () => {
    function setupRobotSyncService() {
      const entitlements = new EntitlementsService(prisma as any);
      jest.spyOn(entitlements, "resolve").mockResolvedValue({
        subscription: {
          status: LicenseStatus.ACTIVE,
          planStableKey: "standard",
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2099-01-01T00:00:00.000Z"),
        },
        paidCapabilities: ["capability.identity"],
      } as any);

      return new RobotSyncService(
        prisma as any,
        new RobotManifestResolver(entitlements, undefined, undefined, identityService),
      );
    }

    const robotOrg10 = {
      id: 77,
      orgId: 10,
      serialNumber: "WHIZ-ROBOT-ORG10",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      revokedAt: null,
      licenseStatus: LicenseStatus.ACTIVE,
      appVersion: "1.0.0",
      deviceMetadata: { appVersionCode: 1 },
      hardwareCapabilities: null,
      org: {
        id: 10,
        name: "Organization 10",
        isActive: true,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
        tenantVersion: 1,
      },
    };

    const robotOrg99 = {
      id: 88,
      orgId: 99,
      serialNumber: "WHIZ-ROBOT-ORG99",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      revokedAt: null,
      licenseStatus: LicenseStatus.ACTIVE,
      appVersion: "1.0.0",
      deviceMetadata: { appVersionCode: 1 },
      hardwareCapabilities: null,
      org: {
        id: 99,
        name: "Organization 99",
        isActive: true,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
        tenantVersion: 1,
      },
    };

    it("ensures robots in distinct tenants receive strictly isolated galleries without cross-tenant leakage", async () => {
      const syncService = setupRobotSyncService();

      // Robot 77 (Org 10)
      prisma.robot.findUnique.mockResolvedValueOnce(robotOrg10);
      prisma.identityEmbeddingRecord.findMany.mockImplementation(({ where }: any) => {
        if (where.orgId === 10) {
          return Promise.resolve([
            {
              id: 101,
              orgId: 10,
              subjectRef: "visitor.org10-user",
              consentGranted: true,
              status: "ACTIVE",
              consentPolicyVersion: "identity-v1",
              consentGrantedAt: new Date("2026-10-10T00:00:00.000Z"),
              embeddingFingerprint: "fp-org10",
              embeddingSchemaVersion: 1,
              retentionExpiresAt: null,
              deletedAt: null,
              updatedAt: new Date("2026-10-10T01:00:00.000Z"),
            },
          ]);
        }
        if (where.orgId === 99) {
          return Promise.resolve([
            {
              id: 202,
              orgId: 99,
              subjectRef: "visitor.org99-user",
              consentGranted: true,
              status: "ACTIVE",
              consentPolicyVersion: "identity-v1",
              consentGrantedAt: new Date("2026-10-10T00:00:00.000Z"),
              embeddingFingerprint: "fp-org99",
              embeddingSchemaVersion: 1,
              retentionExpiresAt: null,
              deletedAt: null,
              updatedAt: new Date("2026-10-10T01:00:00.000Z"),
            },
          ]);
        }
        return Promise.resolve([]);
      });

      const syncOrg10 = (await syncService.sync(77)) as any;
      expect(syncOrg10.identityGallery.count).toBe(1);
      expect(syncOrg10.identityGallery.records).toBeUndefined();
      expect(syncOrg10.organization.orgId).toBe(10);

      // Robot 88 (Org 99)
      prisma.robot.findUnique.mockResolvedValueOnce(robotOrg99);
      const syncOrg99 = (await syncService.sync(88)) as any;
      expect(syncOrg99.identityGallery.count).toBe(1);
      expect(syncOrg99.identityGallery.records).toBeUndefined();
      expect(syncOrg99.organization.orgId).toBe(99);

      // Ensure no gallery versions or records leak across tenants
      expect(syncOrg10.contentVersions.identityGalleryVersion).not.toBe(
        syncOrg99.contentVersions.identityGalleryVersion,
      );
      expect(syncOrg10.sync.manifestHash).not.toBe(syncOrg99.sync.manifestHash);
    });

    it("rejects robot sync for an inactive organization and produces domain locked event without gallery exposure", async () => {
      const syncService = setupRobotSyncService();
      prisma.robot.findUnique.mockResolvedValue({
        id: 999,
        orgId: 999,
        serialNumber: "WHIZ-ROBOT-LOCKED",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2099-01-01T00:00:00.000Z"),
        revokedAt: null,
        licenseStatus: LicenseStatus.ACTIVE,
        appVersion: "1.0.0",
        deviceMetadata: { appVersionCode: 1 },
        hardwareCapabilities: null,
        org: {
          id: 999,
          name: "Inactive Tenant",
          isActive: false,
          logoUrl: null,
          primaryColor: null,
          secondaryColor: null,
          tenantVersion: 1,
        },
      });

      await expect(syncService.sync(999)).rejects.toBeInstanceOf(
        DomainLockedException,
      );

      expect(prisma.event.create).toHaveBeenCalledWith({
        data: {
          orgId: 999,
          robotId: 999,
          type: "ROBOT_ACCESS_REJECTED_ORG_INACTIVE",
          payload: {
            reason: "ORG_INACTIVE",
            endpoint: "robot.sync",
          },
        },
      });

      expect(prisma.identityEmbeddingRecord.findMany).not.toHaveBeenCalled();
    });
  });

  describe("Fixture & Audit Data Sanitization", () => {
    it("ensures audit events never contain plaintext embedding ciphertext or prohibited PII", async () => {
      const cleanRecord = {
        id: 101,
        orgId: 10,
        subjectRef: "visitor.clean-01",
        status: "ACTIVE",
        consentGranted: true,
        consentSource: "frontdesk",
        consentPolicyVersion: "identity-v1",
        consentGrantedAt: new Date("2026-10-10T00:00:00.000Z"),
        embeddingFingerprint: "fp-clean-01",
        embeddingSchemaVersion: 1,
        createdAt: new Date("2026-10-10T00:00:00.000Z"),
        updatedAt: new Date("2026-10-10T00:00:00.000Z"),
      };
      prisma.identityEmbeddingRecord.findUnique.mockResolvedValue(cleanRecord);
      prisma.identityEmbeddingRecord.update.mockResolvedValue({
        ...cleanRecord,
        status: "REVOKED",
        consentGranted: false,
        embeddingFingerprint: null,
      });

      await identityController.revokeConsent(
        orgUser10,
        10,
        101,
        { reason: "withdrawn_by_subject" },
        "cms-81-audit-test",
      );

      expect(audit.recordCritical).toHaveBeenCalled();
      const auditPayload = audit.recordCritical.mock.calls[0][0];

      expect(JSON.stringify(auditPayload)).not.toMatch(
        /embeddingCiphertext|sk-|Bearer\s+|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}|\+?\d{10}/i,
      );
      expect(auditPayload.metadata.status).toBe("REVOKED");
    });
  });
});
