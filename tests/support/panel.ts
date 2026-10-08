import type { Browser } from '@e2e-dev/web';
import type { App } from 'e2e';

/**
 * 本文タブを別タブで開き、sidepanel.html を読み込んだタブから接続する。
 * side panel API ではなく公開の tabs API で開くため、拡張ページとして読み込む形になる。
 * 戻り値は本文タブの tabId と開いた時刻（自己編集系の時刻合わせに使う）。
 */
export async function connectPanel(
  app: App,
  browser: Browser,
  optionsUrl: string,
  draftUrl: string,
): Promise<{ tabId: number; openedAt: number }> {
  const openedAt = Date.now();
  const tabId = await browser.evaluate<number, string>(
    'async url => (await chrome.tabs.create({ url, active: false })).id',
    draftUrl,
  );
  await app.open(optionsUrl.replace('options.html', 'sidepanel.html'));
  await browser.evaluate('async id => { await chrome.tabs.update(id, { active: true }); }', tabId);
  return { tabId, openedAt };
}
