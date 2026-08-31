import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class SectionsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.dashboardSection.findMany({ orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
  }

  async create(input: {
    key: string;
    label: string;
    path: string;
    icon?: string;
    sortOrder?: number;
    requiredPermission?: string;
    isSuperAdminOnly?: boolean;
    isActive?: boolean;
  }) {
    return this.prisma.dashboardSection.create({
      data: {
        key: input.key,
        label: input.label,
        path: input.path,
        icon: input.icon ?? null,
        sortOrder: input.sortOrder ?? 0,
        requiredPermission: input.requiredPermission ?? null,
        isSuperAdminOnly: input.isSuperAdminOnly ?? false,
        isActive: input.isActive ?? true,
      },
    });
  }

  async update(id: number, input: Partial<{
    label: string;
    path: string;
    icon: string;
    sortOrder: number;
    requiredPermission: string;
    isSuperAdminOnly: boolean;
    isActive: boolean;
  }>) {
    const existing = await this.prisma.dashboardSection.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Section not found');

    return this.prisma.dashboardSection.update({
      where: { id },
      data: {
        ...input,
        icon: input.icon === undefined ? undefined : input.icon ?? null,
        requiredPermission: input.requiredPermission === undefined ? undefined : input.requiredPermission ?? null,
      },
    });
  }
}
