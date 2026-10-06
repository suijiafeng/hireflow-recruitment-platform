import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { InviteUserDto } from './dto/invite-user.dto';
import { UpdateUserRolesDto } from './dto/update-user-roles.dto';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@ApiBearerAuth()
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  // 内部通讯录：候选人/新员工/IT 无正当理由拉取全公司名单，用「能看大盘」的常规员工权限作为门槛
  @RequirePermissions(PERMISSIONS.DASHBOARD_VIEW)
  @ApiOperation({ summary: '内部用户列表（可按角色过滤，如 ?role=INTERVIEWER）' })
  @ApiQuery({ name: 'role', required: false })
  list(@Query('role') role?: string) {
    return this.usersService.list(role);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  @ApiOperation({
    summary: '邀请内部成员',
    description:
      '邮箱唯一、至少一个角色、不可分配门户角色。未接邮件通道，响应中的 initialPassword 仅此一次返回，请转交本人后尽快改密；该密码不写入审计留痕。',
  })
  invite(@Body() dto: InviteUserDto, @CurrentUser() user: JwtUser) {
    return this.usersService.invite(dto, user);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  @ApiOperation({ summary: '停用 / 启用账号（即时生效；返回其仍负责的在招职位供提示）' })
  setStatus(@Param('id') id: string, @Body() dto: UpdateUserStatusDto, @CurrentUser() user: JwtUser) {
    return this.usersService.setStatus(id, dto.status, user);
  }

  @Patch(':id/roles')
  @RequirePermissions(PERMISSIONS.USER_MANAGE)
  @ApiOperation({ summary: '更新用户角色（全量替换；下一次请求即生效）' })
  updateRoles(@Param('id') id: string, @Body() dto: UpdateUserRolesDto, @CurrentUser() user: JwtUser) {
    return this.usersService.updateRoles(id, dto.roleCodes, user);
  }
}
