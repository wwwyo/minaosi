/** shadow root 内の chrome スタイル。値の正本は repo root design.md（--color-* はその語彙）。 */

export const PANEL_CSS = `
:host { all: initial; }
*, *::before, *::after { box-sizing: border-box; }

:host, .mn {
  --color-bg-canvas: oklch(99% 0.002 264);
  --color-bg-panel: oklch(97% 0.004 264);
  --color-bg-surface: oklch(100% 0 0);
  --color-bg-hover: oklch(95% 0.006 264);
  --color-ink: oklch(24% 0.02 264);
  --color-ink-sub: oklch(44% 0.02 264);
  --color-ink-mute: oklch(52% 0.02 264);
  --color-line: oklch(87% 0.008 264);
  --color-line-strong: oklch(80% 0.01 264);
  --color-primary: oklch(24% 0.02 264);
  --color-on-primary: oklch(100% 0 0);
  --color-accent: oklch(48% 0.13 155);
  --color-on-accent: oklch(100% 0 0);
  --color-accent-ink: oklch(43% 0.12 155);
  --color-accent-tint: oklch(94.5% 0.03 155);
  --color-strike: oklch(52% 0.07 20);
  --color-ring: var(--color-accent);
  --color-flash: oklch(24% 0.02 264 / 0.25);
  --font-ui: -apple-system, BlinkMacSystemFont, "Hiragino Sans", "Yu Gothic", "Noto Sans JP", "Segoe UI", sans-serif;
  --font-size-micro: 10px;
  --font-size-caption: 11.5px;
  --font-size-small: 12.5px;
  --font-size-body: 13px;
  --font-size-brand: 14px;
  --line-height-ui: 1.6;
  --radius-sm: 3px;
  --radius-md: 5px;
  --radius-full: 999px;
  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-5: 20px; --space-6: 24px;
  --shadow-pop: 0 4px 14px oklch(0% 0 0 / 0.25);
  --shadow-fab: 0 2px 8px oklch(0% 0 0 / 0.18);
  --shadow-fab-hover: 0 4px 14px oklch(0% 0 0 / 0.24);
  --ease-out: cubic-bezier(0.23, 1, 0.32, 1);
  --dur-fast: 150ms;
  --dur-med: 220ms;
}
.mn {
  font-family: var(--font-ui);
  color: var(--color-ink);
  font-size: var(--font-size-body);
  line-height: var(--line-height-ui);
  -webkit-font-smoothing: antialiased;
}
.mn :focus { outline: none; }
.mn :focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; border-radius: var(--radius-sm); }
.mn button { font-family: inherit; }

/* ---- panel ---- */
.panel {
  width: 100%; height: 100dvh;
  display: flex; flex-direction: column;
  background: transparent;
}
.handled-heading { display: flex; align-items: center; justify-content: space-between; padding: 12px 16px; color: var(--color-ink-mute); font-size: var(--font-size-caption); }
.handled-heading button { display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: 0; border-radius: var(--radius-md); background: transparent; color: inherit; cursor: pointer; }
.handled-heading button:hover { background: var(--color-bg-hover); color: var(--color-ink-sub); }
.handled-heading svg { width: 14px; height: 14px; }

.list { position: relative; overflow-y: auto; flex: 1; min-height: 0; }
.empty-start { height: 100%; display: flex; flex-direction: column; gap: var(--space-3); align-items: center; justify-content: center; }
.mn .empty { padding: 24px 16px; color: var(--color-ink-mute); font-size: var(--font-size-small); text-align: center; }
.list .notice { padding: 24px 16px; color: var(--color-ink-sub); font-size: var(--font-size-small); }
.list .notice .actions { margin-top: var(--space-3); display: flex; gap: var(--space-2); }

/* ---- finding card ---- */
.n-item {
  display: block; width: 100%; padding: 12px 16px;
  border-bottom: 1px solid var(--color-line);
  border-left: 3px solid transparent;
  cursor: pointer; position: relative;
  transition: background var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out);
}
.n-item:hover { background: var(--color-bg-hover); }
.n-item[data-sel] { border-left-color: var(--color-ink); background: transparent; }
.n-item .detail { display: grid; grid-template-rows: 0fr; opacity: 0; transform: translateY(8px); transition: grid-template-rows var(--dur-med) var(--ease-out), opacity var(--dur-med) var(--ease-out), transform var(--dur-med) var(--ease-out); }
.n-item .detail-body { min-height: 0; overflow: hidden; }
.n-item[data-sel] .detail { grid-template-rows: 1fr; opacity: 1; transform: translateY(0); }
.n-item .meta { display: flex; align-items: baseline; gap: 6px; padding-right: 54px; }
.n-item .kind { font-size: var(--font-size-micro); letter-spacing: 0.08em; color: var(--color-ink-sub); font-weight: 700; }
.n-item .status { font-size: var(--font-size-micro); color: var(--color-ink-mute); }
.n-item .ttl { font-weight: 600; font-size: var(--font-size-body); margin-top: 2px; padding-right: 54px; }
.n-item .rsn { color: var(--color-ink-sub); font-size: var(--font-size-small); margin-top: 4px; }
.n-item.is-resolved, .n-item.is-deleted { color: var(--color-ink-mute); }
.n-item.is-resolved .ttl, .n-item.is-resolved .rsn, .n-item.is-deleted .ttl, .n-item.is-deleted .rsn { color: var(--color-ink-mute); }
.n-item.is-exiting { position: absolute; pointer-events: none; z-index: 1; background: var(--color-bg-surface); }
.n-item .detail .rsn { margin-top: 8px; }
.n-item .stale { margin-top: 6px; color: var(--color-ink-sub); font-size: var(--font-size-small);
  border-left: 2px solid var(--color-line-strong); padding-left: 8px; }
.src { margin-top: 4px; font-size: var(--font-size-caption); color: var(--color-ink-mute); }
.src a { color: var(--color-accent-ink); text-decoration: underline; text-underline-offset: 2px; font-weight: 600; }
.src .loc { color: var(--color-ink-sub); }

.acts { position: absolute; top: 20px; right: 12px; display: flex; gap: 6px; align-items: center; }
.acts button {
  width: 28px; height: 28px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: 1px solid var(--color-line-strong); background: var(--color-bg-surface);
  border-radius: var(--radius-md); cursor: pointer; color: var(--color-ink-sub);
  transition: color var(--dur-fast) var(--ease-out), border-color var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}
.acts button svg { width: 13px; height: 13px; display: block; }
.acts button:hover { border-color: var(--color-ink); color: var(--color-ink); }
.acts button:active { transform: translateY(1px); }
.acts button.primary { color: var(--color-ink); }
.acts button.primary:hover { opacity: .85; }
.acts button.trash { width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: var(--color-ink-mute); }
.acts button.trash svg { width: 12px; height: 12px; }
.acts button.trash:hover { color: var(--color-ink-sub); }

/* ---- buttons ---- */
.run-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: var(--space-2);
  font-family: inherit; font-size: 12px; font-weight: 700;
  background: var(--color-primary); color: var(--color-on-primary);
  border: 1px solid var(--color-primary); border-radius: var(--radius-md);
  padding: 6px 14px; cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out);
}
.run-btn:hover:not(:disabled) { opacity: .85; }
.run-btn:active:not(:disabled) { transform: translateY(1px); }
.run-btn:disabled { opacity: .5; cursor: not-allowed; }
.run-btn.sm { font-size: 11px; padding: 3px 10px; font-weight: 600; display: inline-flex; align-items: center; gap: 4px; }
.run-btn .pre { width: 14px; height: 14px; display: block; margin: -1px -1px 0 -2px; }
.btn-ghost {
  font-family: inherit; font-size: 12px; font-weight: 600;
  background: transparent; color: var(--color-ink-sub);
  border: 1px solid var(--color-line-strong); border-radius: var(--radius-md);
  padding: 5px 12px; cursor: pointer;
}
.btn-ghost:hover { color: var(--color-ink); border-color: var(--color-ink); }

/* ---- FAB（右下 floating。中央はロゴ、外周リングが指摘の消化率だけを表す） ---- */
.fab {
  position: fixed; right: 24px; bottom: 24px; z-index: 2147483646;
  width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%;
  background: var(--color-bg-surface); color: var(--color-ink);
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  transition: transform var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}
.fab:active:not(:disabled) { transform: translateY(1px); }
.fab:disabled { opacity: .55; cursor: default; }
.fab .logo { width: 20px; height: 20px; display: block; }
.fab-ring { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; }
.fab-ring .track { stroke: var(--color-line); stroke-width: 2; fill: none; }
.fab-ring .fill { stroke: var(--color-ink); stroke-width: 2; fill: none; transform: rotate(-90deg); transform-origin: center; }

/* ---- 自動校閲の状態行（パネル下端に常駐） ---- */
.auto-row {
  display: flex; align-items: center; justify-content: space-between; gap: var(--space-3);
  padding: 8px 16px; border-top: 1px solid var(--color-line);
  color: var(--color-ink-mute); font-size: var(--font-size-caption); flex-shrink: 0;
}
.auto-btn {
  font-family: inherit; font-size: var(--font-size-caption); font-weight: 600; white-space: nowrap;
  padding: 3px 10px; background: transparent; color: var(--color-ink-sub);
  border: 1px solid var(--color-line-strong); border-radius: var(--radius-md); cursor: pointer;
}
.auto-btn:hover { color: var(--color-ink); border-color: var(--color-ink); }

/* ---- overlay（本文上の重ね表示。本文 DOM は触らない） ---- */
.ovl { position: fixed; inset: 0; z-index: 2147483645; pointer-events: none; }
.ovl > * { position: fixed; }
.inline-previews { position: fixed; inset: 0; z-index: 2147483645; pointer-events: none; }
.inline-preview { pointer-events: auto; cursor: text; }
.inline-change { cursor: pointer; }
.inline-change[data-sel] { outline: 1.5px solid var(--color-ring); border-radius: var(--radius-sm); }
.inline-before { color: var(--color-ink-mute); text-decoration: line-through; text-decoration-color: var(--color-strike); text-decoration-thickness: 1.5px; }
.inline-after { color: var(--color-accent-ink); background: var(--color-accent-tint); border-radius: var(--radius-sm); }
.hot { pointer-events: auto; cursor: pointer; background: transparent; }
.hot:hover { background: color-mix(in oklab, var(--color-bg-hover) 55%, transparent); border-radius: var(--radius-sm); }
.ring { outline: 1.5px solid var(--color-ring); border-radius: var(--radius-sm); background: color-mix(in oklab, var(--color-accent-tint) 40%, transparent); }
.sug-ins {
  pointer-events: auto; cursor: pointer;
  color: var(--color-accent-ink); background: var(--color-accent-tint);
  border-radius: var(--radius-sm); padding: 0 4px;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.sug-del {
  pointer-events: none;
  color: var(--color-ink-mute); text-decoration: line-through;
  text-decoration-color: var(--color-strike); text-decoration-thickness: 1.5px;
  white-space: pre-wrap; overflow-wrap: anywhere;
}
.bbar { pointer-events: auto; cursor: pointer; width: 3px; background: var(--color-line-strong); border-radius: 2px; }
.bbar[data-sel] { background: var(--color-accent); width: 3px; }
.strike-line { border-top: 1.5px solid var(--color-strike); opacity: .8; }

.tip {
  position: fixed; z-index: 2147483647; pointer-events: none;
  padding-bottom: 4px; opacity: 0; transform: translateX(-50%) translateY(calc(-100% + 2px));
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
  white-space: nowrap;
}
.tip.on { opacity: 1; pointer-events: auto; transform: translateX(-50%) translateY(-100%); }
.tip button {
  display: inline-flex; align-items: center; gap: 4px;
  font-family: var(--font-ui); font-size: 12px; font-weight: 700; line-height: 1;
  background: var(--color-bg-surface); color: var(--color-ink);
  border: 1px solid var(--color-line-strong); border-radius: var(--radius-md);
  padding: 7px 10px; cursor: pointer;
  transition: opacity var(--dur-fast) var(--ease-out), transform var(--dur-fast) var(--ease-out);
}
.tip button svg { width: 11px; height: 11px; display: block; }
.tip button:hover { opacity: .85; }
.tip button:active { transform: translateY(1px); }

.flash {
  position: fixed; z-index: 2147483644; pointer-events: none; border-radius: var(--radius-md);
  box-shadow: 0 0 0 2px var(--color-flash); opacity: 0;
  transition: opacity var(--dur-fast) var(--ease-out);
}

/* ---- options fields ---- */
.fld { margin-bottom: 16px; }
.fld label { display: block; font-size: var(--font-size-caption); font-weight: 600; color: var(--color-ink-sub); margin-bottom: 4px; }
.fld input[type="text"], .fld input[type="password"], .fld input[type="url"], .fld select {
  width: 100%; font-family: inherit; font-size: var(--font-size-body);
  padding: 6px 8px; border: 1px solid var(--color-line-strong); border-radius: var(--radius-md);
  background: var(--color-bg-surface); color: var(--color-ink);
}
.fld .help { font-size: var(--font-size-micro); color: var(--color-ink-mute); margin-top: 4px; }
@media (prefers-reduced-motion: reduce) {
  .mn *, .mn *::before, .mn *::after { animation: none !important; transition: none !important; }
}
`;

/** ::highlight 側の値。ページ側の style からは shadow の var() が見えないため、
 *  PANEL_CSS と共有する定数として置く（値の正本は design.md） */
const HL_INK_MUTE = 'oklch(52% 0.02 264)';
const HL_STRIKE = 'oklch(52% 0.07 20)';
const HL_TINT = 'oklch(94.5% 0.03 155)';

/** 本文の装飾（::highlight）はページ側の <style> に入れる必要がある */
export const PAGE_HIGHLIGHT_CSS = `
::highlight(minaosi-del) {
  color: ${HL_INK_MUTE};
  text-decoration: line-through;
  text-decoration-color: ${HL_STRIKE};
  text-decoration-thickness: 1.5px;
}
::highlight(minaosi-sel) {
  background-color: ${HL_TINT};
}
::highlight(minaosi-preview) {
  color: transparent;
  background-color: transparent;
  text-decoration: none;
}
`;
