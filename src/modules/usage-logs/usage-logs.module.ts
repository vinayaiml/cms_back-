import { Module } from '@nestjs/common';
import { UsageLogsController } from './usage-logs.controller';
import { UsageLogsService } from './usage-logs.service';

@Module({
  controllers: [UsageLogsController],
  providers: [UsageLogsService],
})
export class UsageLogsModule {}
