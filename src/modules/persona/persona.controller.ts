import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseIntPipe,
  Put,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { RobotOnlyGuard } from '../../common/guards/robot-only.guard';
import { RobotOnly } from '../../common/decorators/robot-only.decorator';
import { AuditActor } from '../audit/audit.types';
import { PersonaService } from './persona.service';
import {
  UpsertOrganizationPersonaDto,
  UpsertRobotPersonaOverrideDto,
} from './persona.dto';

function toAuditActor(user: JwtPayload): AuditActor {
  if (user.type === 'robot') {
    return {
      userId: null,
      orgId: user.orgId,
      isSuperAdmin: false,
    };
  }
  return {
    userId: user.sub,
    orgId: user.orgId,
    isSuperAdmin: user.isSuperAdmin,
  };
}

@Controller(['orgs', 'v1/orgs'])
@UseGuards(JwtAuthGuard)
export class OrgPersonaController {
  constructor(private readonly personaService: PersonaService) {}

  @Get(':orgId/persona')
  async getOrganizationPersona(
    @Param('orgId', ParseIntPipe) orgId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personaService.getOrganizationPersona(orgId, toAuditActor(user));
  }

  @Put(':orgId/persona')
  async upsertOrganizationPersona(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Body() dto: UpsertOrganizationPersonaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personaService.upsertOrganizationPersona(orgId, dto, toAuditActor(user));
  }

  @Get(':orgId/robots/:robotId/persona')
  async getRobotPersonaOverride(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Param('robotId', ParseIntPipe) robotId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personaService.getRobotPersonaOverride(orgId, robotId, toAuditActor(user));
  }

  @Put(':orgId/robots/:robotId/persona')
  async upsertRobotPersonaOverride(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Param('robotId', ParseIntPipe) robotId: number,
    @Body() dto: UpsertRobotPersonaOverrideDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personaService.upsertRobotPersonaOverride(orgId, robotId, dto, toAuditActor(user));
  }

  @Delete(':orgId/robots/:robotId/persona')
  async deleteRobotPersonaOverride(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Param('robotId', ParseIntPipe) robotId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.personaService.deleteRobotPersonaOverride(orgId, robotId, toAuditActor(user));
  }

  @Get(':orgId/robots/:robotId/persona/effective')
  async previewEffectivePersona(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Param('robotId', ParseIntPipe) robotId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    const actor = toAuditActor(user);
    if (!actor.isSuperAdmin && actor.orgId !== orgId) {
      throw new ForbiddenException('Tenant access forbidden');
    }
    return this.personaService.resolveEffectivePersona(orgId, robotId);
  }
}

@Controller(['robot/persona', 'v1/robot/persona'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class RobotPersonaRuntimeController {
  constructor(private readonly personaService: PersonaService) {}

  @Get()
  async getRobotEffectivePersona(@CurrentUser() actor: JwtPayload) {
    if (actor.type !== 'robot') {
      throw new ForbiddenException('Robot token required');
    }

    return this.personaService.resolveEffectivePersona(actor.orgId, actor.sub);
  }
}
