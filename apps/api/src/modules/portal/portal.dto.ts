import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, Matches } from 'class-validator';

export class PortalPickDto {
  @ApiProperty({ description: '可选时段 id' })
  @IsString({ message: '请选择一个时段' })
  // 隐式类型转换会把对象变成 "[object Object]"，这里按 id 形状再卡一道
  @Matches(/^[\w-]{1,64}$/, { message: '请选择一个时段' })
  slotId: string;

  @ApiPropertyOptional({ description: '交集时段的开始时间（同一空闲档可能切出多个交集）' })
  @IsOptional()
  @IsDateString({}, { message: '时段开始时间格式不正确' })
  startAt?: string;
}
