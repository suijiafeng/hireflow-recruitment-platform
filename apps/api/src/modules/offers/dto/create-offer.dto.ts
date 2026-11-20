import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { OFFER_DECLINE_REASONS } from '@hireflow/shared';

/** Offer 薪资包字段 */
export class OfferPackageDto {
  @ApiProperty({ description: '月薪（base，元）', example: 30000 })
  @IsInt({ message: '月薪必须是整数' })
  @Min(1000, { message: '月薪不能低于 1000 元' })
  @Max(1_000_000, { message: '月薪不能超过 100 万元' })
  salaryBase: number;

  @ApiPropertyOptional({ description: '年终奖月数', example: 3 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(12)
  bonusMonths?: number;

  @ApiProperty({ description: '预计入职日期（YYYY-MM-DD）', example: '2026-11-02' })
  @IsDateString({ strict: true }, { message: '请填写预计入职日期' })
  startDate: string;

  @ApiPropertyOptional({ description: '职级', example: 'P6' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  grade?: string;

  @ApiPropertyOptional({ description: '备注（内部可见）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CreateOfferDto extends OfferPackageDto {
  @ApiProperty({ description: '应聘记录 id' })
  @IsString()
  applicationId: string;
}

export class RespondDto {
  @ApiProperty({ enum: ['ACCEPTED', 'DECLINED'], description: '候选人答复' })
  @IsIn(['ACCEPTED', 'DECLINED'])
  decision: 'ACCEPTED' | 'DECLINED';

  @ApiPropertyOptional({
    description: '拒绝原因码（DECLINED 时必选）',
    enum: OFFER_DECLINE_REASONS,
  })
  @ValidateIf((o: RespondDto) => o.decision === 'DECLINED')
  @IsIn([...OFFER_DECLINE_REASONS], { message: '拒绝 Offer 必须选择原因码' })
  reason?: string;
}
