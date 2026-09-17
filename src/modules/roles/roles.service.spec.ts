import { ConflictException, ForbiddenException } from '@nestjs/common';
import { RolesService } from './roles.service';

describe('RolesService permission ceiling', () => {
  const prisma = {
    role: {
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
    },
    permission: {
      findUnique: jest.fn(),
    },
    orgPermission: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    userRole: {
      findFirst: jest.fn(),
    },
    rolePermission: {
      upsert: jest.fn(),
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects role permission assignment when the permission is outside the organization ceiling', async () => {
    prisma.role.findUnique.mockResolvedValue({ id: 20, orgId: 7, name: 'Teacher' });
    prisma.permission.findUnique.mockResolvedValue({ id: 50, key: 'content.delete' });
    prisma.orgPermission.findFirst.mockResolvedValue(null);

    const service = new RolesService(prisma as any);

    await expect(
      service.addPermission(20, 'content.delete', { userId: 10, orgId: 7, isSuperAdmin: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(prisma.rolePermission.upsert).not.toHaveBeenCalled();
  });

  it('returns a safe conflict when a role name already exists for the organization', async () => {
    prisma.role.findFirst.mockResolvedValue({ id: 10 });

    const service = new RolesService(prisma as any);

    await expect(service.create(7, 'Manager')).rejects.toThrow(ConflictException);
    await expect(service.create(7, 'Manager')).rejects.toThrow('Role name already exists in this organization');
    expect(prisma.role.create).not.toHaveBeenCalled();
  });

  it('trims role names before creating the role', async () => {
    prisma.role.findFirst.mockResolvedValue(null);
    prisma.role.create.mockResolvedValue({ id: 11, orgId: 7, name: 'Manager' });

    const service = new RolesService(prisma as any);
    await service.create(7, '  Manager  ', 'Operations');

    expect(prisma.role.create).toHaveBeenCalledWith({
      data: { orgId: 7, name: 'Manager', description: 'Operations' },
    });
  });
});
