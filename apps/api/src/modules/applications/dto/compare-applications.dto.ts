import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsString,
  Matches,
} from 'class-validator';

export class CompareApplicationsDto {
  @ApiProperty({ description: '同一职位下的应聘记录 ID（2-4 个，不可重复）', type: [String] })
  @IsArray({ message: 'ids 必须是数组' })
  @ArrayMinSize(2, { message: '对比至少需要 2 条应聘记录' })
  @ArrayMaxSize(4, { message: '对比最多支持 4 条应聘记录' })
  @ArrayUnique({ message: '应聘记录 ID 不能重复' })
  @IsString({ each: true, message: '应聘记录 ID 必须是字符串' })
  @Matches(/\S/, { each: true, message: '应聘记录 ID 不能为空白' })
  ids: string[];
}
