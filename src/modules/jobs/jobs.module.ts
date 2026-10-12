import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { JobsController } from './jobs.controller';
import { JobsService } from './jobs.service';

@Module({
  imports: [AuditModule],
  controllers: [JobsController],
  providers: [JobsService],
})
export class JobsModule {}
