import { Module } from '@nestjs/common';
import { RobotDeviceProfileController, RobotSyncController } from './robot-sync.controller';
import { RobotSyncService } from './robot-sync.service';

@Module({
  controllers: [RobotSyncController, RobotDeviceProfileController],
  providers: [RobotSyncService],
})
export class RobotSyncModule {}
