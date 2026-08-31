import { Module } from '@nestjs/common';
import { RobotSyncController } from './robot-sync.controller';
import { RobotSyncService } from './robot-sync.service';

@Module({
  controllers: [RobotSyncController],
  providers: [RobotSyncService],
})
export class RobotSyncModule {}
