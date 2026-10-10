import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { ConversationPublicationModule } from '../conversation-publication/conversation-publication.module';
import { ConversationContextController } from './conversation-context.controller';
import { ConversationContextService } from './conversation-context.service';
import { ApprovedQaService } from './approved-qa.service';

@Module({
  imports: [PrismaModule, AuditModule, ConversationPublicationModule],
  controllers: [ConversationContextController],
  providers: [ConversationContextService, ApprovedQaService],
  exports: [ConversationContextService, ApprovedQaService],
})
export class ConversationContextModule {}
