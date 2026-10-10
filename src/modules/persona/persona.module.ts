import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { OrgPersonaController, RobotPersonaRuntimeController } from './persona.controller';
import { PersonaService } from './persona.service';

@Module({
  imports: [PrismaModule, AuditModule],
  controllers: [OrgPersonaController, RobotPersonaRuntimeController],
  providers: [PersonaService],
  exports: [PersonaService],
})
export class PersonaModule {}
