import { IsIn, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

const CONTEXT_TYPES = ['candidate', 'job'] as const;

export class CreateConversationDto {
  @IsOptional()
  @IsString()
  @MaxLength(60)
  title?: string;

  @IsOptional()
  @IsIn(CONTEXT_TYPES)
  contextType?: (typeof CONTEXT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contextId?: string;
}

export class RenameConversationDto {
  @IsString()
  @MinLength(1)
  @MaxLength(60)
  title!: string;
}

export class SendMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  content!: string;

  @IsOptional()
  @IsIn(CONTEXT_TYPES)
  contextType?: (typeof CONTEXT_TYPES)[number];

  @IsOptional()
  @IsString()
  @MaxLength(64)
  contextId?: string;
}
