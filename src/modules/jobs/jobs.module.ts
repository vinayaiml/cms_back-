import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { JobsService } from './jobs.service';

@Module({
  imports: [AuditModule],
  providers: [JobsService],
})
export class JobsModule {}
