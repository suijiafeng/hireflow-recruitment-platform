import type { Resume } from '../api/types';

/** 与后端 PARSE_STALE_MS 一致：PARSING 超过 2 分钟视为上次解析中断，可重新发起 */
const PARSE_STALE_MS = 120_000;

/** 简历解析状态：PARSING 且未超时 = 正在解析（禁用按钮、轮询）；超时 = 中断可重试 */
export function resumeParseState(resume: Pick<Resume, 'parseStatus' | 'parseStartedAt'>, now = Date.now()) {
  if (resume.parseStatus === 'DONE') return 'done' as const;
  if (resume.parseStatus === 'FAILED') return 'failed' as const;
  if (resume.parseStatus === 'PARSING') {
    const started = resume.parseStartedAt ? new Date(resume.parseStartedAt).getTime() : 0;
    return started && now - started < PARSE_STALE_MS ? ('parsing' as const) : ('stale' as const);
  }
  return 'pending' as const;
}

