import { ForbiddenException } from '@nestjs/common';
import { SubscriptionPlansController } from './subscription-plans.controller';
import { SubscriptionPlansService } from './subscription-plans.service';

describe('SubscriptionPlansController', () => {
  const service = {
    list: jest.fn(),
    get: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    setCapabilities: jest.fn(),
    disable: jest.fn(),
  };

  let controller: SubscriptionPlansController;

  beforeEach(() => {
    jest.resetAllMocks();
    controller = new SubscriptionPlansController(service as unknown as SubscriptionPlansService);
  });

  it('allows Super Admin to create subscription plans', async () => {
    service.create.mockResolvedValue({ id: 1, stableKey: 'starter' });

    await controller.create(
      { type: 'user', sub: 1, orgId: null, isSuperAdmin: true } as any,
      { stableKey: 'starter', name: 'Starter', version: 1, capabilityStableKeys: ['audio.speaker'] },
    );

    expect(service.create).toHaveBeenCalledWith({
      stableKey: 'starter',
      name: 'Starter',
      version: 1,
      capabilityStableKeys: ['audio.speaker'],
    });
  });

  it('rejects organization users before plan mutation', async () => {
    await expect(
      controller.create(
        { type: 'user', sub: 2, orgId: 10, isSuperAdmin: false } as any,
        { stableKey: 'starter', name: 'Starter', version: 1 },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.create).not.toHaveBeenCalled();
  });

  it('returns inactive plans only to Super Admin when requested', async () => {
    service.list.mockResolvedValue([]);

    await controller.list({ type: 'user', sub: 1, orgId: null, isSuperAdmin: true } as any, 'true');
    await controller.list({ type: 'user', sub: 2, orgId: 10, isSuperAdmin: false } as any, 'true');

    expect(service.list).toHaveBeenNthCalledWith(1, { includeInactive: true });
    expect(service.list).toHaveBeenNthCalledWith(2, { includeInactive: false });
  });

  it('allows only Super Admin to replace configured plan capabilities', async () => {
    service.setCapabilities.mockResolvedValue({ id: 1, capabilities: [] });

    await controller.setCapabilities(
      { type: 'user', sub: 1, orgId: null, isSuperAdmin: true } as any,
      1,
      { capabilityStableKeys: ['display.touch'] },
    );

    await expect(
      controller.setCapabilities(
        { type: 'user', sub: 2, orgId: 10, isSuperAdmin: false } as any,
        1,
        { capabilityStableKeys: ['display.touch'] },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(service.setCapabilities).toHaveBeenCalledTimes(1);
    expect(service.setCapabilities).toHaveBeenCalledWith(1, ['display.touch']);
  });
});
