import { BadRequestException, ValidationPipe, type ValidationError } from '@nestjs/common';

/** class-validator 约束名 → 中文（DTO 里已写中文 message 的保持原样） */
const CONSTRAINT_MESSAGES: Record<string, (field: string, c: string) => string> = {
  isNotEmpty: (f) => `${f}不能为空`,
  isDefined: (f) => `${f}为必填项`,
  isString: (f) => `${f}必须是文本`,
  isInt: (f) => `${f}必须是整数`,
  isNumber: (f) => `${f}必须是数字`,
  isBoolean: (f) => `${f}必须是布尔值`,
  isEmail: (f) => `${f}不是有效的邮箱`,
  isEnum: (f) => `${f}的取值不在允许范围内`,
  isIn: (f) => `${f}的取值不在允许范围内`,
  isArray: (f) => `${f}必须是数组`,
  arrayNotEmpty: (f) => `${f}至少需要一项`,
  arrayMinSize: (f, c) => `${f}的数量不足（${c}）`,
  arrayMaxSize: (f, c) => `${f}的数量超出上限（${c}）`,
  arrayUnique: (f) => `${f}不能有重复项`,
  isDateString: (f) => `${f}不是有效的日期时间`,
  isISO8601: (f) => `${f}不是有效的日期时间`,
  isDate: (f) => `${f}不是有效的日期`,
  isUUID: (f) => `${f}格式不正确`,
  isObject: (f) => `${f}必须是对象`,
  min: (f, c) => `${f}过小（${c}）`,
  max: (f, c) => `${f}过大（${c}）`,
  minLength: (f, c) => `${f}太短（${c}）`,
  maxLength: (f, c) => `${f}太长（${c}）`,
  length: (f, c) => `${f}长度不符合要求（${c}）`,
  matches: (f) => `${f}格式不正确`,
  isUrl: (f) => `${f}不是有效的链接`,
  isPositive: (f) => `${f}必须大于 0`,
  whitelistValidation: (f) => `不支持的字段：${f}`,
  nestedValidation: (f) => `${f}格式不正确`,
};

const HAS_CJK = /[\u4e00-\u9fa5]/;

/** 从 class-validator 默认英文里抽出约束参数（如「must be shorter than or equal to 50 characters」里的 50） */
function constraintHint(raw: string): string {
  const nums = raw.match(/-?\d+(\.\d+)?/g);
  return nums ? nums.join('–') : '';
}

export function flattenValidationErrors(errors: ValidationError[], parent = ''): string[] {
  const out: string[] = [];
  for (const e of errors) {
    const field = parent ? `${parent}.${e.property}` : e.property;
    for (const [key, raw] of Object.entries(e.constraints ?? {})) {
      if (HAS_CJK.test(raw)) {
        out.push(raw);
        continue;
      }
      const fn = CONSTRAINT_MESSAGES[key];
      out.push(fn ? fn(`「${field}」`, constraintHint(raw)) : `「${field}」不符合要求`);
    }
    if (e.children?.length) out.push(...flattenValidationErrors(e.children, field));
  }
  return [...new Set(out)];
}

export function createValidationPipe() {
  return new ValidationPipe({
    whitelist: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
    exceptionFactory: (errors) =>
      new BadRequestException({ message: flattenValidationErrors(errors), code: 'VALIDATION_FAILED' }),
  });
}
