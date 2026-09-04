import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { DomainLockedException } from '../../common/errors/domain-locked.exception';

@Injectable()
export class UsageLogsService {
  constructor(private prisma: PrismaService) {}

  async upload(robotId: number, orgId: number, logs: Array<{ eventId: string; courseId?: number; lessonId?: number; openedAt: Date; durationSec?: number }>) {
    const org = await this.prisma.organization.findUnique({
      where: { id: orgId },
      select: { isActive: true },
    });

    if (!org?.isActive) {
      await this.prisma.event.create({
        data: {
          orgId,
          robotId,
          type: 'ROBOT_ACCESS_REJECTED_ORG_INACTIVE',
          payload: {
            reason: 'ORG_INACTIVE',
            endpoint: 'robot.logs.batch',
          },
        },
      });
      throw new DomainLockedException('ORG_INACTIVE', 'Organization is inactive');
    }

    if (logs.length === 0) return { inserted: 0 };

    const data = logs.map((l) => ({
      orgId,
      robotId,
      eventId: l.eventId,
      courseId: l.courseId ?? null,
      lessonId: l.lessonId ?? null,
      openedAt: l.openedAt,
      durationSec: l.durationSec ?? null,
    }));

    // createMany + skipDuplicates gives safe dedupe by unique(robotId,eventId)
    const result = await this.prisma.robotUsageLog.createMany({
      data,
      skipDuplicates: true,
    });

    return { inserted: result.count };
  }
}
