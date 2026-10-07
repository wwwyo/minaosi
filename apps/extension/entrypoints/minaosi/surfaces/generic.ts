import type { EditorDetection, SurfaceAdapter } from './types';
import { blockText } from './resolve';

const INPUTS = '[contenteditable], textarea';
const VIRTUAL_EDITOR = '.cm-editor, .cm-content, .CodeMirror, .monaco-editor, .ace_editor';
const NON_DRAFT = /(?:^|[\s_\-:./])(comments?|repl(?:y|ies)|search|chat|messages?|contact|inquiry|title|caption|excerpt|summary|tags?|slug|email|password|username|description)(?:$|[\s_\-:./])|コメント|返信|検索|チャット|問い合わせ|タイトル|題名|キャプション|要約|抜粋|タグ|メール|パスワード/i;
const BODY = /(?:^|[\s_\-:./])(body|content|article|post)(?:$|[\s_\-:./])|本文|記事内容|記事の内容/i;

function createDetection(doc: Document) {
  // ページのラベル変更を次の判定へ持ち越さないよう、キャッシュは1回の操作内に限定する。
  const purposes = new WeakMap<HTMLElement, string>();
  const exclusions = new WeakMap<HTMLElement, boolean>();
  let labels: Map<string, string[]> | undefined;
  let collectedInputs: HTMLElement[] | undefined;

  /** 入力中の本文そのものを用途判定に使わず、対応するラベルと属性を読む。 */
  function purpose(element: HTMLElement): string {
    const cached = purposes.get(element);
    if (cached !== undefined) return cached;
    const attributes = ['aria-label', 'aria-placeholder', 'placeholder', 'data-placeholder', 'name', 'id'];
    const parts = attributes.map(name => element.getAttribute(name) ?? '');
    for (const id of (element.getAttribute('aria-labelledby') ?? '').split(/\s+/)) {
      if (id) parts.push(element.ownerDocument.getElementById(id)?.textContent ?? '');
    }
    if (element.id) {
      if (!labels) {
        labels = new Map();
        for (const label of doc.querySelectorAll<HTMLLabelElement>('label[for]')) {
          const names = labels.get(label.htmlFor) ?? [];
          names.push(label.textContent ?? '');
          labels.set(label.htmlFor, names);
        }
      }
      parts.push(...labels.get(element.id) ?? []);
    }
    const label = element.closest('label');
    if (label) {
      const walker = element.ownerDocument.createTreeWalker(label, NodeFilter.SHOW_TEXT);
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        if (!element.contains(node)) parts.push(node.textContent ?? '');
      }
    }
    const name = parts.join(' ').replace(/([a-z])([A-Z])/g, '$1 $2');
    purposes.set(element, name);
    return name;
  }

  function visible(element: HTMLElement): boolean {
    if (!element.isConnected || element.closest('[hidden], [inert], [aria-hidden="true"]')) return false;
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      if (element.ownerDocument.defaultView?.getComputedStyle(parent).opacity === '0') return false;
    }
    return [...element.getClientRects()].some(rect => rect.width > 0 && rect.height > 0)
      && style?.visibility === 'visible' && style.display !== 'none' && style.opacity !== '0';
  }

  /** フォーム全体の本文は読まず、コメント用の領域などの識別情報だけで除外する。 */
  function excluded(element: HTMLElement): boolean {
    const cached = exclusions.get(element);
    if (cached !== undefined) return cached;
    const result = exclusionOf(element);
    exclusions.set(element, result);
    return result;
  }

  function exclusionOf(element: HTMLElement): boolean {
    if (element.closest('[aria-disabled="true"], [aria-readonly="true"]')) return true;
    if (element instanceof HTMLTextAreaElement && (element.disabled || element.readOnly)) return true;
    if (NON_DRAFT.test(identityOf(element))) return true;
    for (let parent = element.parentElement; parent && parent !== element.ownerDocument.body; parent = parent.parentElement) {
      if (NON_DRAFT.test(identityOf(parent))) return true;
    }
    return false;
  }

  function identityOf(element: HTMLElement): string {
    return `${purpose(element)} ${element.className} ${element.getAttribute('role') ?? ''}`.replace(/([a-z])([A-Z])/g, '$1 $2');
  }

  function inputs(): HTMLElement[] {
    return collectedInputs ??= [...doc.querySelectorAll<HTMLElement>(INPUTS)].filter(element => {
      if (!(element instanceof HTMLTextAreaElement)) {
        if (!element.isContentEditable || element.parentElement?.isContentEditable) return false;
      }
      return visible(element) && !excluded(element);
    });
  }

  function bodyGroup(element: HTMLElement): HTMLElement | null {
    for (let parent = element.parentElement; parent && parent !== element.ownerDocument.body; parent = parent.parentElement) {
      if (!parent.isContentEditable && BODY.test(purpose(parent)) && !excluded(parent)) return parent;
    }
    return null;
  }

  function editableRoots(editor: HTMLElement): HTMLElement[] {
    return editor.isContentEditable ? [editor] : inputs().filter(input => editor.contains(input));
  }

  function hasExcludedEditable(root: HTMLElement): boolean {
    return [...root.querySelectorAll<HTMLElement>('*')]
      .some(element => element.isContentEditable && excluded(element));
  }

  function usable(editor: HTMLElement): boolean {
    return !(editor instanceof HTMLTextAreaElement)
      && !editor.closest(VIRTUAL_EDITOR) && !editor.querySelector(`${VIRTUAL_EDITOR}, textarea`)
      && !editableRoots(editor).some(hasExcludedEditable);
  }

  function detectEditor(): EditorDetection {
    if (doc.defaultView && doc.defaultView.top !== doc.defaultView) return { status: 'none' };
    const roots = [...new Set(inputs().map(input => bodyGroup(input) ?? input))];
    if (!roots.length) return { status: 'none' };
    const ranked = roots.map(editor => {
      const rect = editor.getBoundingClientRect();
      return { editor, area: rect.width * Math.max(rect.height, editor.scrollHeight) };
    }).sort((a, b) => b.area - a.area);
    const candidates = ranked.filter(({ editor }) => usable(editor)).map(({ editor }) => editor);
    const unknown: EditorDetection = { status: 'unknown', candidates };
    const named = roots.filter(root => BODY.test(purpose(root)));
    if (named.length > 1) return unknown;
    if (named.length === 1) return candidates.includes(named[0]!) ? { status: 'confirmed', editor: named[0]! } : unknown;
    const [first, second] = ranked;
    // 近い大きさの候補をDOM順で選ぶと、別の入力欄を自動校閲してしまう。
    if (!first || (second && first.area < second.area * 2) || !candidates.includes(first.editor)) return unknown;
    return { status: 'confirmed', editor: first.editor };
  }

  function editableBlocks(root: HTMLElement): HTMLElement[] {
    if (!root.isContentEditable || hasExcludedEditable(root)) return [];
    const children = [...root.children].filter((element): element is HTMLElement => element instanceof HTMLElement);
    const blocks = children.filter(child => child.isContentEditable && !excluded(child));
    const hasBlocks = blocks.some(child => child.matches('p, div, h1, h2, h3, h4, h5, h6, ul, ol, blockquote, pre, figure'));
    const hasDirectText = [...root.childNodes].some(node => node.nodeType === Node.TEXT_NODE && node.textContent?.trim());
    if (!hasBlocks || hasDirectText) return excluded(root) ? [] : [root];
    return blocks;
  }

  function extractBlocks(editor: HTMLElement) {
    const roots = editableRoots(editor);
    return roots.flatMap(editableBlocks).map((element, index) => ({ index, element, text: blockText(element) }));
  }
  return { detectEditor, extractBlocks };
}

export function detectDraftEditor(doc: Document): EditorDetection {
  return createDetection(doc).detectEditor();
}

export const genericAdapter: SurfaceAdapter = {
  id: 'generic',
  detectEditor: detectDraftEditor,
  extractBlocks: editor => createDetection(editor.ownerDocument).extractBlocks(editor),
};
