import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { AuditActor } from '../audit/audit.types';
import { ConversationContextService } from './conversation-context.service';
import { ApprovedQaService } from './approved-qa.service';
import {
  ApprovedQaItemDto,
  QueryApprovedQaDto,
  UpsertApprovedQaDto,
  UpsertConversationContextDto,
} from './conversation-context.dto';

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
export class ConversationContextController {
  constructor(
    private readonly contextService: ConversationContextService,
    private readonly qaService: ApprovedQaService,
  ) {}

  @Get(':orgId/conversation-context')
  async getConversationContext(
    @Param('orgId', ParseIntPipe) orgId: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contextService.getConversationContext(orgId, toAuditActor(user));
  }

  @Put(':orgId/conversation-context')
  async upsertConversationContext(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Body() dto: UpsertConversationContextDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.contextService.upsertConversationContext(orgId, dto, toAuditActor(user));
  }

  @Get(':orgId/approved-qa')
  async listApprovedQa(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Query() query: QueryApprovedQaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.qaService.listApprovedQa(orgId, toAuditActor(user), query);
  }

  @Put(':orgId/approved-qa')
  async upsertApprovedQa(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Body() dto: UpsertApprovedQaDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.qaService.upsertApprovedQa(orgId, dto, toAuditActor(user));
  }

  @Post(':orgId/approved-qa')
  async createApprovedQa(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Body() dto: ApprovedQaItemDto,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.qaService.createApprovedQa(orgId, dto, toAuditActor(user));
  }

  @Delete(':orgId/approved-qa/:id')
  async deleteApprovedQa(
    @Param('orgId', ParseIntPipe) orgId: number,
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: JwtPayload,
  ) {
    return this.qaService.deleteApprovedQa(orgId, id, toAuditActor(user));
  }
}
