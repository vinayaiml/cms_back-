import { LicenseStatus } from '@prisma/client';
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
  };

  let service: RobotSyncService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new RobotSyncService(prisma as unknown as PrismaService);
    prisma.robot.findUnique.mockResolvedValue(buildRobot());
    prisma.robot.update.mockResolvedValue({});
    prisma.course.findMany.mockResolvedValue([]);
    prisma.orgCourseAccess.findMany.mockResolvedValue([]);
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
});
