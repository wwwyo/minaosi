import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'minaosi',
    description: '人間が書いた文章を、公開面そのままの表示の上で AI が校閲するブラウザ拡張',
    // BYOK: 原稿は利用者の API key で Anthropic に送る。送信先は consent 画面・設定に明記
    host_permissions: ['https://api.anthropic.com/*'],
  },
});
