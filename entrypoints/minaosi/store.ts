import { storage } from '#imports';
import type { ReviewProvider } from './review/providers';
/** BYOK。key は利用者が設定画面で登録し、この拡張のローカル領域にのみ保持する */
export const apiKeyItem = storage.defineItem<string>('local:apiKey', { fallback: '' });
export const modelItem = storage.defineItem<string>('local:model', { fallback: 'claude-sonnet-5' });
/** 初回「見直す」前の送信同意。一度同意すれば再実行のたびには聞かない */
export const consentedItem = storage.defineItem<boolean>('local:gatewayConsented', { fallback: false });

export const providerItem = storage.defineItem<ReviewProvider>('local:provider', { fallback: 'anthropic' });
export const openaiKeyItem = storage.defineItem<string>('local:openaiKey', { fallback: '' });
export const openaiModelItem = storage.defineItem<string>('local:openaiModel', { fallback: '' });
export const openaiConsentedItem = storage.defineItem<boolean>('local:openaiGatewayConsented', { fallback: false });

export const PROVIDER_LABELS: Record<ReviewProvider, string> = {
  anthropic: 'Anthropic（api.anthropic.com）',
  openai: 'OpenAI（api.openai.com）',
};

export const PROVIDER_SETTINGS = {
  anthropic: { key: apiKeyItem, model: modelItem, consented: consentedItem },
  openai: { key: openaiKeyItem, model: openaiModelItem, consented: openaiConsentedItem },
};
