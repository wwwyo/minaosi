import { findDraftEditor, genericAdapter } from '../entrypoints/minaosi/surfaces/generic';
import { applyReplacement, blockText, rangeAt, indexOfRange } from '../entrypoints/minaosi/surfaces/resolve';
import { InlinePreview } from '../entrypoints/minaosi/ui/inline-preview';
import { PANEL_CSS, PAGE_HIGHLIGHT_CSS } from '../entrypoints/minaosi/ui/styles';

/** DOMの継承・可視性・Range・保存用HTMLを実ブラウザで検証する。 */
export async function runSurfaceChecks() {
  const results: { name: string; ok: boolean; error?: string }[] = [];
  const fixture = document.createElement('main');
  document.body.append(fixture);
  const assert = (value: unknown, message: string) => { if (!value) throw new Error(message); };
  const test = async (name: string, html: string, check: () => void | Promise<void>) => {
    fixture.innerHTML = html;
    try { await check(); results.push({ name, ok: true }); }
    catch (error) { results.push({ name, ok: false, error: String(error) }); }
  };
  const found = () => findDraftEditor(document);
  const element = (id: string) => document.getElementById(id)!;
  const is = (id: string) => assert(found() === element(id), `expected ${id}, got ${found()?.id ?? 'null'}`);
  const none = () => assert(found() === null, `unexpected editor: ${found()?.outerHTML}`);

  await test('本文ラベルを持つ編集欄', '<div id="draft" contenteditable="true" aria-label="本文"><p>原稿です。</p></div>', () => is('draft'));
  await test('長いコメントと無関係なtextareaを本文に混ぜない', '<div id="draft" contenteditable="true" aria-label="本文"><p>短い原稿。</p></div><form aria-label="コメント"><div contenteditable="true">' + '長いコメント。'.repeat(50) + '</div><textarea name="body">コメント</textarea></form>', () => {
    is('draft');
    assert(genericAdapter.extractBlocks(found()!).map(b => b.text).join('') === '短い原稿。', 'comment leaked into draft');
  });
  await test('コメント用contenteditableだけなら無効', '<form id="comments"><div contenteditable="true" aria-label="本文">コメント</div></form>', none);
  await test('入力欄自身がコメント用classなら本文ラベルより除外を優先', '<div class="commentComposer" contenteditable="true" aria-label="本文">コメント。</div>', none);
  await test('直接テキストとコメントが同じ編集hostに混在したら無効', '<div id="draft" contenteditable="true" aria-label="本文">導入文。<div aria-label="コメント">コメント文</div></div>', () => {
    none();
    assert(genericAdapter.extractBlocks(element('draft')).length === 0, 'mixed comment was extracted');
  });
  await test('本文host内のタイトルだけを本文として扱わない', '<div id="draft" contenteditable="true" aria-label="本文"><div aria-label="タイトル">記事タイトル</div></div>', none);
  await test('段落の深い子孫にある返信欄も本文に混ぜない', '<div id="draft" contenteditable="true" aria-label="本文"><p>本文。<span><span aria-label="返信">返信文</span></span></p></div>', none);
  await test('返信・検索・チャット・問い合わせを除外', '<div contenteditable="true" aria-label="返信本文">返信</div><form role="search"><div contenteditable="true" aria-label="本文">検索</div></form><div class="chat"><div contenteditable="true" name="content">チャット</div></div><form aria-label="お問い合わせ"><div contenteditable="true" name="body">問い合わせ</div></form>', none);
  await test('フォーカスと文字数だけでは本文にしない', '<div id="unknown" contenteditable="true">' + '本文らしい長文。'.repeat(100) + '</div>', () => { element('unknown').focus(); none(); });
  await test('本文候補が競合したら長さやフォーカスで決めない', '<div id="one" contenteditable="true" aria-label="本文">短文。</div><div id="two" contenteditable="true" aria-label="本文">' + '長文。'.repeat(50) + '</div>', () => { element('two').focus(); none(); });
  await test('空の新規原稿も本文ラベルで検知', '<div id="draft" contenteditable="true" data-placeholder="本文を書く"></div>', () => is('draft'));
  await test('labelのfor属性を使う', '<label for="draft">本文</label><div id="draft" contenteditable="true"></div>', () => is('draft'));
  await test('aria-labelledbyを使う', '<span id="draft-label">記事本文</span><div id="draft" contenteditable="true" aria-labelledby="draft-label"></div>', () => is('draft'));
  await test('判定後にラベルがコメントへ変わったら即座に無効', '<label id="label" for="draft">本文</label><div id="draft" contenteditable="true">原稿。</div>', () => {
    is('draft');
    element('label').textContent = 'コメント';
    none();
    assert(genericAdapter.extractBlocks(element('draft')).length === 0, 'stale purpose cache');
  });
  await test('ラベル内の本文の言葉を用途と誤認しない', '<label>本文<div id="draft" contenteditable="true">この記事はコメント欄について書いています。</div></label>', () => is('draft'));
  await test('plaintext-onlyと属性の継承', '<div id="draft" contenteditable="plaintext-only" aria-label="本文"><p>本文。</p><span>補足。</span></div>', () => is('draft'));
  await test('段落外の直接テキストも全文に含む', '<div id="draft" contenteditable="true" aria-label="本文">導入。<p>段落。</p>末尾。</div>', () => {
    is('draft');
    assert(genericAdapter.extractBlocks(found()!).map(b => b.text).join('') === '導入。段落。末尾。', 'direct text missing');
  });
  await test('非表示・inert・編集不可・無効を除外', '<div hidden><div contenteditable="true" aria-label="本文">hidden</div></div><div inert><div contenteditable="true" aria-label="本文">inert</div></div><div contenteditable="false" aria-label="本文">readonly</div><div contenteditable="true" aria-disabled="true" aria-label="本文">disabled</div><div style="visibility:hidden" contenteditable="true" aria-label="本文">invisible</div>', none);
  await test('透明・ゼロサイズ・aria-readonlyの入力欄も無効', '<div style="opacity:0" contenteditable="true" aria-label="本文">透明。</div><div style="width:0;height:0;overflow:hidden" contenteditable="true" aria-label="本文">ゼロ。</div><div contenteditable="true" aria-label="本文" aria-readonly="true">readonly</div>', none);
  await test('透明な祖先の内側にある本文も無効', '<section style="opacity:0"><div contenteditable="true" aria-label="本文">透明。</div></section>', none);
  await test('タイトルと保存操作のある執筆フォーム', '<form><input aria-label="タイトル"><div id="draft" contenteditable="true"><p>本文。</p></div><button type="button">下書き保存</button></form>', () => is('draft'));
  await test('ツールバーだけでは本文にしない', '<section><div role="toolbar"><button>太字</button></div><div contenteditable="true">文章。</div></section>', none);
  await test('タイトル欄は保存操作があっても除外', '<form><input aria-label="タイトル"><div contenteditable="true" aria-label="タイトル">記事タイトル</div><button>公開する</button></form>', none);
  await test('textarea本文は未対応なので無効', '<label for="draft">本文</label><textarea id="draft">原稿。</textarea>', none);
  await test('CodeMirror 6の見えている一部だけでは校閲しない', '<div class="cm-editor"><div contenteditable="true" aria-label="本文" class="cm-content">表示中の行。</div></div>', none);
  await test('未対応の本文候補との競合も無効', '<div contenteditable="true" aria-label="本文">原稿。</div><textarea aria-label="本文">別の原稿。</textarea>', none);
  await test('複数ブロックを順序通り取得し、タイトルとコメントを除外', '<section id="draft" aria-label="本文"><div contenteditable="true" aria-label="タイトル">題名</div><div contenteditable="true"><p>第一段落。</p></div><div contenteditable="true"><p>第二段落。</p></div><aside aria-label="コメント"><div contenteditable="true">コメント。</div></aside></section>', () => {
    is('draft');
    assert(JSON.stringify(genericAdapter.extractBlocks(found()!).map(b => b.text)) === JSON.stringify(['第一段落。', '第二段落。']), 'wrong blocks or order');
  });
  await test('フォーカスがコメントへ移っても本文を切り替えない', '<div id="draft" contenteditable="true" aria-label="本文">原稿。</div><div id="comment" contenteditable="true" aria-label="コメント">コメント。</div>', () => { element('comment').focus(); is('draft'); });
  await test('ネストした編集不可カードを送信本文と文字位置から除外', '<div id="draft" contenteditable="true" aria-label="本文"><p id="paragraph">前<span contenteditable="false">カードの説明</span>後です。</p></div>', () => {
    is('draft');
    const paragraph = element('paragraph');
    assert(blockText(paragraph) === '前後です。', 'readonly card leaked');
    const range = rangeAt(paragraph, 1, 1)!;
    assert(range.toString() === '後' && indexOfRange(paragraph, range) === 1, 'wrong range');
    assert(rangeAt(paragraph, 0, 2) === null, 'replacement crossed readonly card');
    const card = paragraph.querySelector<HTMLElement>('[contenteditable="false"]')!;
    assert(blockText(card) === '' && rangeAt(card, 0, 1) === null, 'readonly root was not excluded');
  });
  await test('同一オリジンでもiframe内は対象外', '<iframe id="frame"></iframe>', async () => {
    const frame = element('frame') as HTMLIFrameElement;
    await new Promise<void>(resolve => {
      frame.addEventListener('load', () => resolve(), { once: true });
      frame.srcdoc = '<div contenteditable="true" aria-label="本文">原稿</div>';
    });
    none();
    assert(frame.contentDocument?.querySelector('[contenteditable="true"]'), 'iframe fixture did not load');
    assert(findDraftEditor(frame.contentDocument!) === null, 'iframe was accepted');
  });
  await test('本文から除いたscriptとstyleを置換範囲に含めない', '<div contenteditable="true" aria-label="本文"><p id="paragraph">前<style>.unused{color:red}</style><script type="application/json">{}</script>後</p></div>', () => {
    const paragraph = element('paragraph');
    assert(blockText(paragraph) === '前後', 'non-draft element text leaked');
    assert(rangeAt(paragraph, 0, 2) === null, 'replacement crossed omitted elements');
    assert(rangeAt(paragraph, 1, 1)?.toString() === '後', 'valid range missing');
  });
  await test('本文中の埋め込みiframeだけなら対象外にしない', '<div id="draft" contenteditable="true" aria-label="本文"><p>原稿。</p><iframe src="about:blank" contenteditable="false"></iframe></div>', () => is('draft'));
  await test('候補表示中の保存用HTMLは元の本文のまま', '<div id="draft" contenteditable="true" aria-label="本文"><p id="paragraph">明日は晴れれです。</p></div>', () => {
    const draft = found()!;
    const before = draft.innerHTML;
    const host = document.createElement('div');
    const shadow = host.attachShadow({ mode: 'closed' });
    const style = document.createElement('style');
    style.textContent = PANEL_CSS;
    shadow.append(style);
    const pageStyle = document.createElement('style');
    pageStyle.textContent = PAGE_HIGHLIGHT_CSS;
    document.head.append(pageStyle);
    document.body.append(host);
    const preview = new InlinePreview(shadow, draft, () => {});
    try {
      preview.render([{ fid: 'one', matchIndex: 0, kind: 'suggest', range: rangeAt(element('paragraph'), 3, 3)!, from: '晴れれ', to: '晴れ' }], null, true);
      assert(shadow.querySelector('.inline-after')?.textContent === '晴れ', 'no suggestion rendered');
      assert(draft.innerHTML === before && draft.textContent === '明日は晴れれです。', 'suggestion mutated saved draft');
      assert(findDraftEditor(document) === draft, 'preview changed detection');
    } finally { preview.dispose(); host.remove(); pageStyle.remove(); }
  });
  await test('適用だけが本文を変え、ブラウザundoで戻せる', '<div id="draft" contenteditable="true" aria-label="本文"><p id="paragraph">明日は晴れれです。</p></div>', () => {
    const paragraph = element('paragraph');
    const range = rangeAt(paragraph, 3, 3)!;
    assert(applyReplacement(range, '晴れ'), 'insertText failed');
    assert(paragraph.textContent === '明日は晴れです。', 'applied change missing');
    assert(document.execCommand('undo'), 'undo failed');
    assert(paragraph.textContent === '明日は晴れれです。', 'undo did not restore draft');
  });
  fixture.remove();
  return { passed: results.filter(result => result.ok).length, total: results.length, results };
}
