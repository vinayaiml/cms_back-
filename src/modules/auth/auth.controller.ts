import { Body, Controller, Post, Req } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './auth.dto';

@Controller(['auth', 'v1/auth'])
export class AuthController {
  constructor(private auth: AuthService) {}

  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.auth.loginUser(dto.email, dto.password, { ip: req.ip });
  }
}
