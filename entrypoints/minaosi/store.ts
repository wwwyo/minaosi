import { storage } from '#imports';
import { DEFAULT_RULE_STATE } from './rubric';

/** BYOK。key は利用者が設定画面で登録し、この拡張のローカル領域にのみ保持する */
export const apiKeyItem = storage.defineItem<string>('local:apiKey', { fallback: '' });
export const modelItem = storage.defineItem<string>('local:model', { fallback: 'claude-sonnet-5-5' });
/** 初回「見直す」前の送信同意。一度同意すれば再実行のたびには聞かない */
export const consentedItem = storage.defineItem<boolean>('local:consented', { fallback: false });
export const ruleTogglesItem = storage.defineItem<Record<string, boolean>>('local:ruleToggles', {
  fallback: { ...DEFAULT_RULE_STATE },
});
export const styleGuideItem = storage.defineItem<{ name: string; content: string } | null>(
  'local:styleGuide',
  { fallback: null },
);

export const PROVIDER_LABEL = 'Anthropic（api.anthropic.com）';
