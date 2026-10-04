import { randomUUID } from 'node:crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';
import { extensionBrowser } from './tests/support/extension-browser';

const apiKey = process.env.OPENCODE_API_KEY;
const model = process.env.OPENCODE_E2E_MODEL;
if (!apiKey || !model) {
  throw new Error('OPENCODE_API_KEY and OPENCODE_E2E_MODEL are required; run through mise with age decryption enabled.');
}
if (process.env.E2E_TELEMETRY_DISABLED !== '1') {
  throw new Error('Run e2e through mise exec -- bun run test:e2e to disable telemetry.');
}

const go = createOpenAICompatible({
  name: 'opencode-go',
  baseURL: 'https://opencode.ai/zen/go/v1',
  apiKey,
  supportsStructuredOutputs: true,
  headers: {
    'User-Agent': 'wwwyo-e2e/0.1',
    'x-opencode-session': randomUUID(),
  },
});

export default {
  tests: 'tests/**/*.e2e.ts',
  workers: 1,
  targets: [
    {
      name: 'extension',
      engine: web({ browser: extensionBrowser() }),
      app: {
        url: 'http://127.0.0.1:0',
        command: {
          executable: 'bun',
          args: ['tests/support/site.ts'],
          env: { PORT: '{port}' },
          log: '.e2e/logs/site.log',
        },
      },
    },
  ],
  agents: {
    default: {
      model: go(model),
      context: 'minaosi is a proofreading extension. Its options screen configures 校閲の使い方. 保存する persists changes. Proofreading rules are managed internally, without user tuning.',
      system: 'Operate only the synthetic local test data. Verify each goal on screen. Do not run proofreading, open external links, or change settings outside this test profile.',
      maxSteps: 10,
      maxModelCalls: 10,
    },
  },
  secrets: { 'byok-test-key': 'e2e-not-a-real-api-key' },
} satisfies E2EConfig;
