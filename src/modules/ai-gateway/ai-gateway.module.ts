import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { EntitlementsModule } from '../entitlements/entitlements.module';
import { PersonaModule } from '../persona/persona.module';
import { AiGatewayController } from './ai-gateway.controller';
import { AiGatewayService } from './ai-gateway.service';
import { AiToolRegistryService } from './tools/ai-tool-registry.service';

@Module({
  imports: [PrismaModule, AuditModule, EntitlementsModule, PersonaModule],
  controllers: [AiGatewayController],
  providers: [AiGatewayService, AiToolRegistryService],
  exports: [AiGatewayService, AiToolRegistryService],
})
export class AiGatewayModule {}
