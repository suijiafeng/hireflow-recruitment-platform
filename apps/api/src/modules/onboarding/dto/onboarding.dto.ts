import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** 新员工在候选人页填写的入职信息 */
export class OnboardingInfoDto {
  @ApiProperty({ description: '身份证号' })
  @Matches(/^\d{17}[\dXx]$/, { message: '请填写 18 位身份证号' })
  idNumber: string;

  @ApiProperty({ description: '开户银行' })
  @IsString()
  @MinLength(2, { message: '请填写开户银行' })
  @MaxLength(50, { message: '开户银行不能超过 50 个字' })
  bankName: string;

  @ApiProperty({ description: '工资卡号' })
  @Matches(/^\d{12,19}$/, { message: '工资卡号应为 12–19 位数字' })
  bankAccount: string;

  @ApiProperty({ description: '现居住地址' })
  @IsString()
  @MinLength(4, { message: '请填写现居住地址' })
  @MaxLength(200, { message: '地址不能超过 200 个字' })
  address: string;

  @ApiProperty({ description: '紧急联系人' })
  @IsString()
  @MinLength(1, { message: '请填写紧急联系人' })
  @MaxLength(30, { message: '紧急联系人不能超过 30 个字' })
  emergencyContact: string;

  @ApiProperty({ description: '紧急联系人电话' })
  @Matches(/^[\d+\- ]{6,20}$/, { message: '紧急联系人电话格式不正确' })
  emergencyPhone: string;
}

/** 新员工确认劳动合同：输入本人姓名，与档案姓名一致才算确认 */
export class SignContractDto {
  @ApiProperty({ description: '本人姓名' })
  @IsString()
  @MinLength(1, { message: '请输入本人姓名' })
  @MaxLength(30)
  signerName: string;
}

export class CompleteOnboardingDto {
  @ApiPropertyOptional({ description: '备注（如实际到岗日期）' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  note?: string;
}
