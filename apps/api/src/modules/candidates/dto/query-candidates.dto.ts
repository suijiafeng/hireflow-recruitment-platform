import { ApiPropertyOptional } from '@nestjs/swagger';
import { StageKind } from '@hireflow/shared';
import { IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/** 列表筛选条件（导出复用同一套，不含分页） */
export class CandidateFilterDto {
  @ApiPropertyOptional({ description: '按姓名/邮箱/电话/标签模糊搜索' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ enum: ['screening'], description: 'screening = 仍在招职位「第一阶段」待初筛（与大盘待办同口径）' })
  @IsOptional()
  @IsIn(['screening'])
  stage?: 'screening';

  @ApiPropertyOptional({ description: '应聘职位' })
  @IsOptional()
  @IsString()
  jobId?: string;

  @ApiPropertyOptional({ enum: StageKind, description: '当前所在阶段类型' })
  @IsOptional()
  @IsEnum(StageKind)
  stageKind?: StageKind;

  @ApiPropertyOptional({ enum: ['ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN', 'NONE'], description: '应聘状态；NONE = 未投递任何职位' })
  @IsOptional()
  @IsIn(['ACTIVE', 'HIRED', 'REJECTED', 'WITHDRAWN', 'NONE'])
  status?: 'ACTIVE' | 'HIRED' | 'REJECTED' | 'WITHDRAWN' | 'NONE';

  @ApiPropertyOptional({ description: '来源渠道（精确匹配）' })
  @IsOptional()
  @IsString()
  @MaxLength(40)
  source?: string;

  @ApiPropertyOptional({ description: '最低匹配分（任一应聘达到即可）' })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100)
  minScore?: number;

  @ApiPropertyOptional({ description: '建档起始日期（含），YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  createdFrom?: string;

  @ApiPropertyOptional({ description: '建档截止日期（含），YYYY-MM-DD' })
  @IsOptional()
  @IsDateString()
  createdTo?: string;
}

export class QueryCandidatesDto extends CandidateFilterDto {
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize?: number = 20;
}
