import { ForbiddenException } from '@nestjs/common';
import { CapabilitiesController } from './capabilities.controller';
import { CapabilitiesService } from './capabilities.service';

describe('CapabilitiesController', () => {
  const service = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    disable: jest.fn(),
  };

  let controller: CapabilitiesController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new CapabilitiesController(service as unknown as CapabilitiesService);
  });

  it('allows Super Admin to create capability catalog entries', async () => {
    service.create.mockResolvedValue({ id: 1, stableKey: 'camera.capture' });

    await controller.create(
      { type: 'user', sub: 1, orgId: null, isSuperAdmin: true } as any,
      { stableKey: 'camera.capture', name: 'Camera Capture', version: 1 },
    );

    expect(service.create).toHaveBeenCalledWith({ stableKey: 'camera.capture', name: 'Camera Capture', version: 1 });
  });

  it('rejects organization users before capability mutation', async () => {
    await expect(
      controller.create(
        { type: 'user', sub: 2, orgId: 10, isSuperAdmin: false } as any,
        { stableKey: 'camera.capture', name: 'Camera Capture', version: 1 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('returns inactive catalog rows only to Super Admin when requested', async () => {
    service.list.mockResolvedValue([]);

    await controller.list({ type: 'user', sub: 1, orgId: null, isSuperAdmin: true } as any, 'true');
    await controller.list({ type: 'user', sub: 2, orgId: 10, isSuperAdmin: false } as any, 'true');

    expect(service.list).toHaveBeenNthCalledWith(1, { includeInactive: true });
    expect(service.list).toHaveBeenNthCalledWith(2, { includeInactive: false });
  });
});
