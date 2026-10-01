import { defineWranglerConfig } from 'wrangler/experimental-config';

export default defineWranglerConfig(({ mode }) => ({
  dev: { ip: '127.0.0.1', port: mode === 'gateway' ? 8788 : 8787 },
}));
