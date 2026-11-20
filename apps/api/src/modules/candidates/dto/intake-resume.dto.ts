import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** 上传简历自动建档：multipart 表单里的文本字段 */
export class IntakeResumeDto {
  @ApiProperty({ description: '投递的职位（必选）' })
  @IsString()
  @MinLength(1, { message: '请选择职位' })
  jobId: string;

  @ApiPropertyOptional({ description: '来源渠道', example: 'BOSS直聘' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;
}
