import { OrgsService } from './orgs.service';

describe('OrgsService', () => {
  const prisma = {
    organization: {
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
