import { defineConfig } from 'wxt';

function reviewEndpoint(mode: string): string {
  const endpoint = process.env.WXT_REVIEW_API_URL || (mode === 'development' ? 'http://127.0.0.1:8787/review' : '');
  if (!endpoint) return '';
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/review') {
    throw new Error('WXT_REVIEW_API_URL must point to /review without credentials or query parameters');
  }
  if (url.protocol !== 'https:' && !(mode === 'development' && url.protocol === 'http:' && ['127.0.0.1', 'localhost'].includes(url.hostname))) {
    throw new Error('WXT_REVIEW_API_URL must use HTTPS (localhost is allowed in development)');
  }
  return endpoint;
}

export default defineConfig({
  vite: ({ mode }) => ({ define: { 'import.meta.env.WXT_REVIEW_API_URL': JSON.stringify(reviewEndpoint(mode)) } }),
  manifest: ({ mode }) => {
    const endpoint = reviewEndpoint(mode);
    return {
      name: 'minaosi',
      description: '人間が書いた文章を、公開面そのままの表示の上で AI が校閲するブラウザ拡張',
      host_permissions: endpoint ? [`${new URL(endpoint).origin}/*`] : [],
      permissions: ['storage'],
      icons: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
      action: { default_title: 'minaosi' },
    };
  },
});
