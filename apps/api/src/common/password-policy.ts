import { randomBytes } from 'node:crypto';

/** 密码规则：8–72 位（bcrypt 只取前 72 字节），至少含字母和数字 */
export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 72;
export const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).{8,72}$/;
export const PASSWORD_RULE_MESSAGE = '新密码需 8–72 位，且同时包含字母和数字';

/** 12 位随机密码：去掉易混淆字符，方便口头/IM 转交；保证字母、数字都有 */
export function randomPassword(): string {
  const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#%';
  for (;;) {
    const pw = Array.from(randomBytes(12), (b) => ALPHABET[b % ALPHABET.length]).join('');
    if (PASSWORD_RULE.test(pw)) return pw;
  }
}
