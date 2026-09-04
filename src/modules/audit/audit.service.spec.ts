import { AuditService } from './audit.service';

describe('AuditService', () => {
  const prisma = {
    auditEvent: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('removes sensitive metadata before writing an audit event', async () => {
    prisma.auditEvent.create.mockResolvedValue({ id: 1 });
    const service = new AuditService(prisma as any);

    await service.recordCritical({
      actor: { userId: 10, orgId: null, isSuperAdmin: true },
      action: 'user.password.updated',
      targetType: 'user',
      targetId: 20,
      targetOrgId: 30,
      correlationId: ' request-1 ',
      metadata: {
        email: 'admin@example.com',
        password: 'plain-text',
        passwordHash: 'hashed-value',
        nested: {
          jwt: 'token-value',
          field: 'safe',
        },
      },
    });

    expect(prisma.auditEvent.create).toHaveBeenCalledWith({
      data: {
        actorUserId: 10,
        actorOrgId: null,
        action: 'user.password.updated',
        targetType: 'user',
        targetId: '20',
        targetOrgId: 30,
        correlationId: 'request-1',
        metadata: {
          email: 'admin@example.com',
          nested: {
            field: 'safe',
          },
        },
      },
    });
  });

  it('restricts non-super-admin audit listing to the actor organization', async () => {
    prisma.auditEvent.findMany.mockResolvedValue([]);
    const service = new AuditService(prisma as any);

    await service.listForActor(
      { userId: 4, orgId: 12, isSuperAdmin: false },
      { orgId: 99, action: 'organization.deactivated', limit: 500 },
    );

    expect(prisma.auditEvent.findMany).toHaveBeenCalledWith({
      where: {
        action: 'organization.deactivated',
        targetOrgId: 12,
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  });
});
