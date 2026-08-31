import { Module } from '@nestjs/common';
import { DashboardController } from './dashboard.controller';
import { DashboardService } from './dashboard.service';
import { SectionsController } from './sections.controller';
import { SectionsService } from './sections.service';

@Module({
  controllers: [DashboardController, SectionsController],
  providers: [DashboardService, SectionsService],
})
export class DashboardModule {}
