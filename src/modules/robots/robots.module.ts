import { Module } from '@nestjs/common';
import { RobotsController } from './robots.controller';
import { RobotsService } from './robots.service';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [AuditModule],
  controllers: [RobotsController],
  providers: [RobotsService],
})
export class RobotsModule {}
