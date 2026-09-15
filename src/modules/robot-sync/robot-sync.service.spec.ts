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
    org: { isActive: true },
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
      include: { org: { select: { isActive: true } } },
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
});
