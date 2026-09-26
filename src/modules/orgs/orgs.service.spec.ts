import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { OrgsService } from './orgs.service';

describe('OrgsService', () => {
  const prisma = {
    organization: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    subscriptionPlan: {
      findUnique: jest.fn(),
    },
    organizationSubscription: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const tx = {
    organization: {
      update: jest.fn(),
    },
    organizationSubscription: {
      deleteMany: jest.fn(),
      create: jest.fn(),
    },
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
  });

  it('lists organizations with an explicit safe field selection', async () => {
    prisma.organization.findMany.mockResolvedValue([
      {
        id: 7,
        name: 'Demo Org',
        state: 'Maharashtra',
        city: 'Mumbai',
        authorizedPersonName: 'Demo Admin',
        contactNo: '9876543210',
        isActive: true,
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ]);

    const service = new OrgsService(prisma as any, audit as any);
    await service.listAll();

    expect(prisma.organization.findMany).toHaveBeenCalledWith({
      orderBy: { id: 'desc' },
      select: expect.objectContaining({
        id: true,
        name: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      }),
    });
    expect(prisma.organization.findMany.mock.calls[0][0].select).not.toHaveProperty('password');
    expect(prisma.organization.findMany.mock.calls[0][0].select).not.toHaveProperty('passwordHash');
    expect(prisma.organization.findMany.mock.calls[0][0].select).not.toHaveProperty('licenseKey');
  });

  it('creates a critical audit event when an organization is deactivated', async () => {
    prisma.organization.findUnique.mockResolvedValue({ id: 7, isActive: true });
    tx.organization.update.mockResolvedValue({ id: 7, isActive: false });

    const service = new OrgsService(prisma as any, audit as any);
    const result = await service.toggleActive(7, { userId: 1, orgId: null, isSuperAdmin: true }, 'request-123');

    expect(result).toEqual({ id: 7, isActive: false });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 1, orgId: null, isSuperAdmin: true },
        action: 'organization.deactivated',
        targetType: 'organization',
        targetId: 7,
        targetOrgId: 7,
        correlationId: 'request-123',
        metadata: {
          previousStatus: 'active',
          newStatus: 'inactive',
        },
      },
      tx,
    );
  });

  it('assigns an active subscription and audits the organization change', async () => {
    const validFrom = '2026-09-01T00:00:00.000Z';
    const validUntil = '2027-09-01T00:00:00.000Z';
    prisma.organization.findUnique.mockResolvedValue({
      id: 7,
      tenantVersion: 4,
    });
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 3,
      stableKey: 'speech-plus',
      isActive: true,
    });
    prisma.organizationSubscription.findFirst.mockResolvedValue({
      id: 9,
      planId: 1,
      status: 'ACTIVE',
      validFrom: new Date('2025-01-01T00:00:00.000Z'),
      validUntil: new Date('2026-01-01T00:00:00.000Z'),
    });
    tx.organization.update.mockResolvedValue({ tenantVersion: 5 });
    tx.organizationSubscription.create.mockResolvedValue({
      id: 10,
      orgId: 7,
      planId: 3,
      status: 'ACTIVE',
      validFrom: new Date(validFrom),
      validUntil: new Date(validUntil),
      createdAt: new Date('2026-09-24T00:00:00.000Z'),
      updatedAt: new Date('2026-09-24T00:00:00.000Z'),
      plan: {
        id: 3,
        stableKey: 'speech-plus',
        name: 'Speech Plus',
        description: null,
        version: 1,
        isActive: true,
        capabilities: [
          {
            capability: {
              id: 2,
              stableKey: 'display.touch',
              name: 'Touch Display',
              version: 1,
              isActive: true,
            },
          },
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

    const service = new OrgsService(prisma as any, audit as any);
    const result = await service.assignSubscription(7, { planId: 3, validFrom, validUntil }, { userId: 1, orgId: null, isSuperAdmin: true }, 'sub-request-1');

    expect(tx.organizationSubscription.deleteMany).toHaveBeenCalledWith({
      where: { orgId: 7 },
    });
    expect(tx.organization.update).toHaveBeenCalledWith({
      where: { id: 7 },
      data: { tenantVersion: { increment: 1 } },
      select: { tenantVersion: true },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'organization.subscription.assigned',
        targetType: 'organization',
        targetId: 7,
        targetOrgId: 7,
        correlationId: 'sub-request-1',
      }),
      tx,
    );
    expect(result.plan.capabilities.map((capability: any) => capability.stableKey)).toEqual(['audio.speaker', 'display.touch']);
    expect(JSON.stringify(result)).not.toMatch(/licenseKey|token|password|secret/i);
  });

  it('rejects invalid subscription windows and inactive plans before mutation', async () => {
    prisma.organization.findUnique.mockResolvedValue({
      id: 7,
      tenantVersion: 4,
    });
    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 3,
      stableKey: 'starter',
      isActive: true,
    });

    const service = new OrgsService(prisma as any, audit as any);
    await expect(
      service.assignSubscription(
        7,
        {
          planId: 3,
          validFrom: '2027-01-01T00:00:00.000Z',
          validUntil: '2026-01-01T00:00:00.000Z',
        },
        { userId: 1, orgId: null, isSuperAdmin: true },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    prisma.subscriptionPlan.findUnique.mockResolvedValue({
      id: 3,
      stableKey: 'starter',
      isActive: false,
    });
    await expect(
      service.assignSubscription(
        7,
        {
          planId: 3,
          validFrom: '2026-01-01T00:00:00.000Z',
          validUntil: '2027-01-01T00:00:00.000Z',
        },
        { userId: 1, orgId: null, isSuperAdmin: true },
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.organizationSubscription.create).not.toHaveBeenCalled();
  });
});
