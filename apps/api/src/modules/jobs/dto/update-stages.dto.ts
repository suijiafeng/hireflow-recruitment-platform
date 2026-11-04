import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsOptional,
  IsString,
  MinLength,
  ValidateNested,
} from 'class-validator';

export class StageItemDto {
  @ApiPropertyOptional({ description: '已有阶段的 id；新增阶段不传' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: '一面' })
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(1)
  name: string;
}

export class UpdateStagesDto {
  @ApiProperty({ type: [StageItemDto], description: '按顺序给出全量阶段，缺失的视为删除' })
  @IsArray()
  @ArrayMinSize(1, { message: '至少保留一个阶段' })
  @ValidateNested({ each: true })
  @Type(() => StageItemDto)
  stages: StageItemDto[];
}
