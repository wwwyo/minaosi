import { expect, test } from 'bun:test';
import { providerForModel } from './models';

test('選んだモデルの接続先だけにキーを送る', () => {
  expect(providerForModel('claude-sonnet-5')).toBe('anthropic');
  expect(providerForModel('gpt-5.4-mini')).toBe('openai');
  expect(providerForModel('o3')).toBe('openai');
  for (const value of ['', '__proto__', 'claude-', 'gpt-', 'gpt-../../evil', 'unknown-model']) expect(providerForModel(value)).toBeNull();
});
