import { ConflictException, NotFoundException } from '@nestjs/common';
import { SubscriptionPlansService } from './subscription-plans.service';

describe('SubscriptionPlansService', () => {
  const prisma = {
    subscriptionPlan: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    capability: {
      findMany: jest.fn(),
    },
    planCapability: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  let service: SubscriptionPlansService;

  beforeEach(() => {
    jest.resetAllMocks();
    prisma.$transaction.mockImplementation((callback) => callback(prisma));
    service = new SubscriptionPlansService(prisma as any);
  });

  it('returns exactly the configured capabilities for a plan', async () => {
    prisma.subscriptionPlan.findMany.mockResolvedValue([
      {
        id: 1,
        stableKey: 'starter',
        name: 'Starter',
        description: null,
        version: 1,
        isActive: true,
        capabilities: [
          { capability: { id: 2, stableKey: 'display.touch', name: 'Touch Display', version: 1, isActive: true } },
          { capability: { id: 1, stableKey: 'audio.speaker', name: 'Speaker Output', version: 1, isActive: true } },
        ],
      },
    ]);

    const result = await service.list();

    expect(result).toHaveLength(1);
    expect(result[0].capabilities.map((capability) => capability.stableKey)).toEqual(['audio.speaker', 'display.touch']);
    expect(result[0].capabilities).toHaveLength(2);
    expect(prisma.subscriptionPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      include: {
        capabilities: {
          include: { capability: true },
          orderBy: { capability: { stableKey: 'asc' } },
        },
      },
      orderBy: [{ stableKey: 'asc' }],
    });
  });

  it('rejects duplicate stable keys before creating a plan', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue({ id: 1 });

    await expect(
      service.create({ stableKey: 'starter', name: 'Starter', version: 1 }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(prisma.subscriptionPlan.create).not.toHaveBeenCalled();
  });

  it('rejects plans with unknown or inactive capabilities before persistence', async () => {
    prisma.subscriptionPlan.findUnique.mockResolvedValue(null);
    prisma.capability.findMany.mockResolvedValue([{ id: 1, stableKey: 'audio.speaker', isActive: true }]);

    await expect(
      service.create({
        stableKey: 'starter',
        name: 'Starter',
        version: 1,
        capabilityStableKeys: ['audio.speaker', 'speech.recognition'],
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(prisma.subscriptionPlan.create).not.toHaveBeenCalled();
  });

  it('replaces plan capabilities exactly and idempotently', async () => {
    const planWithoutCapabilities = {
      id: 1,
      stableKey: 'starter',
      name: 'Starter',
      version: 1,
      isActive: true,
      capabilities: [],
    };
    const planWithCapabilities = {
      ...planWithoutCapabilities,
      capabilities: [
        { capability: { id: 1, stableKey: 'audio.speaker', name: 'Speaker Output', version: 1, isActive: true } },
        { capability: { id: 2, stableKey: 'display.touch', name: 'Touch Display', version: 1, isActive: true } },
      ],
    };

    prisma.subscriptionPlan.findFirst
      .mockResolvedValueOnce(planWithoutCapabilities)
      .mockResolvedValueOnce(planWithCapabilities);
    prisma.capability.findMany.mockResolvedValue([
      { id: 1, stableKey: 'audio.speaker' },
      { id: 2, stableKey: 'display.touch' },
    ]);

    const result = await service.setCapabilities(1, ['display.touch', 'audio.speaker', 'audio.speaker']);

    expect(prisma.planCapability.deleteMany).toHaveBeenCalledWith({ where: { planId: 1 } });
    expect(prisma.planCapability.createMany).toHaveBeenCalledWith({
      data: [
        { planId: 1, capabilityId: 1 },
        { planId: 1, capabilityId: 2 },
      ],
      skipDuplicates: true,
    });
    expect(result.capabilities.map((capability) => capability.stableKey)).toEqual(['audio.speaker', 'display.touch']);
  });
});
