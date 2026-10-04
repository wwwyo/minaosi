# 任意のブログ執筆画面を検知するための調査

調査日: 2026-10-03。PRDを決めるための調査資料であり、対応済みサービスの一覧ではない。

## 実装状況（2026-10-04）

ユーザーの承認に基づき、最初の汎用検知を実装した。以下の調査開始時点の記述とは区別する。

- 起動対象をnoteのドメインからHTTP／HTTPSへ広げ、noteAdapterを[genericAdapter](../../../apps/extension/entrypoints/minaosi/surfaces/generic.ts)へ置き換えた。ブラウザによるサイトアクセス許可の範囲内で動く。
- 通常のcontenteditableについて、本文を示すラベル・属性か、タイトル欄と保存・公開操作のある執筆領域を根拠に検知する。本文と明示された領域内の複数編集欄も文書順で扱う。
- コメント・返信・検索・チャット・問い合わせ・タイトルなどの用途が明確なら除外する。文字数・面積・フォーカスで競合を解消せず、本文が決まらない場合は「無効な画面です」とする。
- 校閲と適用の直前にも本文を再確認する。編集領域の差し替えやSPA遷移では、以前の指摘を破棄し、破棄したcontrollerの遅延応答を表示しない。
- 初版ではtextarea、CodeMirror等の仮想化エディタ、Shadow DOM内、document.designModeを未対応として無効にする。iframe内は合意どおり対象外である。Notionを含む各サービスの現在の実画面での動作は、別途検証が必要。

過去のQAで作成した合成DOMの検証は廃止した。現在のE2Eは `mise exec -- bun run test:e2e` で実行し、ビルドした拡張の設定画面とローカルの合成執筆画面を操作する。対象要件と未確認範囲は [E2Eの検証範囲](../../../tests/README.md) を参照する。既存の単体テストは `mise exec -- bun test apps/extension`、型チェックとビルドはextensionの `check`／`build` を使う。

現在のE2Eは合成の執筆画面で拡張の起動ボタンの表示を確認する。実サービスでの本文取得・校閲・適用・保存・再読込や、Firefoxの実操作は未確認である。起動ボタンの表示だけでは、各サービスへの対応完了とは判断しない。

## 個人ブログにも届く検知の単位

ブログの執筆画面には `contenteditable` が広く使われるが、それだけを探してもすべての原稿は取得できない。単一のリッチテキスト欄、段落ごとの複数編集欄、textarea、Markdown・HTMLエディタがあり、iframe内に置かれる場合もある。任意ドメインのWordPressや個人ブログを扱うには、サービス名やドメインではなく、編集方式を検知する必要がある。

編集欄の発見、原稿全文の取得、本文上の指摘表示、保存内容に反映される修正・undoは別々の能力である。発見できたことを、そのエディタへの対応完了とは扱わない。

今回はプロジェクトのStoryとGlossaryに従い、ブラウザ上の執筆画面を調べた。公開済み記事を閲覧するだけの画面や、ローカルのMarkdownファイルをデスクトップアプリで編集する場合は、この調査でいう執筆画面には含めない。ウェブCMSで編集する静的ブログは含める。

ユーザーの指定により、iframe内のエディタは同一オリジンでも対象外とする。対象はトップレベルdocument内のエディタである。本文がトップレベルにあり、画像・動画などの埋め込みだけにiframeを使う画面は、この理由では除外しない。

## 調査開始時のnoteAdapterがしていたこと

noteAdapterは、noteの執筆画面から編集欄を見つけ、本文を校閲用のブロックとして取り出す接続部分だった。旧実装は `apps/extension/entrypoints/minaosi/surfaces/note.ts`。画面に表示された `[contenteditable="true"]` または `[contenteditable=""]` のうち、`textContent` が最も長い要素をエディタとして選び、その直下の子要素をブロックとして取り出していた。今回genericAdapterへ置き換え、旧ファイルは削除した。

この処理は汎用的なHTML操作だが、「本文は最大の編集領域1つ」「本文のブロックはその直下」という仮定を持つ。`SurfaceAdapter` の契約も `findEditor` と `extractBlocks` の2操作のみである。

調査開始時の起動先は `apps/extension/entrypoints/content.ts` で `editor.note.com` に限定され、noteAdapterが直接指定されていた。校閲APIはブロック番号と本文を受け取るため、note固有のデータ形式を要求しない。

## 公開デモで確認できた差

Orca内蔵ブラウザでページを開き、DOMの属性・要素数・本文長を読み取った。入力・保存・公開操作や、minaosiを使った校閲・修正の検証はしていない。数値は調査時のデモ初期状態の観測値である。

| 公開デモ | 観測結果 | 調査開始時の処理との関係 |
|---|---|---|
| [WordPress Gutenberg](https://wordpress.org/gutenberg/) | 親documentの編集領域は0個。`Editor canvas` iframe内に37個の `contenteditable=true`。対象要素の本文長合計1,700文字、最大1要素188文字 | このデモはiframe内のため今回の対象外。最大1要素だけでは全文が取れない例でもある |
| [Ghost Koenig](https://koenig.ghost.org/) | 本文は `div.kg-prose[contenteditable=true][role=textbox]` 1個。本文長1,236文字。別にタイトル欄とtextareaがある。本文内に `contenteditable=false` のカードが2個 | 単一rootとしては現行処理に近い。カードとタイトルを区別する必要がある。適用・undoは未検証 |
| [CodeMirror](https://codemirror.net/) | `.cm-content[contenteditable=true]` 1個、子要素3個。textareaは0個 | 編集欄自体は見つかる。ただし長い文書の全文がDOMに存在する保証はない |

WordPressの公式資料でも、[RichTextはcontenteditableを使う](https://developer.wordpress.org/block-editor/reference-guides/richtext/)ことと、[iframe内で動くエディタの条件](https://developer.wordpress.org/block-editor/reference-guides/block-api/block-api-versions/block-migration-for-iframe-editor-compatibility/)が説明されている。デモの37個という値を、すべてのWordPressサイトに当てはめるものではない。

CodeMirrorの[公式ガイド](https://codemirror.net/docs/guide/#viewport)は、長い文書では可視範囲と周辺だけをDOMに描画すると説明する。[公式API](https://codemirror.net/docs/ref/#view.EditorView.contentDOM)も、編集内容の変更にはDOMの直接操作ではなくtransactionを使うよう求める。Zennの[公式更新情報](https://info.zenn.dev/2024-01-31-update-markdown-editor)は記事・本のチャプターにCodeMirror 6を採用したことを示している。Zennの現在のログイン後画面は今回実測していない。

## 調査で見つかったブログ・CMSの一覧

下表は、調査で確認した対象をすべて載せている。世の中の全ブログサービス・全プラグインを網羅する一覧ではない。「実画面未確認」は、公式資料で編集モードやライブラリは確認できても、実画面の入力要素を検査していないことを示す。

サービス名だけでは対応対象と判定しない。WordPressを含め、iframe内に本文エディタがある構成は対象外である。

### ブログ・記事サービス

| 対象 | 確認した編集方式 | 確認範囲 | 出典 |
|---|---|---|---|
| note | 旧adapterは単一contenteditableを想定 | 旧コード／実画面未確認 | [後継のgenericAdapter](../../../apps/extension/entrypoints/minaosi/surfaces/generic.ts) |
| WordPress.org／自己ホストWordPress | ブロック単位のRichText | 公開デモのDOM＋公式資料 | [RichText公式資料](https://developer.wordpress.org/block-editor/reference-guides/richtext/) |
| WordPress Classic Editor／Classicブロック | TinyMCE。Classic EditorにはVisual／Textの切替 | 公式資料／実画面未確認 | [WordPressのエディタ実装](https://developer.wordpress.org/reference/classes/_wp_editors/)、[Classic Editorの操作](https://wordpress.org/documentation/article/write-posts-classic-editor/#visual-versus-text-editor)、[Classicブロック](https://developer.wordpress.org/block-editor/getting-started/glossary/#classic-block) |
| WordPress.com | ブロックエディタ | 公式資料／実画面未確認 | [公式エディタ資料](https://wordpress.com/support/wordpress-editor/) |
| Zenn | Markdown、CodeMirror 6 | 公式資料／実画面未確認 | [公式更新情報](https://info.zenn.dev/2024-01-31-update-markdown-editor)、[開発チームの実装解説](https://zenn.dev/team_zenn/articles/zenn-markdown-editor-by-cm6/) |
| Qiita | Markdown入力とプレビュー | 公式資料／実画面未確認 | [公式Markdown仕様](https://qiita.com/Qiita/items/c686397e4a0f4f11683d)、[公式エディタ案内](https://blog.qiita.com/editor-design-update/) |
| はてなブログ | 見たまま／はてな記法／Markdown／HTML。独立したHTMLモードにはプラン条件あり | 公式資料／実画面未確認 | [公式編集モード](https://help.hatenablog.com/entry/editing-mode) |
| Amebaブログ | 装飾付き編集とHTML編集 | 公式資料／実画面未確認 | [公式記事作成ガイド](https://helps.ameba.jp/qguide/blog/post_196.html) |
| FC2ブログ | WYSIWYG、見たまま編集、HTML編集の案内あり | 公式資料／実画面未確認 | [公式ヘルプ](https://help.fc2.com/blog/ja)、[新しい投稿ページ](https://help.fc2.com/blog/manual/group208/3369/ja) |
| ライブドアブログ | HTMLエディタ／シンプルエディタ。名称上のHTMLエディタも見たまま装飾が可能 | 公式資料／実画面未確認 | [公式エディタ切替案内](https://support.livedoor.info/hc/ja/articles/9566194026383) |
| Seesaaブログ | リッチテキスト／通常エディタ | 公式資料／実画面未確認 | [公式リッチテキスト案内](https://faq.seesaa.net/article/438596420.html)、[通常エディタの改行](https://faq.seesaa.net/article/422864405.html) |
| Blogger | 投稿エディタ、プレビュー、装飾操作 | 公式資料／実画面未確認 | [公式投稿ヘルプ](https://support.google.com/blogger/answer/154172?hl=en) |
| Medium | 文章を選択して装飾するエディタ | 公式資料／実画面未確認 | [公式エディタ案内](https://help.medium.com/hc/en-us/articles/215194537-Using-the-story-editor) |
| Ghost | Koenig、Lexical | 公開デモのDOM＋公式資料 | [公式刷新案内](https://ghost.org/changelog/new-editor/)、[公開デモ](https://koenig.ghost.org/) |
| Notion／Notion Sitesの執筆画面 | ブロック単位の編集、公開サイトへの接続。入力要素・内部ライブラリは未確認 | 公式資料／実画面未確認 | [公式編集ガイド](https://www.notion.com/help/writing-and-editing-basics)、[公式サイト公開ガイド](https://www.notion.com/help/public-pages-and-web-publishing) |
| Tumblr | リッチテキスト／HTML／Markdown、複数のコンテンツブロック | 公式資料／実画面未確認 | [公式投稿ガイド](https://help.tumblr.com/knowledge-base/writing-posts/) |
| Substack | 記事用エディタ、下書き保存 | 公式資料／実画面未確認 | [公式投稿ガイド](https://support.substack.com/hc/en-us/articles/360037831771-How-do-I-publish-a-new-post-on-Substack) |
| Wix Blog | リッチテキストの投稿エディタ | 公式資料／実画面未確認 | [公式書式設定ガイド](https://support.wix.com/en/article/wix-blog-editing-the-text-formatting-of-your-blog-posts) |
| Squarespace | ブログはclassic editorで、本文をテキストなどのブロックで構成 | 公式資料／実画面未確認 | [公式ブログガイド](https://support.squarespace.com/hc/en-us/articles/206543727-Blogging-with-Squarespace) |
| Webflow CMS | 長文向けRich text field、Designer上のRich text element | 公式資料／実画面未確認 | [公式CMSフィールド](https://help.webflow.com/hc/en-us/articles/33961390084499-Collection-fields)、[Rich text element](https://help.webflow.com/hc/en-us/articles/33961256808467-Rich-text-element-overview) |

### 個人ブログにも使われるCMS・管理画面

| 対象 | 確認した編集方式 | 確認範囲 | 出典 |
|---|---|---|---|
| Movable Type | 9はTiptap。従来はTinyMCE | 公式資料／実画面未確認 | [公式MT9案内](https://www.sixapart.jp/movabletype/news/amp/2025/10/22-1100.html) |
| Drupal | CKEditor 5の統合。古い世代にはCKEditor 4 | 公式資料／実画面未確認 | [公式CKEditor 5モジュール](https://www.drupal.org/docs/core-modules-and-themes/core-modules/ckeditor-5-module)、[CKEditor 5のcontenteditableとmodel](https://ckeditor.com/docs/ckeditor5/latest/framework/architecture/editing-engine.html) |
| Joomla | TinyMCE／CodeMirror／No editor | 公式資料／実画面未確認 | [公式エディタ一覧](https://docs.joomla.org/Content_editors) |
| microCMS | 新リッチエディタはTiptap | 公式資料／実画面未確認 | [公式操作ガイド](https://document.microcms.io/manual/rich-editor-usage) |
| Strapi | Rich text Blocks／Rich text Markdown／Text | 公式資料／実画面未確認 | [公式Content Manager](https://docs.strapi.io/cms/features/content-manager) |
| Contentful | Rich Text／Markdown、カスタムエディタも可能 | 公式資料／実画面未確認 | [公式entry editor](https://www.contentful.com/help/content-and-entries/entry-editor/) |
| Directus | textarea／TinyMCEのWYSIWYG／Markdown／Code | 公式資料／実画面未確認 | [公式フィールド資料](https://docs.directus.io/app/data-model/fields/text-numbers) |
| Decap CMS | richtext widgetのraw／rich_text。出力はMarkdown。code widgetはCodeMirror | 公式資料／実画面未確認 | [公式widget資料](https://decapcms.org/docs/widgets/) |
| TinaCMS | rich-text、string、textareaの入力。Markdown／MDX本文との接続、サイトプレビュー | 公式資料／実画面未確認 | [公式フィールド](https://tina.io/docs/reference/fields)、[textareaなどの入力部品](https://tina.io/docs/reference/toolkit/fields/built-in-plugins) |
| 自作のブログ管理画面 | 作り手がtextarea、contenteditable、任意のエディタライブラリを選べる | 設計上の候補／個別画面未確認 | 下記の編集方式を参照 |

はてなの独立したHTMLモードにはプラン条件があるが、見たままモード内のHTML編集タブは別である。Amebaの参照資料は2016年更新、FC2の資料には新旧投稿画面、Joomlaの参照資料には旧資料との注意書きがある。これらの現行画面・設置バージョンは実測で確認する必要がある。

MediumEditorというOSSの名前からMedium本体の実装を断定しない。また、Squarespaceのclassic editorという名称をWordPress Classic Editorと同一視しない。

## 入力要素・文書構造・ライブラリを分けて扱う

`contenteditable` とCodeMirrorは異なる層にある。前者はブラウザの編集機能で、後者はそれを使って入力・文書状態・描画を管理するライブラリである。CodeMirror 6の通常の編集用DOMはcontenteditableなので、属性検索で候補を発見できる。ただし長文ではDOMに全文が描画されず、原稿全文は `EditorView.state.doc` にある。発見に使える属性と、全文取得・適用に使う接続は同じとは限らない。[CodeMirror 6の公式API](https://codemirror.net/docs/ref/#view.EditorView.contentDOM)

CodeMirror 5は入力方式としてtextareaとcontenteditableを提供するため、バージョンを区別する。[CodeMirror 5の公式マニュアル](https://codemirror.net/5/doc/manual.html#option_inputStyle)

以下は実装済み機能ではなく、別々に確認する特徴の整理である。たとえばGutenbergの公開デモは「contenteditable」「複数ブロック」「iframe内」の特徴を持つが、最後の条件により今回の対象外になる。

| 確認する特徴 | 発見の手掛かり | 全文取得・表示・適用で必要な扱い |
|---|---|---|
| 単一のcontenteditable | 編集可能なroot、フォーカス、表示状態 | 原稿範囲を絞り、段落・改行・編集不可のカードを区別する |
| 複数ブロックのcontenteditable | 同じ文書領域に並ぶ編集可能要素 | 文書の順序とグループを保つ。最大の1要素に限定しない |
| textarea | 表示中の有効なtextarea、フォーカス | 現在値は `value`。DOMの `textContent` や本文テキストノードのRangeでは扱えない |
| iframe内のエディタ | 本文エディタがframe内にある | 対象外。frame内への探索・注入・接続は行わない |
| 文書全体の編集 | `document.designMode` | contenteditable属性のない文書も編集できるため、属性検索だけでは拾えない |
| CodeMirrorなどの仮想化エディタ | 編集用DOMとライブラリの手掛かり | DOMにない部分を含む全文は文書modelから取得し、修正を編集履歴に載せる |
| リッチテキストmodelを持つエディタ | Tiptap／ProseMirror、Lexical、CKEditor、Quillなどの手掛かり | DOMと保存modelを一致させる。汎用入力で対応できる範囲は実測し、必要なら方式別接続を使う |
| Shadow DOM内のエディタ | 到達できるshadow root内の上記入力 | 通常のdocument検索では内部に届かない。closed rootの扱いは別途検証が必要 |
| 独自描画・EditContextなど | 編集イベントや方式固有の接続 | 文字列がDOMのテキストノードにないことがあり、汎用DOM照合だけで対応保証できない |

`contenteditable` には `true`・空文字に加え `plaintext-only` があり、属性の指定を親から継承する場合もある。旧selectorはplaintext-onlyを候補にしなかった。genericAdapterでは実際の `isContentEditable` で判定する。[属性の公式解説](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable)

textareaの現在値は[valueの公式解説](https://developer.mozilla.org/en-US/docs/Web/API/HTMLTextAreaElement/value)、文書全体の編集は[designModeの解説](https://developer.mozilla.org/en-US/docs/Web/API/Document/designMode)、独自描画を支える編集接続は[EditContextの解説](https://developer.mozilla.org/en-US/docs/Web/API/EditContext)を参照。

TinyMCEは[classic modeでiframe、inline modeで通常の要素](https://www.tiny.cloud/docs/tinymce/latest/use-tinymce-classic/)を使う。CKEditor 5は[独自modelを編集しDOMへ描画する構造](https://ckeditor.com/docs/ckeditor5/latest/framework/architecture/editing-engine.html)を持つ。Quillは[本文・位置・変更を扱うAPI](https://quilljs.com/docs/api)を持つ。ライブラリの利用そのものを、DOM経由の外部入力が常に失敗する根拠にはしない。保存・undoまでの成功を確認して方式を選ぶ。

TinyMCEのclassic modeは今回の対象外、inline modeは候補である。Notionは公式資料からブロック構造までは確認できるが、contenteditableの配置、画面外の本文取得、保存modelへの入力反映は実画面で検証する必要がある。公式資料だけでは内部ライブラリを断定しない。

## 修正候補を表示したまま保存する場合

現行コードでは、未適用の修正候補は本文の変更ではない。`InlinePreview.build` は段落をcloneし、コピー側に元の文字と候補を組み込む。コピーはエディタの外にある拡張用hostのclosed Shadow DOMへ置き、原稿の文字はCSS Highlightで見た目だけ隠す。原稿のテキストを候補へ置き換えるのは、利用者が適用したときの `applyReplacement` である。[プレビュー実装](../../../apps/extension/entrypoints/minaosi/ui/inline-preview.ts)、[拡張用host](../../../apps/extension/entrypoints/minaosi/controller.ts)、[適用処理](../../../apps/extension/entrypoints/minaosi/surfaces/resolve.ts)

したがってコード上の想定では、未適用の候補を表示したまま保存すると元の本文が保存され、適用した箇所だけが変更後の本文として保存される。取消線・候補文・指摘の装飾は保存本文に含めない。これは現在の実装の静的確認であり、noteでの保存・再読込や各エディタの保存処理による実証ではない。

対応検証では、候補表示中の手動保存と自動保存、適用後の保存、再読込後の本文、undoを確認する。候補表示だけで保存内容が変わらず、適用した変更だけが残ることを合格条件とする。Notion Sitesでは[ページの変更が公開サイトへ自動反映される](https://www.notion.com/help/public-pages-and-web-publishing)ため、適用による公開面への反映も確認対象になる。

## コメント欄などの誤検知を防ぐ条件

ユーザーの要件として、コメント・検索・問い合わせ・チャットなど、原稿本文でない入力欄を校閲対象にしない。旧noteAdapterは表示中の最大のcontenteditableを選ぶだけで、この判定を持っていなかった。今回genericAdapterに用途判定を実装した。textareaは本文候補との競合判定には使うが、校閲には未対応として除外する。

ヒューリスティックによる判定は可能だが、任意の自作ページで完全な判別は保証できない。本文とコメントが同じ属性・構造を持つ場合、DOMだけでは用途を一意に決められない。誤検知を抑えるため、根拠が弱い画面では自動起動しない。その代わり、対応可能な本文でも検知できない場合が増える。

設計案は、ページ内の情報を使って段階的に候補を絞る方式である。本文の用途判定のために入力内容をAIへ送ることは前提にしない。

1. 非表示、編集不可、disabled、iframe内など、対象外の入力を除く。
2. 入力に対応するlabel、aria-label、name、placeholder、近接する見出し、所属フォームの用途を確認する。コメント・返信・検索などの用途が明確なら除外する。祖先のどこかに「コメント」という単語があるだけで本文まで除外しない。
3. 本文を示すラベル、本文用の編集領域、編集ツールバー、タイトル欄との関係、下書き保存・公開操作との関係を組み合わせ、原稿である根拠を探す。ツールバーの存在だけでもコメント欄との区別にはならない。
4. フォーカス、面積、文字数、複数段落などは補助情報とする。長いコメントや空の新規原稿があるため、最大・最長・フォーカス中の1要素を本文と断定しない。
5. 本文である根拠が不足する場合や、複数候補が競合する場合は校閲しない。自動で別の入力欄へ切り替えず、本文を確定できる場合だけ有効にする。手動で対象を指定する操作の有無は別途決める。

検証には、コメント欄しかないページ、本文より長いコメント、本文とコメントがともにリッチテキスト、タイトルと空の本文、本文編集中にコメントへフォーカスする場合を含める。非本文の入力で校閲を開始せず、確定した本文に別の入力欄の文字を混ぜないことを合格条件とする。

## PRDに落とすときの境界

ユーザーの希望は、note以外にも、WordPressや独自ドメインの個人ブログで執筆画面を検知できること、対象外の画面ではサービス名を出さず「無効な画面です」と表示することである。

iframe内のエディタは対象外と決定した。本文エディタがiframe内にしかない場合も「無効な画面です」とする。Notionのブラウザ上の執筆画面も調査対象に含める。

調査からは、次の要件が必要だと考える。対象方式の優先順位や選択操作はまだ決定していない。

1. ドメインの許可リストだけで対象を定義しない。利用者が許可した任意ドメインで、入力の方式から候補を発見する。
2. 発見した候補と、校閲に使う原稿の範囲を区別する。検索欄・コメント欄・タイトル・画像の説明も入力なので、contenteditableがあるだけではブログ本文と断定しない。本文と判定できない場合は自動校閲を始めず「無効な画面です」とする。
3. 複数候補がある場合、フォーカスや文書構造を手掛かりにしても一意に決まらなければ、利用者が原稿の範囲を選べる方法を検討する。
4. 全文の取得可否と修正の適用可否を区別する。全文が取れないのに原稿全体の校閲として実行しない。未知の方式を誤って対応済みと扱わない。
5. 編集方式別の接続を共通化し、必要な文書のグルーピングなどだけサービス固有の補助として残す。サービス固有処理をゼロにすること自体を目標にしない。
6. 本文上の表示は既存画面と対応させる。Markdown／HTMLではソースとプレビューが異なるため、プレビュー上の文字をソースへ対応付ける範囲も別途決める。

任意ドメインで実行するには、拡張がそのページへ注入できる権限も要る。利用者が押したときに `activeTab` で動かす方式と、利用者が許可したサイトに継続して動かす方式では、起動操作と権限の範囲が違う。自動校閲を保つ場合は、押したときだけの一時権限では不足する場面がある。[Chromeの注入・権限資料](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)

ページのエディタmodelへ接続する場合、拡張のcontent scriptとページのJavaScriptは通常別の実行環境にある。公式APIが存在しても、content scriptからそのinstanceを直接読めるとは限らない。DOMによる検知と、ページ側との接続の可否を分けて検証する。同資料のisolated worldの説明を根拠とする。

## 次に検証するべき代表例

- 単一rootのリッチテキスト: note、Ghost、Tiptapの公開デモ。
- 複数ブロックの本文: Notion、iframeを使わない構成のWordPress。タイトル・コメント・別ページを混ぜずに全文をまとめられるか確認する。
- 通常のHTML要素上のリッチテキスト: TinyMCE inline。classic modeのiframeは対象外。
- 長文のDOM欠落: CodeMirror 6。全文取得と画面外の指摘への移動を確認する。
- textarea: 独自ドメインの簡単なブログ管理画面。
- Markdownとプレビューの対応: Zenn、Qiita、Decap CMSなど。対象サービスを決めて実画面で確認する。
- 保存内容の分離: 未適用の候補が手動保存・自動保存で混入せず、適用した変更だけが再読込後も残ることを確認する。
- 非本文の除外: コメントだけの画面、本文とコメントの混在、長いコメント、空の原稿、フォーカス移動での誤検知を確認する。

公開デモのDOM観測は検知設計の根拠であり、各サービスでminaosiが校閲・表示・適用・undoできる証明ではない。
