import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { OFFER_DECLINE_REASONS } from '@hireflow/shared';

/** Offer 薪资包字段（发起与修改重提共用） */
export class OfferPackageDto {
  @ApiProperty({ description: '月薪（base，元）', example: 30000 })
  @IsInt()
  @Min(1000)
  @Max(1_000_000)
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

  @ApiPropertyOptional({ description: '备注（审批人可见）' })
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

/** 驳回后修改重提（驳回带意见退回 HR 修改重提） */
export class ResubmitOfferDto extends OfferPackageDto {}

export class ApprovalDto {
  @ApiPropertyOptional({ description: '审批意见（驳回时将随 Offer 退回 HR）' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
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
