import { OrgsService } from './orgs.service';

describe('OrgsService', () => {
  const prisma = {
    organization: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const tx = {
    organization: {
      update: jest.fn(),
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
    const result = await service.toggleActive(
      7,
      { userId: 1, orgId: null, isSuperAdmin: true },
      'request-123',
    );

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
});
