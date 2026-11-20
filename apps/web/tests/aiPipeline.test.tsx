import { render, screen } from '@testing-library/react';
import { AxiosError, AxiosHeaders } from 'axios';
import { describe, expect, it } from 'vitest';
import { AI_BATCH_TIMEOUT_MS, AI_TIMEOUT_MS, TIMEOUT_MESSAGE, extractErrorMessage, isTimeoutError } from '../src/api/client';
import { RuleScoreMark } from '../src/components/ui';
import { providerLabel } from '../src/utils/aiProvider';
import { resumeParseState } from '../src/utils/resumeParse';

const timeoutError = () => new AxiosError('timeout of 60000ms exceeded', 'ECONNABORTED');
const httpError = (status: number, message: string) =>
  new AxiosError('x', 'ERR_BAD_RESPONSE', undefined, undefined, {
    status,
    statusText: '',
    headers: {},
    config: { headers: new AxiosHeaders() },
    data: { message },
  });

describe('AI 请求超时', () => {
  it('AI 超时比后端单次截止（40s）长，批量接口比后端整体预算（约 85s）长', () => {
    expect(AI_TIMEOUT_MS).toBeGreaterThan(40_000);
    expect(AI_BATCH_TIMEOUT_MS).toBeGreaterThan(85_000);
  });

  it('前端等待超时提示「后台可能仍在处理」，不说「失败」', () => {
    expect(isTimeoutError(timeoutError())).toBe(true);
    expect(extractErrorMessage(timeoutError(), '解析失败')).toBe(TIMEOUT_MESSAGE);
    expect(TIMEOUT_MESSAGE).toContain('后台可能仍在处理');
  });

  it('后端返回的错误照常展示（含限流 429）', () => {
    expect(isTimeoutError(httpError(429, 'AI 请求过于频繁'))).toBe(false);
    expect(extractErrorMessage(httpError(429, 'AI 请求过于频繁，请 30 秒后再试'))).toContain('过于频繁');
  });
});

describe('简历解析状态', () => {
  const now = Date.parse('2026-11-20T10:00:00Z');
  it('PARSING 两分钟内是「解析中」，超时或没有开始时间是「中断」可重试', () => {
    expect(resumeParseState({ parseStatus: 'PARSING', parseStartedAt: '2026-11-20T09:59:30Z' }, now)).toBe('parsing');
    expect(resumeParseState({ parseStatus: 'PARSING', parseStartedAt: '2026-11-20T09:57:00Z' }, now)).toBe('stale');
    expect(resumeParseState({ parseStatus: 'PARSING', parseStartedAt: null }, now)).toBe('stale');
  });
  it('其他状态原样映射', () => {
    expect(resumeParseState({ parseStatus: 'DONE' })).toBe('done');
    expect(resumeParseState({ parseStatus: 'FAILED' })).toBe('failed');
    expect(resumeParseState({ parseStatus: 'PENDING' })).toBe('pending');
  });
});

describe('AI 来源标注', () => {
  it('provider 显示名：mock 显示规则引擎；状态未加载时不先显示「规则引擎」', () => {
    expect(providerLabel('mock')).toBe('规则引擎');
    expect(providerLabel(undefined)).toBe('');
    expect(providerLabel('deepseek:deepseek-chat')).toBe('deepseek:deepseek-chat');
    expect(providerLabel('anthropic:claude-opus-4-8·缓存')).toBe('anthropic:claude-opus-4-8 · 缓存');
  });

  it('只有规则引擎打的分才显示「规则」标记', () => {
    const { rerender } = render(<RuleScoreMark source="rule" />);
    expect(screen.getByText('规则')).toBeTruthy();
    rerender(<RuleScoreMark source="ai" />);
    expect(screen.queryByText('规则')).toBeNull();
    rerender(<RuleScoreMark source={null} />);
    expect(screen.queryByText('规则')).toBeNull();
  });
});
