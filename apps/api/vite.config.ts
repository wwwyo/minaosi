import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig(({ mode }) => ({
  plugins: [cloudflare({ inspectorPort: false, types: { generate: false } })],
  server: {
    host: '127.0.0.1',
    port: mode === 'gateway' ? 8788 : 8787,
    strictPort: true,
  },
}));
