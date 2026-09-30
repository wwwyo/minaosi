import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'minaosi',
    description: '人間が書いた文章を、公開面そのままの表示の上で AI が校閲するブラウザ拡張',
    // BYOK の直接接続。送信先は初回の説明・設定に明記
    host_permissions: ['https://api.anthropic.com/*', 'https://api.openai.com/*'],
    // 'wxt/storage'（chrome.storage.local）は storage permission が無いと content script で throw する
    permissions: ['storage'],
    icons: { 16: 'icons/icon-16.png', 48: 'icons/icon-48.png', 128: 'icons/icon-128.png' },
    // ブラウザのサイドpaneに表示し、note の DOM・レイアウトから独立させる
    action: { default_title: 'minaosi' },
  },
});
