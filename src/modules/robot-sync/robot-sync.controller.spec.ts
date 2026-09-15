import { BadRequestException } from '@nestjs/common';
import { RobotSyncController } from './robot-sync.controller';
import { RobotSyncService } from './robot-sync.service';

describe('RobotSyncController heartbeat headers', () => {
  const syncService = {
    sync: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    syncService.sync.mockResolvedValue({ locked: false });
  });

  it('passes validated app version and device model headers to sync service', async () => {
    const controller = new RobotSyncController(syncService as unknown as RobotSyncService);

    await controller.sync(
      { type: 'robot', tokenUse: 'access', sub: 10, orgId: 1 },
      '0.1.0',
      'Mini ELF',
    );

    expect(syncService.sync).toHaveBeenCalledWith(10, {
      appVersion: '0.1.0',
      deviceModel: 'Mini ELF',
    });
  });

  it('rejects invalid app version heartbeat headers', async () => {
    const controller = new RobotSyncController(syncService as unknown as RobotSyncService);

    await expect(
      controller.sync(
        { type: 'robot', tokenUse: 'access', sub: 10, orgId: 1 },
        '0.1.0<secret>',
        'Mini ELF',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(syncService.sync).not.toHaveBeenCalled();
  });
});
