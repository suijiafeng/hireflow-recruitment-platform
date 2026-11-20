import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { LoginDto } from './dto/login.dto';
import type { LoginSource } from './login-throttle.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly config: ConfigService,
  ) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: '账号密码登录，返回 JWT' })
  login(@Body() dto: LoginDto, @Req() req: Request) {
    return this.authService.login(dto.email, dto.password, this.source(req));
  }

  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '修改自己的密码：其他设备上的登录立即失效，返回当前会话的新令牌' })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: JwtUser, @Req() req: Request) {
    return this.authService.changePassword(user, dto.currentPassword, dto.newPassword, this.source(req));
  }

  @Post('sessions/revoke')
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth()
  @ApiOperation({ summary: '退出其他所有设备（当前会话换新令牌）' })
  revokeSessions(@CurrentUser() user: JwtUser) {
    return this.authService.revokeOtherSessions(user);
  }

  /**
   * 只有配置了 TRUST_PROXY（main.ts 据此设置 Express trust proxy）时 req.ip 才是真实客户端；
   * 否则它可能是 nginx/平台代理的地址，限流据此退化为按账号（见 LoginThrottleService）
   */
  private source(req: Request): LoginSource {
    return { ip: req.ip ?? null, trusted: Boolean(this.config.get<string>('TRUST_PROXY')) };
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录用户信息（含角色与权限）' })
  profile(@CurrentUser() user: JwtUser) {
    return this.authService.profile(user.sub);
  }
}
