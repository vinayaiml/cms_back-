import { DomainLockedException } from '../../common/errors/domain-locked.exception';
import { UsageLogsService } from './usage-logs.service';

describe('UsageLogsService', () => {
  const prisma = {
    organization: {
      findUnique: jest.fn(),
    },
    event: {
      create: jest.fn(),
    },
    robotUsageLog: {
      createMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects log upload when the organization is inactive', async () => {
    prisma.organization.findUnique.mockResolvedValue({ isActive: false });

    const service = new UsageLogsService(prisma as any);

    await expect(service.upload(10, 20, [])).rejects.toBeInstanceOf(DomainLockedException);

    expect(prisma.event.create).toHaveBeenCalledWith({
      data: {
        orgId: 20,
        robotId: 10,
        type: 'ROBOT_ACCESS_REJECTED_ORG_INACTIVE',
        payload: {
          reason: 'ORG_INACTIVE',
          endpoint: 'robot.logs.batch',
        },
      },
    });
    expect(prisma.robotUsageLog.createMany).not.toHaveBeenCalled();
  });

  it('inserts active organization logs with duplicate-safe persistence', async () => {
    const openedAt = new Date('2026-09-01T10:00:00.000Z');
    prisma.organization.findUnique.mockResolvedValue({ isActive: true });
    prisma.robotUsageLog.createMany.mockResolvedValue({ count: 1 });

    const service = new UsageLogsService(prisma as any);
    const result = await service.upload(10, 20, [
      {
        eventId: 'event-1',
        openedAt,
        durationSec: 60,
      },
    ]);

    expect(result).toEqual({ inserted: 1 });
    expect(prisma.robotUsageLog.createMany).toHaveBeenCalledWith({
      data: [
        {
          orgId: 20,
          robotId: 10,
          eventId: 'event-1',
          courseId: null,
          lessonId: null,
          openedAt,
          durationSec: 60,
        },
      ],
      skipDuplicates: true,
    });
  });
});
