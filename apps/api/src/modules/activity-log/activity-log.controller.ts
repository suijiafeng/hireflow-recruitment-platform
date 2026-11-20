import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PERMISSIONS } from '@hireflow/shared';
import { RequirePermissions } from '../../common/decorators/permissions.decorator';
import { ActivityLogService } from './activity-log.service';

@ApiTags('activity-log')
@ApiBearerAuth()
@Controller('activities')
export class ActivityLogController {
  constructor(private readonly service: ActivityLogService) {}

  @Get('recent')
  @RequirePermissions(PERMISSIONS.CONFIG_MANAGE)
  @ApiOperation({ summary: '审计日志：全局最近操作（分页）' })
  recent(@Query('page') page = '1', @Query('pageSize') pageSize = '20', @Query('actions') actions?: string) {
    return this.service.recent(Number(page) || 1, Math.min(Number(pageSize) || 20, 100), parseActionPrefixes(actions));
  }
}

/**
 * 动作前缀筛选：`actions=role.,user.,department.`。
 * 只接受「小写字母 / 下划线 + 点」形状的前缀，最多 10 个，其余忽略——不把任意字符串拼进查询。
 */
export function parseActionPrefixes(raw?: string): string[] | undefined {
  if (!raw) return undefined;
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter((s) => /^[a-z_]+(\.[a-z_]*)*$/.test(s))
    .slice(0, 10);
  return list.length ? list : undefined;
}
