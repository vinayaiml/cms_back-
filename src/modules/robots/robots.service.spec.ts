import { ForbiddenException } from '@nestjs/common';
import { Prisma, LicenseStatus } from '@prisma/client';
import { RobotsService } from './robots.service';

describe('RobotsService device metadata', () => {
  const robot = {
    id: 10,
    orgId: 1,
    serialNumber: 'WR-001',
    name: 'Demo Robot',
    licenseKey: 'secret-license-key',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: new Date('2027-01-01T00:00:00.000Z'),
    licenseStatus: LicenseStatus.ACTIVE,
    revokedAt: null,
    lastSeenAt: new Date('2026-01-02T00:00:00.000Z'),
    appVersion: '0.1.0',
    deviceModel: null,
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
    },
    $transaction: jest.fn(),
  };

  const audit = {
    recordCritical: jest.fn(),
  };

  let service: RobotsService;

  beforeEach(() => {
    jest.clearAllMocks();
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

  it('enrolls a robot without returning the license key and records a redacted audit event', async () => {
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
      deviceMetadata: null,
      createdAt: robot.createdAt,
      updatedAt: robot.updatedAt,
    };
    const tx = {
      robot: {
        create: jest.fn().mockResolvedValue(enrolledRobot),
      },
    };

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
        licenseKey: expect.stringMatching(/^[a-f0-9]{64}$/),
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        validUntil: new Date('2027-01-01T00:00:00.000Z'),
        licenseStatus: LicenseStatus.ACTIVE,
      },
      select: expect.not.objectContaining({ licenseKey: true }),
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
        },
      },
      tx,
    );
    expect(result).not.toHaveProperty('licenseKey');
  });
});
