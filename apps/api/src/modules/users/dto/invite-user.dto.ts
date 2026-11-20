import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayNotEmpty, ArrayUnique, IsEmail, IsOptional, IsString, Length } from 'class-validator';

export class InviteUserDto {
  @ApiProperty({ example: 'zhangsan@hireflow.local', description: '公司邮箱，登录账号' })
  @IsEmail({}, { message: '邮箱格式不正确' })
  email!: string;

  @ApiProperty({ example: '张三' })
  @IsString()
  @Length(1, 40)
  name!: string;

  @ApiPropertyOptional({ description: '所属部门 id' })
  @IsOptional()
  @IsString()
  departmentId?: string;

  @ApiProperty({
    type: [String],
    example: ['HR'],
    description: '初始角色码，至少一个',
  })
  @ArrayNotEmpty({ message: '至少分配一个角色' })
  @ArrayUnique()
  @IsString({ each: true })
  roleCodes!: string[];
}
