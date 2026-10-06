import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { CurrentUser, type JwtUser } from '../../common/decorators/current-user.decorator';
import { RequireAnyPermission, RequirePermissions } from '../../common/decorators/permissions.decorator';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateRoleDto } from './dto/create-role.dto';
import { UpdateRolePermissionsDto } from './dto/update-role-permissions.dto';
import { RbacService } from './rbac.service';

@ApiTags('rbac')
@ApiBearerAuth()
@Controller()
export class RbacController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
  ) {}

  @Get('roles')
  // 角色矩阵只给系统设置使用者看：成员管理需要选角色，权限配置需要看矩阵
  @RequireAnyPermission(PERMISSIONS.USER_MANAGE, PERMISSIONS.CONFIG_MANAGE)
  @ApiOperation({ summary: '角色列表（含权限点）' })
  roles() {
    return this.prisma.role.findMany({
      include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  @Get('permissions')
  // 角色矩阵只给系统设置使用者看：成员管理需要选角色，权限配置需要看矩阵
  @RequireAnyPermission(PERMISSIONS.USER_MANAGE, PERMISSIONS.CONFIG_MANAGE)
  @ApiOperation({ summary: '全部权限点' })
  permissions() {
    return this.prisma.permission.findMany({ orderBy: [{ group: 'asc' }, { code: 'asc' }] });
  }

  @Post('roles')
  @RequirePermissions(PERMISSIONS.CONFIG_MANAGE)
  @ApiOperation({
    summary: '新建自定义角色',
    description: 'ADMIN 与门户角色码为系统保留，不可新建；dataScope 缺省 ASSIGNED（最小权限）。',
  })
  createRole(@Body() dto: CreateRoleDto, @CurrentUser() user: JwtUser) {
    return this.rbacService.createRole(dto, user);
  }

  @Patch('roles/:id/permissions')
  @RequirePermissions(PERMISSIONS.CONFIG_MANAGE)
  @ApiOperation({ summary: '更新角色权限（全量替换；相关用户重新登录后生效）' })
  updateRolePermissions(
    @Param('id') id: string,
    @Body() dto: UpdateRolePermissionsDto,
    @CurrentUser() user: JwtUser,
  ) {
    return this.rbacService.updateRolePermissions(id, dto.codes, user);
  }
}
