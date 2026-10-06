import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** 获取门户链接；rotate=true 时重新生成令牌，旧链接立即失效 */
export class PortalLinkDto {
  @ApiPropertyOptional({ description: '重新生成链接（旧链接作废）' })
  @IsOptional()
  @IsBoolean()
  rotate?: boolean;
}
