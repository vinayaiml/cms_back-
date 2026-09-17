import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { UsersService } from './users.service';

describe('UsersService lock management', () => {
  const tx = {
    user: {
      update: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
  });

  it('locks a same-tenant user and records a sanitized audit event', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
      isLocked: false,
    });
    tx.user.update.mockResolvedValue({ id: 20, orgId: 7, isLocked: true });

    const service = new UsersService(prisma as any, audit as any);
    const result = await service.setLock(20, true, { userId: 10, orgId: 7, isSuperAdmin: false });

    expect(result).toEqual({ ok: true, isLocked: true });
    expect(tx.user.update).toHaveBeenCalledWith({
      where: { id: 20 },
      data: { isLocked: true },
      select: { id: true, orgId: true, isLocked: true },
    });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      {
        actor: { userId: 10, orgId: 7, isSuperAdmin: false },
        action: 'user.locked',
        targetType: 'user',
        targetId: 20,
        targetOrgId: 7,
        metadata: {
          previousStatus: 'unlocked',
          newStatus: 'locked',
        },
      },
      tx,
    );
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty('password');
    expect(audit.recordCritical.mock.calls[0][0].metadata).not.toHaveProperty('token');
  });

  it('unlocks a user and records the unlock action', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 7,
      createdByUserId: 10,
      isLocked: true,
    });
    tx.user.update.mockResolvedValue({ id: 20, orgId: 7, isLocked: false });

    const service = new UsersService(prisma as any, audit as any);
    const result = await service.setLock(20, false, { userId: 10, orgId: 7, isSuperAdmin: false });

    expect(result).toEqual({ ok: true, isLocked: false });
    expect(audit.recordCritical).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'user.unlocked',
        metadata: {
          previousStatus: 'locked',
          newStatus: 'unlocked',
        },
      }),
      tx,
    );
  });

  it('blocks cross-tenant direct-ID lock attempts', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 20,
      orgId: 8,
      createdByUserId: 10,
      isLocked: false,
    });

    const service = new UsersService(prisma as any, audit as any);

    await expect(service.setLock(20, true, { userId: 10, orgId: 7, isSuperAdmin: false })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
    expect(audit.recordCritical).not.toHaveBeenCalled();
  });

  it('blocks self-lock attempts', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 10,
      orgId: 7,
      createdByUserId: 10,
      isLocked: false,
    });

    const service = new UsersService(prisma as any, audit as any);

    await expect(service.setLock(10, true, { userId: 10, orgId: 7, isSuperAdmin: false })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.user.update).not.toHaveBeenCalled();
  });

  it('returns not found for unknown users', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    const service = new UsersService(prisma as any, audit as any);

    await expect(service.setLock(999, true, { userId: 1, orgId: null, isSuperAdmin: true })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('UsersService permission ceiling', () => {
  const tx = {
    userPermission: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const prisma = {
    user: {
      findUnique: jest.fn(),
      create: jest.fn(),
    },
    role: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    permission: {
      findMany: jest.fn(),
    },
    orgPermission: {
      findMany: jest.fn(),
    },
    userRole: {
      upsert: jest.fn(),
    },
    userPermission: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  const audit = {
    recordCritical: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    prisma.$transaction.mockImplementation((fn) => fn(tx));
  });

  it('rejects direct user permissions outside the target organization ceiling even with permission.manage', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 20, orgId: 7, createdByUserId: 10 });
    prisma.permission.findMany.mockResolvedValue([{ id: 50, key: 'content.delete' }]);
    prisma.orgPermission.findMany.mockResolvedValue([{ permission: { key: 'permission.manage' } }]);

    const service = new UsersService(prisma as any, audit as any);

    await expect(
      service.setDirectPermissions(20, ['content.delete'], { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(tx.userPermission.deleteMany).not.toHaveBeenCalled();
    expect(tx.userPermission.createMany).not.toHaveBeenCalled();
  });

  it('rejects direct-ID role assignment across tenant boundaries before mutation', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 20, orgId: 7, createdByUserId: 10 });
    prisma.role.findUnique.mockResolvedValue({
      id: 30,
      orgId: 8,
      name: 'Teacher',
      permissions: [],
    });

    const service = new UsersService(prisma as any, audit as any);

    await expect(
      service.assignRole(20, 30, { userId: 1, orgId: null, isSuperAdmin: true }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });

  it('rejects role assignment when the role contains permissions outside the user organization ceiling', async () => {
    prisma.user.findUnique.mockResolvedValue({ id: 20, orgId: 7, createdByUserId: 10 });
    prisma.role.findUnique.mockResolvedValue({
      id: 30,
      orgId: 7,
      name: 'Teacher',
      permissions: [{ permission: { key: 'content.delete' } }],
    });
    prisma.orgPermission.findMany.mockResolvedValue([{ permission: { key: 'content.read' } }]);

    const service = new UsersService(prisma as any, audit as any);

    await expect(
      service.assignRole(20, 30, { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.userRole.upsert).not.toHaveBeenCalled();
  });
});
