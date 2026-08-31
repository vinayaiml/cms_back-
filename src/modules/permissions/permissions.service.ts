import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PermissionsService {
  constructor(private prisma: PrismaService) {}

  async list() {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
  }

  async create(data: { key: string; description?: string; category?: string }) {
    const key = data.key.trim();
    if (!key) throw new BadRequestException('Key is required');

    const existing = await this.prisma.permission.findUnique({ where: { key } });
    if (existing) throw new BadRequestException('Permission key already exists');

    return this.prisma.permission.create({
      data: {
        key,
        description: data.description ?? null,
        category: data.category ?? null,
      },
    });
  }
}
