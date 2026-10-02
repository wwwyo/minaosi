const KEY = 'minaosi:show-handled';

export function readHandledVisibility(): boolean {
  try { return localStorage.getItem(KEY) === 'true'; } catch { return false; }
}

export function writeHandledVisibility(visible: boolean): void {
  // ストレージが使えない環境でも、当該 pane の表示切替は続けられる。
  try { localStorage.setItem(KEY, String(visible)); } catch {}
}
