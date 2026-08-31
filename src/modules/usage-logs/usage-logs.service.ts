import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class UsageLogsService {
  constructor(private prisma: PrismaService) {}

  async upload(robotId: number, orgId: number, logs: Array<{ eventId: string; courseId?: number; lessonId?: number; openedAt: Date; durationSec?: number }>) {
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
