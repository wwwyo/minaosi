import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';
import { extensionBrowser } from './tests/support/extension-browser';
import { accessModel } from './tests/support/access-model';

if (process.env.E2E_TELEMETRY_DISABLED !== '1') {
  throw new Error('Run e2e through mise exec -- bun run test:e2e to disable telemetry.');
}

const offline = process.env.MINAOSI_E2E_OFFLINE === '1';

export default {
  tests: 'tests/**/*.e2e.ts',
  workers: 1,
  retries: 0,
  timeout: 120_000,
  launchTimeout: 60_000,
  actionTimeout: 15_000,
  assertionTimeout: 10_000,
  cleanupTimeout: 30_000,
  cache: 'off',
  trace: 'on',
  reporters: ['list', 'junit'],
  targets: [
    {
      name: 'extension',
      engine: web({ browser: extensionBrowser() }),
      app: {
        url: 'http://127.0.0.1:0/__health',
        command: {
          executable: 'env',
          args: ['-i', `PATH=${process.env.PATH ?? ''}`, `HOME=${process.env.HOME ?? ''}`, 'PORT={port}', 'bun', 'tests/support/site.ts'],
          log: '.e2e/logs/site.log',
        },
      },
    },
  ],
  agents: offline ? {} : {
    default: {
      model: accessModel(),
      context: 'minaosi is a proofreading extension. Its options screen configures 校閲の使い方. 保存する persists changes. Proofreading rules are managed internally, without user tuning.',
      system: 'Operate only the synthetic local test data. Verify each goal on screen. Do not run proofreading, open external links, or change settings outside this test profile.',
      maxSteps: 10,
      maxModelCalls: 10,
      judgmentTimeout: 60_000,
      maxInputTokens: 32_768,
    },
  },
  secrets: { 'byok-test-key': 'e2e-not-a-real-api-key' },
} satisfies E2EConfig;
