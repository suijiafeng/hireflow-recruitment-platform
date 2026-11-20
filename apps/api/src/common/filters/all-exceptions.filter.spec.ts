import { BadRequestException, type ArgumentsHost } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';
import { flattenValidationErrors } from '../validation';
import { AllExceptionsFilter } from './all-exceptions.filter';

function run(exception: unknown) {
  const json = jest.fn();
  const res = { headersSent: false, status: jest.fn().mockReturnValue({ json }) };
  const host = {
    switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ requestId: 'rid-1' }) }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return { status: res.status.mock.calls[0][0] as number, body: json.mock.calls[0][0] };
}

const prismaError = (code: string, meta?: Record<string, unknown>) =>
  new Prisma.PrismaClientKnownRequestError('x', { code, clientVersion: 'test', meta });

describe('AllExceptionsFilter', () => {
  it('唯一约束冲突 → 409 中文提示', () => {
    expect(run(prismaError('P2002', { target: ['email'] }))).toMatchObject({
      status: 409,
      body: { code: 'CONFLICT', message: '该邮箱已被使用', requestId: 'rid-1' },
    });
    expect(run(prismaError('P2002')).body.message).toBe('数据已存在，请勿重复提交');
  });

  it('记录不存在 → 404；外键冲突 → 409', () => {
    expect(run(prismaError('P2025')).status).toBe(404);
    expect(run(prismaError('P2003')).status).toBe(409);
  });

  it('HttpException 保留原信息与附加字段', () => {
    const { status, body } = run(new BadRequestException({ message: ['a', 'b'], code: 'VALIDATION_FAILED' }));
    expect(status).toBe(400);
    expect(body).toMatchObject({ statusCode: 400, code: 'VALIDATION_FAILED', message: ['a', 'b'], requestId: 'rid-1' });
  });

  it('未知异常 → 500，不外泄内部错误信息', () => {
    const { status, body } = run(new Error('connection string postgres://secret'));
    expect(status).toBe(500);
    expect(JSON.stringify(body)).not.toContain('secret');
    expect(body.message).toContain('服务器');
  });
});

describe('中文校验信息', () => {
  it('英文默认信息译成中文，已写中文的保持原样，嵌套字段带路径', () => {
    const messages = flattenValidationErrors([
      { property: 'title', constraints: { isNotEmpty: 'title should not be empty', maxLength: 'title must be shorter than or equal to 50 characters' }, children: [] },
      { property: 'email', constraints: { isEmail: '邮箱格式不正确' }, children: [] },
      { property: 'salary', children: [{ property: 'base', constraints: { isInt: 'base must be an integer number' }, children: [] }] },
    ]);
    expect(messages).toEqual(['「title」不能为空', '「title」太长（50）', '邮箱格式不正确', '「salary.base」必须是整数']);
  });
});
