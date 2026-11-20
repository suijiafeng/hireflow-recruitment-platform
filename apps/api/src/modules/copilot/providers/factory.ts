import type { ConfigService } from '@nestjs/config';
import { guessProviderLabel } from '../../ai/engines/openai-compatible.engine';
import { AnthropicCopilotProvider } from './anthropic.provider';
import { MockCopilotProvider } from './mock.provider';
import { OpenAiCopilotProvider } from './openai.provider';
import type { CopilotProvider } from './types';

/**
 * 与 AiService 同一套环境变量选引擎（AI_PROVIDER / ANTHROPIC_* / AI_API_KEY + AI_BASE_URL），
 * 另可用 COPILOT_PROVIDER=mock 单独让 Copilot 走规则引擎（演示 / 压测），COPILOT_MODEL 覆盖模型名。
 */
export function createCopilotProvider(config: ConfigService, timeoutMs: number): CopilotProvider {
  const override = config.get<string>('COPILOT_PROVIDER')?.toLowerCase();
  const provider = override || (config.get<string>('AI_PROVIDER') ?? 'auto').toLowerCase();
  const mockDelay = Number(config.get<string>('COPILOT_MOCK_DELAY_MS') ?? 16);
  const mock = () => new MockCopilotProvider(Number.isFinite(mockDelay) && mockDelay >= 0 ? mockDelay : 16);
  if (provider === 'mock') return mock();

  const anthropicKey = config.get<string>('ANTHROPIC_API_KEY');
  const openaiKey = config.get<string>('AI_API_KEY');
  const openaiBase = config.get<string>('AI_BASE_URL');
  const modelOverride = config.get<string>('COPILOT_MODEL');

  if ((provider === 'anthropic' || provider === 'auto') && anthropicKey) {
    return new AnthropicCopilotProvider({
      apiKey: anthropicKey,
      baseURL: config.get<string>('ANTHROPIC_BASE_URL') || undefined,
      model: modelOverride || config.get<string>('ANTHROPIC_MODEL_FAST') || 'claude-haiku-4-5',
      timeoutMs,
    });
  }
  if ((provider === 'openai' || provider === 'auto') && openaiKey && openaiBase) {
    return new OpenAiCopilotProvider({
      apiKey: openaiKey,
      baseURL: openaiBase,
      model: modelOverride || config.get<string>('AI_MODEL') || 'deepseek-chat',
      kind: config.get<string>('AI_PROVIDER_LABEL') || guessProviderLabel(openaiBase),
      timeoutMs,
    });
  }
  return mock();
}
