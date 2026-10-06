import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { Public } from '../../common/decorators/public.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

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
    // 只有配置了 TRUST_PROXY（main.ts 据此设置 Express trust proxy）时 req.ip 才是真实客户端；
    // 否则它是 nginx/平台代理的地址，按它限流会让全站用户共用一个计数器
    const ip = this.config.get<string>('TRUST_PROXY') ? (req.ip ?? null) : null;
    return this.authService.login(dto.email, dto.password, ip);
  }

  @Get('profile')
  @ApiBearerAuth()
  @ApiOperation({ summary: '当前登录用户信息（含角色与权限）' })
  profile(@CurrentUser() user: JwtUser) {
    return this.authService.profile(user.sub);
  }
}
