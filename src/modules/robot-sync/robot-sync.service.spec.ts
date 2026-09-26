import { BadRequestException } from '@nestjs/common';
import { LicenseStatus, SubscriptionStatus } from '@prisma/client';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { PrismaService } from '../../prisma/prisma.service';
import { RobotSyncService } from './robot-sync.service';

function buildRobot(overrides: Record<string, unknown> = {}) {
  return {
    id: 10,
    orgId: 1,
    serialNumber: 'TEST-ACTIVE-001',
    name: 'Test Robot',
    licenseKey: 'WHRB900001',
    validFrom: new Date('2026-01-01T00:00:00.000Z'),
    validUntil: new Date('2099-01-01T00:00:00.000Z'),
    licenseStatus: LicenseStatus.ACTIVE,
    revokedAt: null,
    appVersion: null,
    deviceModel: null,
    deviceMetadata: null,
    hardwareModel: null,
    hardwareProfile: null,
    hardwareCapabilities: null,
    lastSeenAt: null,
    updatedAt: new Date('2026-01-02T00:00:00.000Z'),
    org: {
      id: 1,
      name: 'Demo School',
      isActive: true,
      logoUrl: 'https://assets.whizrobo.test/orgs/demo-school-logo.png',
      primaryColor: '#1D4ED8',
      secondaryColor: '#F97316',
      tenantVersion: 1,
    },
    ...overrides,
  };
}

describe('RobotSyncService heartbeat updates', () => {
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
  };

  let service: RobotSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RobotSyncService(prisma as unknown as PrismaService);
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});
    prisma.course.findMany.mockResolvedValue([]);
    prisma.orgCourseAccess.findMany.mockResolvedValue([]);
    prisma.organizationSubscription.findFirst.mockResolvedValue(null);
  });

  it('updates last seen, app version and device model for the authenticated robot during sync', async () => {
    await service.sync(10, {
      appVersion: '0.1.0',
      deviceModel: 'Mini ELF',
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
        appVersion: '0.1.0',
        deviceModel: 'Mini ELF',
      },
    });
  });

  it('keeps sync idempotent by only touching the same robot heartbeat row', async () => {
    await service.sync(10);

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
      },
    });
    expect(prisma.event.create).not.toHaveBeenCalled();
  });

  it('returns safe organization context for the authenticated robot tenant', async () => {
    const result = await service.sync(10);

    expect(result).toEqual(
      expect.objectContaining({
        organization: {
          orgId: 1,
          orgName: 'Demo School',
          displayName: 'Demo School',
          logoUrl: 'https://assets.whizrobo.test/orgs/demo-school-logo.png',
          primaryColor: '#1D4ED8',
          secondaryColor: '#F97316',
          tenantVersion: 1,
          cacheVersion: 'org-1-v1',
        },
      }),
    );
    expect((result as any).organization).not.toHaveProperty('authorizedPersonName');
    expect((result as any).organization).not.toHaveProperty('contactNo');
  });

  it('returns distinct organization context for another tenant without cross-tenant leakage', async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        id: 11,
        orgId: 2,
        org: {
          id: 2,
          name: 'Test School 2',
          isActive: true,
          logoUrl: 'https://assets.whizrobo.test/orgs/test-school-2-logo.png',
          primaryColor: '#7C3AED',
          secondaryColor: '#22C55E',
          tenantVersion: 2,
        },
      }),
    );

    const result = await service.sync(11);

    expect((result as any).organization).toEqual({
      orgId: 2,
      orgName: 'Test School 2',
      displayName: 'Test School 2',
      logoUrl: 'https://assets.whizrobo.test/orgs/test-school-2-logo.png',
      primaryColor: '#7C3AED',
      secondaryColor: '#22C55E',
      tenantVersion: 2,
      cacheVersion: 'org-2-v2',
    });
    expect((result as any).organization.orgId).not.toBe(1);
  });

  it('returns active subscription paid capabilities exactly from the assigned plan', async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2099-01-01T00:00:00.000Z'),
      plan: {
        id: 2,
        stableKey: 'speech-plus',
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 2,
              stableKey: 'display.touch',
              name: 'Touch Display',
              description: null,
              category: 'display',
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
          {
            capability: {
              id: 1,
              stableKey: 'audio.speaker',
              name: 'Speaker Output',
              description: null,
              category: 'audio',
              version: 1,
              requiredHardware: null,
              isActive: true,
            },
          },
          {
            capability: {
              id: 9,
              stableKey: 'disabled.capability',
              name: 'Disabled',
              description: null,
              category: 'test',
              version: 1,
              requiredHardware: null,
              isActive: false,
            },
          },
        ],
      },
    });

    const result = await service.sync(10);

    expect(prisma.organizationSubscription.findFirst).toHaveBeenCalledWith({
      where: { orgId: 1 },
      orderBy: { updatedAt: 'desc' },
      include: expect.any(Object),
    });
    expect((result as any).entitlements.subscription).toEqual({
      status: 'ACTIVE',
      planId: 2,
      planStableKey: 'speech-plus',
      planVersion: 1,
      validFrom: new Date('2026-01-01T00:00:00.000Z'),
      validUntil: new Date('2099-01-01T00:00:00.000Z'),
    });
    expect((result as any).entitlements.paidCapabilities.map((capability: any) => capability.stableKey)).toEqual(['display.touch', 'audio.speaker']);
    expect(JSON.stringify((result as any).entitlements)).not.toMatch(/licenseKey|token|password|secret/i);
  });

  it('removes paid capabilities for an expired organization subscription', async () => {
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 1,
      orgId: 1,
      planId: 2,
      status: SubscriptionStatus.ACTIVE,
      validFrom: new Date('2025-01-01T00:00:00.000Z'),
      validUntil: new Date('2025-02-01T00:00:00.000Z'),
      plan: {
        id: 2,
        stableKey: 'starter',
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 1,
              stableKey: 'audio.speaker',
              name: 'Speaker Output',
              version: 1,
              isActive: true,
            },
          },
        ],
      },
    });

    const result = await service.sync(10);

    expect((result as any).entitlements.subscription.status).toBe('EXPIRED');
    expect((result as any).entitlements.paidCapabilities).toEqual([]);
  });

  it('stores the approved Android device and hardware profile for the authenticated robot', async () => {
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = buildRobot();
    prisma.robot.update.mockResolvedValue({
      ...robotWithoutLicenseKey,
      appVersion: '0.1.0',
      deviceModel: 'Mini ELF',
      deviceMetadata: {
        schemaVersion: 2,
        storage: 'approved-device-profile',
        manufacturer: 'Sanbot',
        model: 'Mini ELF',
        androidVersion: '7.1.2',
        apiLevel: 25,
        appVersionName: '0.1.0',
        appVersionCode: 2,
      },
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
    });

    const result = await service.updateDeviceProfile(10, {
      manufacturer: 'Sanbot',
      deviceModel: 'Mini ELF',
      androidVersion: '7.1.2',
      apiLevel: 25,
      appVersionName: '0.1.0',
      appVersionCode: 2,
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
    });

    expect(prisma.robot.update).toHaveBeenCalledWith({
      where: { id: 10 },
      data: {
        lastSeenAt: expect.any(Date),
        appVersion: '0.1.0',
        deviceModel: 'Mini ELF',
        deviceMetadata: {
          schemaVersion: 2,
          storage: 'approved-device-profile',
          manufacturer: 'Sanbot',
          model: 'Mini ELF',
          androidVersion: '7.1.2',
          apiLevel: 25,
          appVersionName: '0.1.0',
          appVersionCode: 2,
        },
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
      },
      select: expect.not.objectContaining({ licenseKey: true }),
    });
    expect(result.robot).not.toHaveProperty('licenseKey');
    expect((result.robot as any).hardwareCapabilities.autonomousNavigation).toBe(false);
  });

  it('rejects invalid hardware profile updates before overwriting stored device values', async () => {
    await expect(
      service.updateDeviceProfile(10, {
        manufacturer: 'Sanbot',
        deviceModel: 'Mini ELF',
        androidVersion: '7.1.2',
        apiLevel: 25,
        appVersionName: '0.1.0',
        appVersionCode: 2,
        hardwareProfile: {
          model: 'MINI_ELF',
          manufacturer: 'Sanbot',
          androidApiLevel: 31,
          abi: 'arm64-v8a',
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.robot.update).not.toHaveBeenCalled();
  });

  it('rejects stale device profile updates before overwriting a newer approved profile', async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        deviceMetadata: {
          schemaVersion: 2,
          storage: 'approved-device-profile',
          appVersionCode: 5,
        },
      }),
    );

    await expect(
      service.updateDeviceProfile(10, {
        manufacturer: 'Sanbot',
        deviceModel: 'Mini ELF',
        androidVersion: '7.1.2',
        apiLevel: 25,
        appVersionName: '0.1.0',
        appVersionCode: 4,
        hardwareProfile: {
          model: 'MINI_ELF',
          manufacturer: 'Sanbot',
          androidApiLevel: 25,
          abi: 'arm64-v8a',
          display: { width: 1920, height: 1200 },
        },
      }),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(prisma.robot.update).not.toHaveBeenCalled();
  });

  it('accepts device profile updates with the same app version code', async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        deviceMetadata: {
          schemaVersion: 2,
          storage: 'approved-device-profile',
          appVersionCode: 2,
        },
      }),
    );
    const { licenseKey: _licenseKey, ...robotWithoutLicenseKey } = buildRobot();
    prisma.robot.update.mockResolvedValue(robotWithoutLicenseKey);

    await service.updateDeviceProfile(10, {
      manufacturer: 'Sanbot',
      deviceModel: 'Mini ELF',
      androidVersion: '7.1.2',
      apiLevel: 25,
      appVersionName: '0.1.0',
      appVersionCode: 2,
      hardwareProfile: {
        model: 'MINI_ELF',
        manufacturer: 'Sanbot',
        androidApiLevel: 25,
        abi: 'arm64-v8a',
        display: { width: 1920, height: 1200 },
      },
    });

    expect(prisma.robot.update).toHaveBeenCalled();
  });

  it('keeps repeated device profile updates idempotent for the same approved values', async () => {
    const payload = {
      manufacturer: 'Sanbot',
      deviceModel: 'Mini ELF',
      androidVersion: '7.1.2',
      apiLevel: 25,
      appVersionName: '0.1.0',
      appVersionCode: 2,
      hardwareProfile: {
        model: 'MINI_ELF',
        manufacturer: 'Sanbot',
        androidApiLevel: 25,
        abi: 'arm64-v8a',
        display: { width: 1920, height: 1200 },
      },
    };
    prisma.robot.update.mockResolvedValue(buildRobot());

    await service.updateDeviceProfile(10, payload);
    await service.updateDeviceProfile(10, payload);

    const [firstCall, secondCall] = prisma.robot.update.mock.calls;
    expect(firstCall[0].data.deviceMetadata).toEqual(secondCall[0].data.deviceMetadata);
    expect(firstCall[0].data.hardwareProfile).toEqual(secondCall[0].data.hardwareProfile);
  });

  it('blocks device profile updates when the license is expired', async () => {
    prisma.robot.findUnique.mockResolvedValue(
      buildRobot({
        validUntil: new Date('2020-01-01T00:00:00.000Z'),
        licenseStatus: LicenseStatus.ACTIVE,
      }),
    );

    await expect(
      service.updateDeviceProfile(10, {
        manufacturer: 'Sanbot',
        deviceModel: 'Mini ELF',
        androidVersion: '7.1.2',
        apiLevel: 25,
        appVersionName: '0.1.0',
        appVersionCode: 2,
        hardwareProfile: {
          model: 'MINI_ELF',
          manufacturer: 'Sanbot',
          androidApiLevel: 25,
          abi: 'arm64-v8a',
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
