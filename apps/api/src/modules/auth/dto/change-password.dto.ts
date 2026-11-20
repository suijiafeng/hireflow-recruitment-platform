import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { PASSWORD_MAX, PASSWORD_RULE, PASSWORD_RULE_MESSAGE } from '../../../common/password-policy';

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1, { message: '请输入当前密码' })
  @MaxLength(PASSWORD_MAX)
  currentPassword: string;

  @ApiProperty({ description: PASSWORD_RULE_MESSAGE })
  @IsString()
  @Matches(PASSWORD_RULE, { message: PASSWORD_RULE_MESSAGE })
  newPassword: string;
}
