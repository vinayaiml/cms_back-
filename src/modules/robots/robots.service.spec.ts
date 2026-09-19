import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { Prisma, LicenseStatus } from '@prisma/client';
import { RobotsService } from './robots.service';

process.env.LICENSE_SECRET_KEY = 'unit-test-license-secret-minimum-32-characters';

describe('RobotsService device metadata', () => {
  const robot = {
    id: 10,
    orgId: 1,
    serialNumber: 'WR-001',
    name: 'Demo Robot',
    licenseKey: 'secret-license-key',
    licenseKeyCiphertext: null,
    licenseKeyFingerprint: null,
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: new Date('2027-01-01T00:00:00.000Z'),
    licenseStatus: LicenseStatus.ACTIVE,
    revokedAt: null,
    lastSeenAt: new Date('2026-01-02T00:00:00.000Z'),
    appVersion: '0.1.0',
    deviceModel: null,
    hardwareModel: null,
    hardwareProfile: null,
    hardwareCapabilities: null,
    deviceMetadata: {
      schemaVersion: 1,
      storage: 'sha256-digest',
    },
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
  };

  const prisma = {
    robot: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    organization: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const audit = {
    recordCritical: jest.fn(),
  };

  let service: RobotsService;

  beforeEach(() => {
    jest.resetAllMocks();
    service = new RobotsService(prisma as any, audit as any);
  });

  it('clears stored device metadata and records a critical audit event', async () => {
    const tx = {
      robot: {
        update: jest.fn().mockResolvedValue({ ...robot, appVersion: null, deviceMetadata: null }),
      },
    };

    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.clearDeviceMetadata(
      10,
      { userId: 1, orgId: 1, isSuperAdmin: false },
      'request-123',
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
        action: 'robot.device_metadata_erased',
        targetType: 'robot',
        targetId: 10,
        targetOrgId: 1,
        correlationId: 'request-123',
        metadata: {
          serialNumber: 'WR-001',
        },
      },
      tx,
    );
    expect(result.appVersion).toBeNull();
  });

  it('blocks device metadata erasure across organizations', async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);

    await expect(
      service.clearDeviceMetadata(10, { userId: 2, orgId: 2, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it('enrolls a robot with a one-time license key and records a redacted audit event', async () => {
    const licenseKey = 'WHRB123456';
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
        serialNumber: 'WR-001',
        name: 'Demo Robot',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      'enroll-123',
    );

    expect(tx.robot.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        serialNumber: 'WR-001',
        name: 'Demo Robot',
        licenseKey: null,
        licenseKeyCiphertext: expect.stringMatching(/^v1:/),
        licenseKeyFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
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
        action: 'robot.enrolled',
        targetType: 'robot',
        targetId: 10,
        targetOrgId: 1,
        correlationId: 'enroll-123',
        metadata: {
          serialNumber: 'WR-001',
          licenseStatus: LicenseStatus.ACTIVE,
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
          hardwareModel: null,
        },
      },
      tx,
    );
    expect(result).toHaveProperty('licenseKey', licenseKey);
  });

  it('rejects duplicate robot serials before generating credentials or writing audit events', async () => {
    prisma.robot.findUnique.mockResolvedValue({ id: 99 });

    await expect(
      service.createRobot(
        {
          orgId: 1,
          serialNumber: 'WR-001',
          name: 'Duplicate Robot',
          validFrom: new Date('2026-01-01T00:00:00.000Z'),
          validUntil: new Date('2027-01-01T00:00:00.000Z'),
        },
        { userId: 1, orgId: null, isSuperAdmin: true },
        'duplicate-123',
      ),
    ).rejects.toThrow(ConflictException);

    expect(prisma.robot.findUnique).toHaveBeenCalledWith({
      where: { serialNumber: 'WR-001' },
      select: { id: true },
    });
    expect(prisma.robot.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it('stores a validated hardware profile with effective safety-filtered capabilities', async () => {
    const enrolledRobot = {
      ...robot,
      hardwareModel: 'MINI_ELF',
      hardwareProfile: {
        schemaVersion: 1,
        model: 'MINI_ELF',
        label: 'Mini ELF',
        manufacturer: 'Sanbot',
        androidApiLevel: 25,
        abi: 'arm64-v8a',
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
        serialNumber: 'WR-001',
        name: 'Demo Robot',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
        hardwareProfile: {
          model: 'MINI_ELF',
          manufacturer: 'Sanbot',
          androidApiLevel: 25,
          abi: 'arm64-v8a',
          display: { width: 1920, height: 1200 },
          capabilities: {
            camera: true,
            autonomousNavigation: true,
            armMotion: true,
          },
        },
      },
      { userId: 1, orgId: null, isSuperAdmin: true },
      'hardware-123',
    );

    expect(tx.robot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        hardwareModel: 'MINI_ELF',
        hardwareProfile: {
          schemaVersion: 1,
          model: 'MINI_ELF',
          label: 'Mini ELF',
          manufacturer: 'Sanbot',
          androidApiLevel: 25,
          abi: 'arm64-v8a',
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
        hardwareModel: 'MINI_ELF',
      }),
    );
  });

  it('rejects invalid hardware profile values before persistence', async () => {
    await expect(
      service.createRobot({
        orgId: 1,
        serialNumber: 'WR-001',
        name: 'Demo Robot',
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
        hardwareProfile: {
          model: 'MINI_ELF',
          androidApiLevel: 31,
          abi: 'arm64-v8a',
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.robot.findFirst).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('does not include license keys in normal organization robot lists', async () => {
    prisma.robot.findMany.mockResolvedValue([]);

    await service.listByOrg(1);

    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      where: { orgId: 1 },
      orderBy: { id: 'desc' },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
  });

  it('includes license keys in super admin robot lists', async () => {
    prisma.robot.findMany.mockResolvedValue([]);

    await service.listAll();

    expect(prisma.robot.findMany).toHaveBeenCalledWith({
      where: {},
      orderBy: { id: 'desc' },
      select: expect.objectContaining({
        licenseKey: true,
        licenseKeyCiphertext: true,
        org: { select: { id: true, name: true } },
      }),
    });
  });

  it('rotates robot credentials for Super Admin and records redacted audit metadata', async () => {
    const updatedRobot = {
      ...robot,
      licenseKey: 'WHRB654321',
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
      'rotate-123',
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
    expect(tx.robot.update.mock.calls[0][0].data.licenseKeyCiphertext).not.toContain('secret-license-key');
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: 'robot.credential_rotated',
        targetType: 'robot',
        targetId: 10,
        targetOrgId: 1,
        correlationId: 'rotate-123',
        metadata: {
          serialNumber: 'WR-001',
          licenseStatus: LicenseStatus.ACTIVE,
        },
      },
      tx,
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty('licenseKey');
    expect(result.licenseKey).toBe('WHRB654321');
  });

  it('blocks robot credential rotation for organization users', async () => {
    await expect(
      service.rotateCredential(10, { userId: 2, orgId: 1, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('revokes robot credentials for Super Admin without returning the license key', async () => {
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = robot;
    const tx = {
      robot: {
        update: jest.fn().mockResolvedValue({
          ...robotWithoutLicenseKey,
          licenseStatus: LicenseStatus.REVOKED,
          revokedAt: new Date('2026-09-11T00:00:00.000Z'),
        }),
      },
    };

    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.$transaction.mockImplementation((callback) => callback(tx));

    const result = await service.revokeCredential(
      10,
      { userId: 1, orgId: null, isSuperAdmin: true },
      'revoke-123',
    );

    expect(tx.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        revokedAt: expect.any(Date),
        licenseStatus: LicenseStatus.REVOKED,
      },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
    expect(result).not.toHaveProperty('licenseKey');
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: 'robot.credential_revoked',
        targetType: 'robot',
        targetId: 10,
        targetOrgId: 1,
        correlationId: 'revoke-123',
        metadata: {
          serialNumber: 'WR-001',
          previousLicenseStatus: LicenseStatus.ACTIVE,
        },
      },
      tx,
    );
  });

  it('blocks robot credential revocation for organization users', async () => {
    await expect(
      service.revokeCredential(10, { userId: 2, orgId: 1, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reassigns a robot, bumps tenant versions and records a sanitized audit event', async () => {
    const tx = {
      organization: {
        update: jest.fn()
          .mockResolvedValueOnce({ id: 1 })
          .mockResolvedValueOnce({ id: 2, tenantVersion: 6 }),
      },
      robot: {
        update: jest.fn().mockResolvedValue({
          ...robot,
          orgId: 2,
          org: { id: 2, name: 'Target School', tenantVersion: 6 },
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
      'reassign-123',
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
        action: 'robot.reassigned',
        targetType: 'robot',
        targetId: 10,
        targetOrgId: 2,
        correlationId: 'reassign-123',
        metadata: {
          serialNumber: 'WR-001',
          oldOrgId: 1,
          newOrgId: 2,
          newTenantVersion: 6,
        },
      },
      tx,
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty('licenseKey');
    expect(result).not.toBeNull();
    expect(result?.orgId).toBe(2);
  });

  it('blocks robot reassignment for organization users before mutation', async () => {
    await expect(
      service.reassignRobot(10, 2, { userId: 2, orgId: 1, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.robot.findUnique).not.toHaveBeenCalled();
    expect(prisma.organization.findUnique).not.toHaveBeenCalled();
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('rejects reassignment to an inactive organization before mutation', async () => {
    prisma.robot.findUnique.mockResolvedValue(robot);
    prisma.organization.findUnique.mockResolvedValue({ id: 2, isActive: false });

    await expect(
      service.reassignRobot(10, 2, { userId: 1, orgId: null, isSuperAdmin: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });
});
