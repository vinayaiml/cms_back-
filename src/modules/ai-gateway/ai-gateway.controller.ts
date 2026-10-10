import { Body, Controller, ForbiddenException, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../../common/auth/jwt-auth.guard';
import { RobotOnlyGuard } from '../../common/guards/robot-only.guard';
import { RobotOnly } from '../../common/decorators/robot-only.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { JwtPayload } from '../../common/auth/jwt.types';
import { AiGatewayService } from './ai-gateway.service';
import { RobotConversationDto } from './ai-gateway.dto';

@Controller(['robot/ai', 'v1/robot/ai'])
@UseGuards(JwtAuthGuard, RobotOnlyGuard)
@RobotOnly()
export class AiGatewayController {
  constructor(private readonly aiGatewayService: AiGatewayService) {}

  @Post('conversation')
  async converse(@CurrentUser() actor: JwtPayload, @Body() dto: RobotConversationDto) {
    if (actor.type !== 'robot') {
      throw new ForbiddenException('Robot token required');
    }

    return this.aiGatewayService.converse(actor.sub, dto);
  }
}
