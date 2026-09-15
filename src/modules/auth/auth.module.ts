import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../common/auth/jwt.strategy';
import { AuditModule } from '../audit/audit.module';
import { AuthService } from './auth.service';
import { AuthRateLimitService } from './auth-rate-limit.service';
import { AuthController } from './auth.controller';
import { RobotAuthController } from './robot-auth.controller';

@Module({
  imports: [
    PassportModule,
    AuditModule,
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') || '7d' },
      }),
    }),
  ],
  providers: [AuthService, AuthRateLimitService, JwtStrategy],
  controllers: [AuthController, RobotAuthController],
  exports: [AuthService],
})
export class AuthModule {}
