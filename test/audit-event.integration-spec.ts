import { PrismaClient } from '@prisma/client';

describe('Audit event persistence', () => {
  const prisma = new PrismaClient();
  const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let auditEventId: number;

  afterAll(async () => {
    if (auditEventId) {
      await prisma.auditEvent.delete({ where: { id: auditEventId } });
    }
    await prisma.$disconnect();
  });

  it('persists actor, action, target and timestamp for an admin change', async () => {
    const saved = await prisma.auditEvent.create({
      data: {
        actorUserId: 1,
        actorOrgId: null,
        action: 'organization.deactivated',
        targetType: 'organization',
        targetId: `test-org-${suffix}`,
        targetOrgId: 1,
        correlationId: `request-${suffix}`,
        metadata: {
          previousStatus: 'active',
          newStatus: 'inactive',
        },
      },
    });

    auditEventId = saved.id;

    expect(saved.actorUserId).toBe(1);
    expect(saved.action).toBe('organization.deactivated');
    expect(saved.targetType).toBe('organization');
    expect(saved.targetId).toBe(`test-org-${suffix}`);
    expect(saved.createdAt).toBeInstanceOf(Date);
  });
});
