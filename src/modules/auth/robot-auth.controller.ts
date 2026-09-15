import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { RobotLoginDto, RobotTokenRefreshDto } from './auth.dto';

@Controller(['robot/auth', 'v1/robot/auth'])
export class RobotAuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: RobotLoginDto, @Req() req: Request) {
    return this.auth.loginRobot(dto, { ip: req.ip });
  }

  @Post('refresh')
  async refresh(@Body() dto: RobotTokenRefreshDto) {
    return this.auth.refreshRobotToken(dto.refreshToken);
  }
}
