import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrgsController } from './orgs.controller';
import { OrgsService } from './orgs.service';

@Module({
  imports: [AuditModule],
  controllers: [OrgsController],
  providers: [OrgsService],
})
export class OrgsModule {}
