import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async list(actor: { userId: number; orgId: number | null; isSuperAdmin: boolean }) {
    if (actor.isSuperAdmin) {
      // Super admin: global + own user notifications + org-wide notifications across all orgs
      return this.prisma.notification.findMany({
        where: {
          OR: [
            { orgId: null, userId: null },
            { orgId: { not: null }, userId: null },
            { userId: actor.userId },
          ],
        },
        orderBy: { id: 'desc' },
        take: 100,
      });
    }

    if (!actor.orgId) throw new ForbiddenException('Org scope required');

    return this.prisma.notification.findMany({
      where: {
        OR: [
          { orgId: actor.orgId, userId: null },
          { userId: actor.userId },
        ],
      },
      orderBy: { id: 'desc' },
      take: 100,
    });
  }

  async markRead(notificationId: number, actor: { userId: number; orgId: number | null; isSuperAdmin: boolean }) {
    const n = await this.prisma.notification.findUnique({ where: { id: notificationId } });
    if (!n) throw new NotFoundException('Notification not found');

    // Access check
    if (actor.isSuperAdmin) {
      // ok: super admin can read global, and user-specific to them
      if (n.userId && n.userId !== actor.userId) {
        throw new ForbiddenException('Cannot mark other user notification');
      }
    } else {
      if (n.userId && n.userId !== actor.userId) throw new ForbiddenException('Cannot mark other user notification');
      if (n.orgId && actor.orgId !== n.orgId) throw new ForbiddenException('Cannot access other org notifications');
    }

    return this.prisma.notification.update({
      where: { id: notificationId },
      data: { readAt: new Date() },
    });
  }
}
