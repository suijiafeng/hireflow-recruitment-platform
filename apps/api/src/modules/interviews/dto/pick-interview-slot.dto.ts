import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class PickInterviewSlotDto {
  @ApiProperty({ description: '共同空闲窗口对应的主时段 ID' })
  @Transform(({ obj }) => obj.slotId)
  @IsString()
  @IsNotEmpty()
  slotId: string;

  @ApiPropertyOptional({ description: '共同空闲窗口起点；兼容旧客户端省略此字段' })
  @Transform(({ obj }) => obj.startAt)
  @IsOptional()
  @IsDateString()
  startAt?: string;
}
