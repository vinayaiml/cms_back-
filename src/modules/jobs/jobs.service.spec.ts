import { ConfigService } from '@nestjs/config';
import { LicenseStatus, Prisma } from '@prisma/client';
import { JobsService } from './jobs.service';

describe('JobsService license expiry scan', () => {
  const expiredAt = new Date('2026-09-01T00:00:00.000Z');

  const prisma = {
    robot: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    identityEmbeddingRecord: {
      findMany: jest.fn(),
      updateMany: jest.fn(),
    },
    notification: {
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  let service: JobsService;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-23T00:00:00.000Z'));
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    audit.recordCritical.mockResolvedValue({ id: 1 });
    service = new JobsService(
      { get: jest.fn() } as unknown as ConfigService,
      prisma as any,
      audit as any,
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('expires an active robot license and creates one stable notification across repeated scans', async () => {
    const activeExpiredRobot = {
      id: 10,
      orgId: 1,
      serialNumber: 'TEST-EXPIRED-001',
      validUntil: expiredAt,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      licenseStatus: LicenseStatus.ACTIVE,
      revokedAt: null,
    };
    const alreadyExpiredRobot = {
      ...activeExpiredRobot,
      licenseStatus: LicenseStatus.EXPIRED,
    };

    prisma.robot.findMany
      .mockResolvedValueOnce([activeExpiredRobot])
      .mockResolvedValueOnce([alreadyExpiredRobot]);
    prisma.robot.updateMany.mockResolvedValue({ count: 1 });
    prisma.notification.findFirst
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 99, orgId: 1, type: 'LICENSE_EXPIRED' });
    prisma.notification.create.mockResolvedValue({ id: 99 });

    await (service as any).runLicenseScan();
    await (service as any).runLicenseScan();

    expect(prisma.robot.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.robot.updateMany).toHaveBeenCalledWith({
      where: { id: 10, licenseStatus: { not: LicenseStatus.EXPIRED } },
      data: { licenseStatus: LicenseStatus.EXPIRED },
    });

    expect(prisma.notification.create).toHaveBeenCalledTimes(1);
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        orgId: 1,
        type: 'LICENSE_EXPIRED',
        title: 'Robot license expired',
        message: `Robot TEST-EXPIRED-001 license expired on ${expiredAt.toISOString()}. Robot is now locked.`,
        payload: {
          robotId: 10,
          serialNumber: 'TEST-EXPIRED-001',
          validUntil: expiredAt.toISOString(),
        },
      },
    });

    const notificationPayload = prisma.notification.create.mock.calls[0][0].data.payload;
    expect(notificationPayload).not.toHaveProperty('licenseKey');
    expect(notificationPayload).not.toHaveProperty('token');
    expect(notificationPayload).not.toHaveProperty('licenseKeyCiphertext');
    expect(notificationPayload).not.toHaveProperty('licenseKeyFingerprint');
  });

  it('does not expire revoked licenses or create expiry notifications for them', async () => {
    prisma.robot.findMany.mockResolvedValue([
      {
        id: 11,
        orgId: 1,
        serialNumber: 'TEST-REVOKED-001',
        validUntil: expiredAt,
        validFrom: new Date('2026-01-01T00:00:00.000Z'),
        licenseStatus: LicenseStatus.REVOKED,
        revokedAt: new Date('2026-08-01T00:00:00.000Z'),
      },
    ]);

    await (service as any).runLicenseScan();

    expect(prisma.robot.updateMany).not.toHaveBeenCalled();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it('treats duplicate notification writes as already handled for batch-safe retries', async () => {
    const duplicateError = new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: 'unit-test',
    });

    prisma.notification.findFirst.mockResolvedValue(null);
    prisma.notification.create.mockRejectedValue(duplicateError);

    await expect(
      (service as any).createOrgNotification({
        orgId: 1,
        type: 'LICENSE_EXPIRED',
        title: 'Robot license expired',
        message: 'Robot TEST-EXPIRED-001 license expired on 2026-09-01T00:00:00.000Z. Robot is now locked.',
        payload: {
          robotId: 10,
          serialNumber: 'TEST-EXPIRED-001',
          validUntil: expiredAt.toISOString(),
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('deletes expired identity records and writes one sanitized retention audit event', async () => {
    const retentionExpiresAt = new Date('2026-09-01T00:00:00.000Z');
    prisma.identityEmbeddingRecord.findMany.mockResolvedValue([
      {
        id: 40,
        orgId: 1,
        subjectRef: 'visitor.demo-001',
        retentionExpiresAt,
        embeddingSchemaVersion: 1,
      },
    ]);
    prisma.identityEmbeddingRecord.updateMany.mockResolvedValue({ count: 1 });

    await (service as any).runIdentityRetentionScan();

    expect(prisma.identityEmbeddingRecord.updateMany).toHaveBeenCalledWith({
      where: {
        id: 40,
        status: 'ACTIVE',
        deletedAt: null,
        retentionExpiresAt: { lte: new Date('2026-09-23T00:00:00.000Z') },
      },
      data: {
        status: 'DELETED',
        embeddingCiphertext: null,
        embeddingFingerprint: null,
        deletedAt: new Date('2026-09-23T00:00:00.000Z'),
        deletionReason: 'retention_expired',
      },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: { userId: null, orgId: null, isSuperAdmin: true },
        action: 'identity_embedding.retention_deleted',
        targetType: 'identity_embedding',
        targetId: 40,
        targetOrgId: 1,
        metadata: {
          subjectRef: 'visitor.demo-001',
          status: 'DELETED',
          reason: 'retention_expired',
          retentionExpiresAt: retentionExpiresAt.toISOString(),
          embeddingSchemaVersion: 1,
        },
      }),
      prisma,
    );
    expect(JSON.stringify(audit.recordCritical.mock.calls[0][0])).not.toMatch(
      /embeddingCiphertext|embeddingMetadata|licenseKey|token|secret|@/i,
    );
  });

  it('does not audit already processed identity retention rows during retries', async () => {
    prisma.identityEmbeddingRecord.findMany.mockResolvedValue([
      {
        id: 41,
        orgId: 1,
        subjectRef: 'visitor.demo-002',
        retentionExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
        embeddingSchemaVersion: 1,
      },
    ]);
    prisma.identityEmbeddingRecord.updateMany.mockResolvedValue({ count: 0 });

    await (service as any).runIdentityRetentionScan();

    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it('redacts unsafe legacy subject references in identity retention audit metadata', async () => {
    prisma.identityEmbeddingRecord.findMany.mockResolvedValue([
      {
        id: 42,
        orgId: 1,
        subjectRef: '9876543210',
        retentionExpiresAt: new Date('2026-09-01T00:00:00.000Z'),
        embeddingSchemaVersion: 1,
      },
    ]);
    prisma.identityEmbeddingRecord.updateMany.mockResolvedValue({ count: 1 });

    await (service as any).runIdentityRetentionScan();

    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          subjectRef: '[redacted]',
        }),
      }),
      prisma,
    );
  });
});
