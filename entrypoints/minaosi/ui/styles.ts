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
  position: fixed; top: 0; right: 0; bottom: 0; width: 340px; z-index: 2147483646;
  background: var(--color-bg-panel); border-left: 1px solid var(--color-line-strong);
  display: flex; flex-direction: column;
}
.panel header { padding: 14px 16px 12px; border-bottom: 1px solid var(--color-line); }
.head-row { display: flex; align-items: center; gap: 8px; }
.brand {
  display: flex; align-items: center; gap: 6px; border: 0; background: transparent;
  padding: 3px 6px 3px 4px; border-radius: var(--radius-sm); cursor: pointer; color: var(--color-ink);
}
.brand:hover { background: var(--color-bg-hover); }
.brand svg:not(.chev) { width: 17px; height: 17px; display: block; color: var(--color-ink); }
.brand-name { font-size: var(--font-size-brand); font-weight: 800; letter-spacing: 0.04em; }
.brand .chev { width: 13px; height: 13px; display: block; color: var(--color-ink-mute); }
.brand .chev svg { width: 100%; height: 100%; display: block; }
.brand:hover .chev { color: var(--color-ink); }
.head-row .sp { margin-left: auto; display: flex; gap: 4px; align-items: center; }

.icon-btn {
  width: 24px; height: 24px; padding: 0; border: 0; background: transparent;
  color: var(--color-ink-mute); cursor: pointer; border-radius: var(--radius-sm);
  display: inline-flex; align-items: center; justify-content: center;
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.icon-btn:hover { color: var(--color-ink); background: var(--color-bg-hover); }
.icon-btn svg { width: 13px; height: 13px; display: block; }

.prog { color: var(--color-ink-mute); font-size: var(--font-size-caption); margin-top: 2px; font-variant-numeric: tabular-nums; }
.filters { display: flex; gap: 2px; margin-top: 10px; }
.filters button {
  font-family: inherit; font-size: var(--font-size-caption); font-weight: 600;
  border: 1px solid transparent; background: transparent;
  color: var(--color-ink-sub); padding: 3px 8px; cursor: pointer; border-radius: var(--radius-md);
  transition: color var(--dur-fast) var(--ease-out), background var(--dur-fast) var(--ease-out);
}
.filters button:hover { color: var(--color-ink); background: var(--color-bg-hover); }
.filters button:active { transform: translateY(1px); }
.filters button.on { color: var(--color-ink); background: var(--color-bg-surface); border-color: var(--color-line-strong); }

.list { overflow-y: auto; flex: 1; }
.list .empty { padding: 24px 16px; color: var(--color-ink-mute); font-size: var(--font-size-small); text-align: center; }
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
.n-item[data-sel] { border-left-color: var(--color-ink); background: var(--color-bg-surface); }
.n-item .detail { display: none; }
.n-item[data-sel] .detail { display: block; }
.n-item .meta { display: flex; align-items: baseline; gap: 6px; padding-right: 54px; }
.n-item .kind { font-size: var(--font-size-micro); letter-spacing: 0.08em; color: var(--color-ink-sub); font-weight: 700; }
.n-item .ttl { font-weight: 600; font-size: var(--font-size-body); margin-top: 2px; padding-right: 54px; }
.n-item .rsn { color: var(--color-ink-sub); font-size: var(--font-size-small); margin-top: 4px; }
.n-item.is-resolved .ttl, .n-item.is-resolved .rsn { color: var(--color-ink-mute); }
.n-item .detail .rsn { margin-top: 8px; }
.n-item .stale { margin-top: 6px; color: var(--color-ink-sub); font-size: var(--font-size-small);
  border-left: 2px solid var(--color-line-strong); padding-left: 8px; }
.src { margin-top: 4px; font-size: var(--font-size-caption); color: var(--color-ink-mute); }
.src a { color: var(--color-accent-ink); text-decoration: underline; text-underline-offset: 2px; font-weight: 600; }
.src .loc { color: var(--color-ink-sub); }

.acts { position: absolute; top: 16px; right: 12px; display: flex; gap: 6px; align-items: center; }
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
.acts button.primary { background: var(--color-primary); border-color: var(--color-primary); color: var(--color-on-primary); }
.acts button.primary:hover { opacity: .85; }
.acts button.trash { width: 20px; height: 20px; padding: 0; border: 0; background: transparent; color: var(--color-ink-mute); }
.acts button.trash svg { width: 12px; height: 12px; }
.acts button.trash:hover { color: var(--color-ink-sub); }

/* ---- buttons ---- */
.run-btn {
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

/* ---- FAB（右端のサイドタブ。本文やホストのヘッダーと重ならない） ---- */
.fab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%); z-index: 2147483646;
  width: 36px; height: 64px; border-radius: var(--radius-md) 0 0 var(--radius-md);
  background: var(--color-primary); color: var(--color-on-primary); border: 0;
  cursor: pointer; display: flex; align-items: center; justify-content: center;
  box-shadow: var(--shadow-fab);
  transition: transform var(--dur-fast) var(--ease-out), box-shadow var(--dur-fast) var(--ease-out), opacity var(--dur-fast) var(--ease-out);
}
.fab:hover:not(:disabled) { transform: translateY(-50%) translateX(-3px); box-shadow: var(--shadow-fab-hover); }
.fab:active:not(:disabled) { transform: translateY(-50%); }
.fab:disabled { opacity: .55; cursor: default; }
.fab svg { width: 20px; height: 20px; display: block; }

/* ---- overlay（本文上の重ね表示。本文 DOM は触らない） ---- */
.ovl { position: fixed; inset: 0; z-index: 2147483645; pointer-events: none; }
.ovl > * { position: fixed; }
.hot { pointer-events: auto; cursor: pointer; background: transparent; }
.hot:hover { background: color-mix(in oklab, var(--color-bg-hover) 55%, transparent); border-radius: var(--radius-sm); }
.ring { outline: 1.5px solid var(--color-ring); border-radius: var(--radius-sm); background: color-mix(in oklab, var(--color-accent-tint) 40%, transparent); }
.sug-ins {
  pointer-events: auto; cursor: pointer;
  color: var(--color-accent-ink); background: var(--color-accent-tint);
  border-radius: var(--radius-sm); padding: 0 4px;
  font-size: 13px; line-height: 1.5; white-space: pre-wrap; max-width: 320px;
}
.sug-del {
  pointer-events: none;
  color: var(--color-ink-mute); text-decoration: line-through;
  text-decoration-color: var(--color-strike); text-decoration-thickness: 1.5px;
  font-size: 13px; line-height: 1.5; white-space: pre-wrap; max-width: 320px;
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
  background: var(--color-primary); color: var(--color-on-primary);
  border: 1px solid var(--color-primary); border-radius: var(--radius-md);
  padding: 7px 10px; cursor: pointer; box-shadow: var(--shadow-pop);
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

/* ---- settings / consent views ---- */
.subview { flex: 1; overflow-y: auto; padding: 16px; font-size: var(--font-size-body); }
.subview h4 { margin: 0 0 4px; font-size: var(--font-size-body); font-weight: 700; }
.subview .desc { color: var(--color-ink-sub); font-size: var(--font-size-small); margin: 0 0 12px; }
.fld { margin-bottom: 16px; }
.fld label { display: block; font-size: var(--font-size-caption); font-weight: 600; color: var(--color-ink-sub); margin-bottom: 4px; }
.fld input[type="text"], .fld input[type="password"], .fld input[type="url"] {
  width: 100%; font-family: inherit; font-size: var(--font-size-body);
  padding: 6px 8px; border: 1px solid var(--color-line-strong); border-radius: var(--radius-md);
  background: var(--color-bg-surface); color: var(--color-ink);
}
.fld .help { font-size: var(--font-size-micro); color: var(--color-ink-mute); margin-top: 4px; }
.rule { display: flex; align-items: center; gap: 10px; padding: 6px 0; font-size: var(--font-size-small); }
/* Apple 風のトグル。native checkbox の semantics（focus/keyboard/change）は残す */
.rule input[type="checkbox"] {
  appearance: none;
  flex: none;
  width: 34px; height: 20px;
  margin: 0;
  border-radius: var(--radius-full);
  background: var(--color-line-strong);
  position: relative;
  cursor: pointer;
  transition: background var(--dur-fast) var(--ease-out);
}
.rule input[type="checkbox"]::after {
  content: '';
  position: absolute; top: 2px; left: 2px;
  width: 16px; height: 16px;
  border-radius: 50%;
  background: var(--color-bg-surface);
  box-shadow: 0 1px 2px oklch(0% 0 0 / 0.22);
  transition: transform var(--dur-fast) var(--ease-out);
}
.rule input[type="checkbox"]:checked { background: var(--color-ink); }
.rule input[type="checkbox"]:checked::after { transform: translateX(14px); }
.rule input[type="checkbox"]:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.rule .nm { font-weight: 600; }
.rule .hint { color: var(--color-ink-mute); font-size: var(--font-size-caption); }
.filecur { display: flex; align-items: center; gap: 8px; font-size: var(--font-size-small); }
.filecur .nm { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.set-actions { display: flex; gap: 8px; margin-top: 8px; }
.provider { font-size: var(--font-size-small); color: var(--color-ink-sub); }

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
`;
