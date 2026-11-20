/** 工具参数校验：模型给的参数一律当不可信输入，逐个按类型 / 长度 / 枚举收紧 */
export class ToolArgError extends Error {}

type Args = Record<string, unknown>;

export function str(args: Args, key: string, opts: { max: number; min?: number }): string;
export function str(args: Args, key: string, opts: { max: number; min?: number; optional: true }): string | undefined;
export function str(args: Args, key: string, opts: { max: number; min?: number; optional?: boolean }) {
  const raw = args[key];
  if (raw == null || (typeof raw === 'string' && raw.trim() === '')) {
    if (opts.optional) return undefined;
    throw new ToolArgError(`缺少参数 ${key}`);
  }
  if (typeof raw !== 'string') throw new ToolArgError(`参数 ${key} 必须是字符串`);
  const value = raw.trim();
  if (value.length > opts.max) throw new ToolArgError(`参数 ${key} 过长（最多 ${opts.max} 字）`);
  if (opts.min && value.length < opts.min) throw new ToolArgError(`参数 ${key} 过短（至少 ${opts.min} 字）`);
  return value;
}

export function int(args: Args, key: string, opts: { min: number; max: number; fallback: number }): number {
  const raw = args[key];
  if (raw == null || raw === '') return opts.fallback;
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) throw new ToolArgError(`参数 ${key} 必须是数字`);
  return Math.min(opts.max, Math.max(opts.min, Math.round(n)));
}

export function oneOf<T extends string>(args: Args, key: string, values: readonly T[], optional = false): T | undefined {
  const raw = args[key];
  if (raw == null || raw === '') {
    if (optional) return undefined;
    throw new ToolArgError(`缺少参数 ${key}`);
  }
  if (typeof raw !== 'string' || !values.includes(raw as T)) {
    throw new ToolArgError(`参数 ${key} 只能是：${values.join(' / ')}`);
  }
  return raw as T;
}

export function strList(args: Args, key: string, opts: { maxItems: number; maxLength: number }): string[] {
  const raw = args[key];
  if (raw == null) return [];
  const list = Array.isArray(raw) ? raw : [raw];
  return list
    .filter((v): v is string => typeof v === 'string')
    .map((v) => v.trim())
    .filter((v) => v && v.length <= opts.maxLength)
    .slice(0, opts.maxItems);
}
