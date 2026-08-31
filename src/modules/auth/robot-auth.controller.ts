import { Body, Controller, Post } from '@nestjs/common';
import { AuthService } from './auth.service';
import { RobotLoginDto } from './auth.dto';

@Controller(['robot/auth', 'v1/robot/auth'])
export class RobotAuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: RobotLoginDto) {
    return this.auth.loginRobot(dto.licenseKey);
  }
}
