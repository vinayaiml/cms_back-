import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
} from "@nestjs/common";
import { Prisma, LicenseStatus } from "@prisma/client";
import { RobotsService } from "./robots.service";
import { EntitlementsService } from "../entitlements/entitlements.service";
import { RobotManifestResolver } from "../robot-sync/robot-manifest.resolver";
import { RobotSyncService } from "../robot-sync/robot-sync.service";

process.env.LICENSE_SECRET_KEY =
  "unit-test-license-secret-minimum-32-characters";

describe("RobotsService device metadata", () => {
  const robot = {
    id: 10,
    orgId: 1,
    serialNumber: "WR-001",
    name: "Demo Robot",
    licenseKey: "secret-license-key",
    licenseKeyCiphertext: null,
    licenseKeyFingerprint: null,
    validFrom: new Date("2026-01-01T00:00:00.000Z"),
    validUntil: new Date("2027-01-01T00:00:00.000Z"),
    licenseStatus: LicenseStatus.ACTIVE,
    revokedAt: null,
    lastSeenAt: new Date("2026-01-02T00:00:00.000Z"),
    appVersion: "0.1.0",
    deviceModel: null,
    hardwareModel: null,
    hardwareProfile: null,
    hardwareCapabilities: null,
    deviceMetadata: {
      schemaVersion: 1,
      storage: "sha256-digest",
    },
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
  };

  const prisma = {
    robot: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    auditEvent: {
      findMany: jest.fn(),
    },
    course: {
      findMany: jest.fn(),
    },
    orgCourseAccess: {
      findMany: jest.fn(),
    },
    robotCourseAccess: {
      findMany: jest.fn(),
    },
    userCourseAccess: {
      findMany: jest.fn(),
    },
    event: {
      create: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    capability: {
      findUnique: jest.fn(),
    },
    organizationSubscription: {
      findFirst: jest.fn(),
    },
    organizationCapabilityOverride: {
      findMany: jest.fn(),
    },
    robotCapabilityAssignment: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    userCapabilityAssignment: {
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const audit = {
    recordCritical: jest.fn(),
    sanitizeMetadata: jest.fn((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const clean: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (
          /password|passcode|token|jwt|secret|authorization|cookie|hash|apiKey|licenseKey|privateKey|accessKey|refreshToken/i.test(
            key,
          )
        ) {
          continue;
        }
        clean[key] = item;
      }
      return clean;
    }),
  };

  let service: RobotsService;

  beforeEach(() => {
    jest.resetAllMocks();
    audit.sanitizeMetadata.mockImplementation((value: unknown) => {
      if (!value || typeof value !== "object" || Array.isArray(value))
        return value;
      const clean: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(
        value as Record<string, unknown>,
      )) {
        if (
          /password|passcode|token|jwt|secret|authorization|cookie|hash|apiKey|licenseKey|privateKey|accessKey|refreshToken/i.test(
            key,
          )
        ) {
          continue;
        }
        clean[key] = item;
      }
      return clean;
    });
    prisma.course.findMany.mockResolvedValue([]);
    prisma.orgCourseAccess.findMany.mockResolvedValue([]);
    prisma.robotCourseAccess.findMany.mockResolvedValue([]);
    prisma.userCourseAccess.findMany.mockResolvedValue([]);
    const entitlements = new EntitlementsService(prisma as any);
    service = new RobotsService(
      prisma as any,
      audit as any,
      entitlements,
      new RobotManifestResolver(entitlements),
    );
  });

  it("clears stored device metadata and records a critical audit event", async () => {
    const tx = {
      robot: {
        update: jest
          .fn()
          .mockResolvedValue({
            ...robot,
            appVersion: null,
            deviceMetadata: null,
          }),
      },
    };

    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.clearDeviceMetadata(
      10,
      { userId: 1, orgId: 1, isSuperAdmin: false },
      "request-123",
    );

    expect(tx.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        appVersion: null,
        deviceModel: null,
        deviceMetadata: Prisma.DbNull,
      },
      select: expect.any(Object),
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: 1, isSuperAdmin: false },
        action: "robot.device_metadata_erased",
        targetType: "robot",
        targetId: 10,
        targetOrgId: 1,
        correlationId: "request-123",
        metadata: {
          serialNumber: "WR-001",
        },
      },
      tx,
    );
    expect(result.appVersion).toBeNull();
  });

  it("blocks device metadata erasure across organizations", async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);

    await expect(
      service.clearDeviceMetadata(10, {
        userId: 2,
        orgId: 2,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it("enrolls a robot with a one-time license key and records a redacted audit event", async () => {
    const licenseKey = "WHRB123456";
    const enrolledRobot = {
      id: robot.id,
      orgId: robot.orgId,
      serialNumber: robot.serialNumber,
      name: robot.name,
      validFrom: robot.validFrom,
      validUntil: robot.validUntil,
      licenseStatus: robot.licenseStatus,
      revokedAt: robot.revokedAt,
      lastSeenAt: null,
      appVersion: null,
      deviceModel: null,
      hardwareModel: null,
      hardwareProfile: null,
      hardwareCapabilities: null,
      deviceMetadata: null,
      createdAt: robot.createdAt,
      updatedAt: robot.updatedAt,
      licenseKey,
    };
    const tx = {
      robot: {
        create: jest.fn().mockResolvedValue(enrolledRobot),
      },
    };

    prisma.robot.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.createRobot(
      {
        orgId: 1,
        serialNumber: "WR-001",
        name: "Demo Robot",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2027-01-01T00:00:00.000Z"),
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      "enroll-123",
    );

    expect(tx.robot.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        serialNumber: "WR-001",
        name: "Demo Robot",
        licenseKey: null,
        licenseKeyCiphertext: expect.stringMatching(/^v1:/),
        licenseKeyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2027-01-01T00:00:00.000Z"),
        licenseStatus: LicenseStatus.ACTIVE,
        hardwareModel: null,
        hardwareProfile: Prisma.JsonNull,
        hardwareCapabilities: Prisma.JsonNull,
      },
      select: expect.objectContaining({ licenseKey: true }),
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: "robot.enrolled",
        targetType: "robot",
        targetId: 10,
        targetOrgId: 1,
        correlationId: "enroll-123",
        metadata: {
          serialNumber: "WR-001",
          licenseStatus: LicenseStatus.ACTIVE,
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2027-01-01T00:00:00.000Z"),
          hardwareModel: null,
        },
      },
      tx,
    );
    expect(result).toHaveProperty("licenseKey", licenseKey);
  });

  it("rejects duplicate robot serials before generating credentials or writing audit events", async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 99 });

    await expect(
      service.createRobot(
        {
          orgId: 1,
          serialNumber: "WR-001",
          name: "Duplicate Robot",
          validFrom: new Date("2026-01-01T00:00:00.000Z"),
          validUntil: new Date("2027-01-01T00:00:00.000Z"),
        },
        { userId: 1, orgId: null, isSuperAdmin: true },
        "duplicate-123",
      ),
    ).rejects.toThrow(ConflictException);

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { serialNumber: "WR-001" },
      select: { id: true },
    });
    expect(prisma.robot.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it("stores a validated hardware profile with effective safety-filtered capabilities", async () => {
    const enrolledRobot = {
      ...robot,
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
    };
    const tx = {
      robot: {
        create: jest.fn().mockResolvedValue(enrolledRobot),
      },
    };

    prisma.robot.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.createRobot(
      {
        orgId: 1,
        serialNumber: "WR-001",
        name: "Demo Robot",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2027-01-01T00:00:00.000Z"),
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
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      "hardware-123",
    );

    expect(tx.robot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
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
      }),
      select: expect.any(Object),
    });
    expect(result.hardwareCapabilities).toEqual(
      expect.objectContaining({
        autonomousNavigation: false,
        armMotion: false,
      }),
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).toEqual(
      expect.objectContaining({
        hardwareModel: "MINI_ELF",
      }),
    );
  });

  it("rejects invalid hardware profile values before persistence", async () => {
    await expect(
      service.createRobot({
        orgId: 1,
        serialNumber: "WR-001",
        name: "Demo Robot",
        validFrom: new Date("2026-01-01T00:00:00.000Z"),
        validUntil: new Date("2027-01-01T00:00:00.000Z"),
        hardwareProfile: {
          model: "MINI_ELF",
          androidApiLevel: 31,
          abi: "arm64-v8a",
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.robot.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("does not include license keys in normal organization robot lists", async () => {
    prisma.robot.findMany.mockResolvedValue([]);

    await service.listByOrg(1);

    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      where: { orgId: 1 },
      orderBy: { id: "desc" },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
  });

  it("applies organization fleet filters without exposing license keys", async () => {
    prisma.robot.findMany.mockResolvedValue([]);

    await service.listByOrg(1, {
      status: LicenseStatus.ACTIVE,
      model: "MINI_ELF",
      version: "0.1.0",
      lastSeenFrom: new Date("2026-09-01T00:00:00.000Z"),
      lastSeenTo: new Date("2026-09-21T00:00:00.000Z"),
      limit: 25,
    });

    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      where: {
        orgId: 1,
        licenseStatus: LicenseStatus.ACTIVE,
        hardwareModel: "MINI_ELF",
        appVersion: "0.1.0",
        lastSeenAt: {
          gte: new Date("2026-09-01T00:00:00.000Z"),
          lte: new Date("2026-09-21T00:00:00.000Z"),
        },
      },
      orderBy: { id: "desc" },
      take: 25,
      select: expect.not.objectContaining({ licenseKey: true }),
    });
  });

  it("includes license keys in super admin robot lists", async () => {
    prisma.robot.findMany.mockResolvedValue([]);

    await service.listAll();

    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: "desc" },
      select: expect.objectContaining({
        licenseKey: true,
        licenseKeyCiphertext: true,
        org: { select: { id: true, name: true } },
      }),
    });
  });

  it("applies Super Admin fleet filters with protected license display fields", async () => {
    prisma.robot.findMany.mockResolvedValue([]);

    await service.listAll({
      orgId: 2,
      status: LicenseStatus.REVOKED,
      model: "S5",
      version: "1.2.3",
      lastSeenFrom: new Date("2026-09-10T00:00:00.000Z"),
      limit: 500,
    });

    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      where: {
        orgId: 2,
        licenseStatus: LicenseStatus.REVOKED,
        hardwareModel: "S5",
        appVersion: "1.2.3",
        lastSeenAt: {
          gte: new Date("2026-09-10T00:00:00.000Z"),
        },
      },
      orderBy: { id: "desc" },
      take: 100,
      select: expect.objectContaining({
        licenseKey: true,
        licenseKeyCiphertext: true,
        org: { select: { id: true, name: true } },
      }),
    });
  });

  it("upserts a robot capability assignment with validated limits and audit event", async () => {
    const capability = {
      id: 1,
      stableKey: "audio.speaker",
      name: "Speaker Output",
      description: null,
      category: "audio",
      version: 1,
      requiredHardware: null,
      isActive: true,
    };
    const assignment = {
      id: 5,
      robotId: 10,
      capabilityId: 1,
      isEnabled: true,
      limits: { maxVolume: 80, modes: ["classroom"] },
      createdByUserId: 1,
      createdAt: new Date("2026-09-25T10:00:00.000Z"),
      updatedAt: new Date("2026-09-25T10:00:00.000Z"),
      capability,
      robot: { orgId: 1 },
    };
    const tx = {
      robotCapabilityAssignment: {
        upsert: jest.fn().mockResolvedValue(assignment),
      },
      organization: {
        update: jest.fn().mockResolvedValue({ id: 1, tenantVersion: 3 }),
      },
    };

    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.capability.findUnique.mockResolvedValue(capability);
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 1,
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        isActive: true,
        capabilities: [{ capability }],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);
    prisma.robotCapabilityAssignment.findUnique.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.upsertCapabilityAssignment(
      10,
      {
        capabilityStableKey: "audio.speaker",
        isEnabled: true,
        limits: { maxVolume: 80, modes: ["classroom"] },
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      "cap-assign-123",
    );

    expect(tx.robotCapabilityAssignment.upsert).toHaveBeenCalledWith({
      where: { robotId_capabilityId: { robotId: 10, capabilityId: 1 } },
      create: {
        robotId: 10,
        capabilityId: 1,
        isEnabled: true,
        limits: { maxVolume: 80, modes: ["classroom"] },
        createdByUserId: 1,
      },
      update: {
        isEnabled: true,
        limits: { maxVolume: 80, modes: ["classroom"] },
      },
      include: { capability: true, robot: { select: { orgId: true } } },
    });
    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: 1 },
      data: { tenantVersion: { increment: 1 } },
      select: { id: true, tenantVersion: true },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "robot.capability_assignment.upserted",
        targetType: "robot",
        targetId: 10,
        targetOrgId: 1,
        correlationId: "cap-assign-123",
        metadata: expect.objectContaining({
          capabilityStableKey: "audio.speaker",
          previous: null,
          next: expect.objectContaining({
            limits: { maxVolume: 80, modes: ["classroom"] },
            tenantVersion: 3,
          }),
        }),
      }),
      tx,
    );
    expect(result).toEqual(
      expect.objectContaining({
        robotId: 10,
        orgId: 1,
        capabilityStableKey: "audio.speaker",
        isEnabled: true,
        limits: { maxVolume: 80, modes: ["classroom"] },
      }),
    );
  });

  it("rejects robot capability assignment when limits contain prohibited secret keys", async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.capability.findUnique.mockResolvedValue({
      id: 1,
      stableKey: "audio.speaker",
      name: "Speaker Output",
      isActive: true,
    });
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      status: "ACTIVE",
      validFrom: new Date("2026-01-01T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      plan: {
        isActive: true,
        capabilities: [
          { capability: { id: 1, stableKey: "audio.speaker", isActive: true } },
        ],
      },
    });
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);

    await expect(
      service.upsertCapabilityAssignment(
        10,
        {
          capabilityStableKey: "audio.speaker",
          limits: { apiToken: "secret" },
        },
        { userId: 1, orgId: 1, isSuperAdmin: false },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it("rejects robot capability assignment across organizations before mutation", async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);

    await expect(
      service.upsertCapabilityAssignment(
        10,
        { capabilityStableKey: "audio.speaker", limits: { maxVolume: 80 } },
        { userId: 2, orgId: 2, isSuperAdmin: false },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.capability.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rotates robot credentials for Super Admin and records redacted audit metadata", async () => {
    const updatedRobot = {
      ...robot,
      licenseKey: "WHRB654321",
    };
    const tx = {
      robot: {
        update: jest.fn().mockResolvedValue(updatedRobot),
      },
    };

    prisma.robot.findUnique.mockResolvedValueOnce(robot);
    prisma.robot.findFirst.mockResolvedValue(null);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.rotateCredential(
      10,
      { userId: 1, orgId: null, isSuperAdmin: true },
      "rotate-123",
    );

    expect(tx.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        licenseKey: null,
        licenseKeyCiphertext: expect.stringMatching(/^v1:/),
        licenseKeyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
      select: expect.objectContaining({ licenseKey: true }),
    });
    expect(
      tx.robot.update.mock.calls[0][0].data.licenseKeyCiphertext,
    ).not.toContain("secret-license-key");
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: "robot.credential_rotated",
        targetType: "robot",
        targetId: 10,
        targetOrgId: 1,
        correlationId: "rotate-123",
        metadata: {
          serialNumber: "WR-001",
          licenseStatus: LicenseStatus.ACTIVE,
        },
      },
      tx,
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty(
      "licenseKey",
    );
    expect(result.licenseKey).toBe("WHRB654321");
  });

  it("blocks robot credential rotation for organization users", async () => {
    await expect(
      service.rotateCredential(10, {
        userId: 2,
        orgId: 1,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("revokes robot credentials for Super Admin without returning the license key", async () => {
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = robot;
    const tx = {
      robot: {
        update: jest.fn().mockResolvedValue({
          ...robotWithoutLicenseKey,
          licenseStatus: LicenseStatus.REVOKED,
          revokedAt: new Date("2026-09-11T00:00:00.000Z"),
        }),
      },
    };

    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.revokeCredential(
      10,
      { userId: 1, orgId: null, isSuperAdmin: true },
      "revoke-123",
    );

    expect(tx.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        revokedAt: expect.any(Date),
        licenseStatus: LicenseStatus.REVOKED,
      },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
    expect(result).not.toHaveProperty("licenseKey");
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: "robot.credential_revoked",
        targetType: "robot",
        targetId: 10,
        targetOrgId: 1,
        correlationId: "revoke-123",
        metadata: {
          serialNumber: "WR-001",
          previousLicenseStatus: LicenseStatus.ACTIVE,
        },
      },
      tx,
    );
  });

  it("renews an active license without returning credentials", async () => {
    const validUntil = new Date("2099-01-01T00:00:00.000Z");
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = robot;
    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.robot.update.mockResolvedValue({
      ...robotWithoutLicenseKey,
      validUntil,
      licenseStatus: LicenseStatus.ACTIVE,
    });

    const result = await service.renewLicense(10, validUntil);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { validUntil, licenseStatus: LicenseStatus.ACTIVE },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
    expect(result.licenseStatus).toBe(LicenseStatus.ACTIVE);
    expect(result).not.toHaveProperty("licenseKey");
  });

  it("marks a renewed license as expired when the new expiry is in the past", async () => {
    const validUntil = new Date("2020-01-01T00:00:00.000Z");
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = robot;
    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.robot.update.mockResolvedValue({
      ...robotWithoutLicenseKey,
      validUntil,
      licenseStatus: LicenseStatus.EXPIRED,
    });

    const result = await service.renewLicense(10, validUntil);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { validUntil, licenseStatus: LicenseStatus.EXPIRED },
      select: expect.any(Object),
    });
    expect(result.licenseStatus).toBe(LicenseStatus.EXPIRED);
  });

  it("restores a revoked license when a robot is unlocked and the license is valid", async () => {
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = robot;
    prisma.robot.findUnique.mockResolvedValue({
      ...robot,
      revokedAt: new Date("2026-09-11T00:00:00.000Z"),
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      licenseStatus: LicenseStatus.REVOKED,
    });
    prisma.robot.update.mockResolvedValue({
      ...robotWithoutLicenseKey,
      revokedAt: null,
      validUntil: new Date("2099-01-01T00:00:00.000Z"),
      licenseStatus: LicenseStatus.ACTIVE,
    });

    const result = await service.lockRobot(10, false);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { revokedAt: null, licenseStatus: LicenseStatus.ACTIVE },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
    expect(result.licenseStatus).toBe(LicenseStatus.ACTIVE);
  });

  it("blocks robot credential revocation for organization users", async () => {
    await expect(
      service.revokeCredential(10, {
        userId: 2,
        orgId: 1,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("reassigns a robot, bumps tenant versions and records a sanitized audit event", async () => {
    const tx = {
      organization: {
        update: jest
          .fn()
          .mockResolvedValueOnce({ id: 1 })
          .mockResolvedValueOnce({ id: 2, tenantVersion: 6 }),
      },
      robot: {
        update: jest.fn().mockResolvedValue({
          ...robot,
          orgId: 2,
          org: { id: 2, name: "Target School", tenantVersion: 6 },
        }),
      },
    };

    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.organization.findUnique.mockResolvedValue({ id: 2, isActive: true });
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.reassignRobot(
      10,
      2,
      { userId: 1, orgId: null, isSuperAdmin: true },
      "reassign-123",
    );

    expect(tx.organization.update).toHaveBeenNthCalledWith(1, {
      where: { id: 1 },
      data: { tenantVersion: { increment: 1 } },
      select: { id: true },
    });
    expect(tx.organization.update).toHaveBeenNthCalledWith(2, {
      where: { id: 2 },
      data: { tenantVersion: { increment: 1 } },
      select: { id: true, tenantVersion: true },
    });
    expect(tx.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: { orgId: 2 },
      select: expect.objectContaining({
        id: true,
        orgId: true,
        org: { select: { id: true, name: true, tenantVersion: true } },
      }),
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: "robot.reassigned",
        targetType: "robot",
        targetId: 10,
        targetOrgId: 2,
        correlationId: "reassign-123",
        metadata: {
          serialNumber: "WR-001",
          oldOrgId: 1,
          newOrgId: 2,
          newTenantVersion: 6,
        },
      },
      tx,
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty(
      "licenseKey",
    );
    expect(result).not.toBeNull();
    expect(result?.orgId).toBe(2);
  });

  it("returns sanitized robot reassignment history for an authorized actor", async () => {
    prisma.robot.findUnique.mockResolvedValue({
      ...robot,
      licenseKeyCiphertext: "secret-ciphertext",
    });
    prisma.auditEvent.findMany.mockResolvedValue([
      {
        id: 101,
        actorUserId: 1,
        actorOrgId: null,
        action: "robot.reassigned",
        targetType: "robot",
        targetId: "10",
        targetOrgId: 2,
        correlationId: "history-123",
        metadata: {
          serialNumber: "WR-001",
          oldOrgId: 1,
          newOrgId: 2,
          newTenantVersion: 6,
          licenseKey: "SHOULD_NOT_RETURN",
        },
        createdAt: new Date("2026-09-20T10:00:00.000Z"),
      },
    ]);

    const result = await service.listReassignmentHistory(
      10,
      { orgId: null, isSuperAdmin: true },
      25,
    );

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: {
        action: "robot.reassigned",
        targetType: "robot",
        targetId: "10",
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    expect(result).toEqual([
      {
        id: 101,
        robotId: 10,
        actorUserId: 1,
        actorOrgId: null,
        oldOrgId: 1,
        newOrgId: 2,
        targetOrgId: 2,
        correlationId: "history-123",
        createdAt: new Date("2026-09-20T10:00:00.000Z"),
      },
    ]);
    expect(result[0]).not.toHaveProperty("licenseKey");
    expect(result[0]).not.toHaveProperty("metadata");
  });

  it("blocks robot reassignment history across organizations before reading audit events", async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);

    await expect(
      service.listReassignmentHistory(10, { orgId: 2, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("returns current robot detail with sanitized audit history", async () => {
    prisma.robot.findUnique.mockResolvedValue({
      ...robot,
      org: {
        id: 1,
        name: "Demo Org",
        isActive: true,
        tenantVersion: 4,
      },
    });
    prisma.auditEvent.findMany.mockResolvedValue([
      {
        id: 201,
        actorUserId: 1,
        actorOrgId: null,
        action: "robot.credential_rotated",
        targetType: "robot",
        targetId: "10",
        targetOrgId: 1,
        correlationId: "audit-123",
        metadata: {
          serialNumber: "WR-001",
          licenseKey: "SHOULD_NOT_RETURN",
          refreshToken: "SHOULD_NOT_RETURN",
          licenseStatus: LicenseStatus.ACTIVE,
        },
        createdAt: new Date("2026-09-20T10:00:00.000Z"),
      },
    ]);

    const result = await service.getDetail(
      10,
      { orgId: 1, isSuperAdmin: false },
      25,
    );

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { id: 10 },
      select: expect.objectContaining({
        org: {
          select: {
            id: true,
            name: true,
            isActive: true,
            tenantVersion: true,
          },
        },
      }),
    });
    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: {
        targetType: "robot",
        targetId: "10",
      },
      orderBy: { createdAt: "desc" },
      take: 25,
    });
    expect(result.robot).not.toHaveProperty("licenseKey");
    expect(result.robot).not.toHaveProperty("licenseKeyCiphertext");
    expect(result.robot).not.toHaveProperty("licenseKeyFingerprint");
    expect(result.license).toEqual({
      status: LicenseStatus.ACTIVE,
      validFrom: robot.validFrom,
      validUntil: robot.validUntil,
      revokedAt: null,
    });
    expect(result.auditHistory[0].metadata).toEqual({
      serialNumber: "WR-001",
      licenseStatus: LicenseStatus.ACTIVE,
    });
  });

  it("returns a tenant-scoped effective manifest preview without license secrets", async () => {
    prisma.robot.findUnique.mockResolvedValue({
      ...robot,
      org: {
        id: 1,
        name: "Demo Org",
        isActive: true,
        logoUrl: "https://assets.whizrobo.test/orgs/demo-logo.png",
        primaryColor: "#1D4ED8",
        secondaryColor: "#F97316",
        tenantVersion: 4,
      },
    });
    prisma.organizationSubscription.findFirst.mockResolvedValue(null);
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([]);
    prisma.userCapabilityAssignment.findMany.mockResolvedValue([]);

    const result = await service.getManifestPreview(
      10,
      { orgId: 1, isSuperAdmin: false },
      0,
    );

    expect((result as any).schemaVersion).toBe(1);
    expect((result as any).manifestVersion).toBe("1.0.0");
    expect((result as any).tenant).toEqual(
      expect.objectContaining({
        orgId: 1,
        orgName: "Demo Org",
        cacheVersion: "org-1-v4",
      }),
    );
    expect((result as any).policies.appUpdate).toEqual(
      expect.objectContaining({
        currentVersionCode: 0,
        updateRequired: true,
        updateRecommended: true,
      }),
    );
    expect((result as any).sync.manifestHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(result)).not.toMatch(
      /licenseKey|token|password|secret/i,
    );
  });

  it("matches the robot sync manifest contract with secrets removed", async () => {
    const orgOwnedCourse = {
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
    const robotWithOrg = {
      ...robot,
      org: {
        id: 1,
        name: "Demo Org",
        isActive: true,
        logoUrl: "https://assets.whizrobo.test/orgs/demo-logo.png",
        primaryColor: "#1D4ED8",
        secondaryColor: "#F97316",
        tenantVersion: 4,
      },
    };
    prisma.robot.findUnique.mockResolvedValue(robotWithOrg);
    prisma.course.findMany
      .mockResolvedValueOnce([orgOwnedCourse])
      .mockResolvedValueOnce([publicCourse])
      .mockResolvedValueOnce([orgOwnedCourse])
      .mockResolvedValueOnce([publicCourse]);
    prisma.orgCourseAccess.findMany
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    prisma.robot.update.mockResolvedValue({});
    prisma.organizationSubscription.findFirst.mockResolvedValue(null);
    prisma.organizationCapabilityOverride.findMany.mockResolvedValue([]);
    prisma.robotCapabilityAssignment.findMany.mockResolvedValue([]);
    prisma.robotCourseAccess.findMany.mockResolvedValue([]);
    prisma.userCourseAccess.findMany.mockResolvedValue([]);
    prisma.userCapabilityAssignment.findMany.mockResolvedValue([]);

    const entitlements = new EntitlementsService(prisma as any);
    const syncService = new RobotSyncService(
      prisma as any,
      new RobotManifestResolver(entitlements),
    );

    const preview = (await service.getManifestPreview(
      10,
      { orgId: 1, isSuperAdmin: false },
      2,
    )) as any;
    const sync = (await syncService.sync(10, { appVersionCode: 2 })) as any;

    for (const key of [
      "schemaVersion",
      "manifestVersion",
      "locked",
      "tenant",
      "license",
      "capabilities",
      "policies",
      "contentVersions",
      "myCourses",
      "publicCatalog",
    ]) {
      expect(preview[key]).toEqual(sync[key]);
    }
    expect(preview.sync.configVersion).toBe(sync.sync.configVersion);
    expect(preview.sync.manifestHash).toBe(sync.sync.manifestHash);
    expect(JSON.stringify(preview)).not.toMatch(
      /licenseKey|licenseKeyCiphertext|licenseKeyFingerprint|token|password|secret/i,
    );
  });

  it("blocks manifest preview across organizations before resolving manifest", async () => {
    prisma.robot.findUnique.mockResolvedValue({
      ...robot,
      org: {
        id: 1,
        name: "Demo Org",
        isActive: true,
        logoUrl: null,
        primaryColor: null,
        secondaryColor: null,
        tenantVersion: 4,
      },
    });

    await expect(
      service.getManifestPreview(10, { orgId: 2, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.course.findMany).not.toHaveBeenCalled();
    expect(prisma.orgCourseAccess.findMany).not.toHaveBeenCalled();
    expect(prisma.organizationSubscription.findFirst).not.toHaveBeenCalled();
  });

  it("blocks robot detail across organizations before reading audit events", async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);

    await expect(
      service.getDetail(10, { orgId: 2, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.auditEvent.findMany).not.toHaveBeenCalled();
  });

  it("keeps same-org reassignment idempotent without cache bumps or audit writes", async () => {
    prisma.robot.findUnique.mockResolvedValueOnce(robot).mockResolvedValueOnce({
      ...robot,
      org: { id: 1, name: "Demo School", tenantVersion: 4 },
    });

    const result = await service.reassignRobot(
      10,
      1,
      { userId: 1, orgId: null, isSuperAdmin: true },
      "same-org-123",
    );

    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
    expect(result?.orgId).toBe(1);
  });

  it("blocks robot reassignment for organization users before mutation", async () => {
    await expect(
      service.reassignRobot(10, 2, {
        userId: 2,
        orgId: 1,
        isSuperAdmin: false,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("rejects reassignment to an inactive organization before mutation", async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.organization.findUnique.mockResolvedValue({
      id: 2,
      isActive: false,
    });

    await expect(
      service.reassignRobot(10, 2, {
        userId: 1,
        orgId: null,
        isSuperAdmin: true,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });
});
