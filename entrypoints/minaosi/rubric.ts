/** 日本語ルール層の既定ルール。書き手は個別に有効・無効を切り替えられる。 */

export interface LanguageRule {
  id: string;
  label: string;
  /** LLM への判定指示 */
  hint: string;
}

export const LANGUAGE_RULES: LanguageRule[] = [
  { id: 'repeat-ending', label: '語尾の連続', hint: '同一段落内で同じ語尾が続く' },
  { id: 'style-mix', label: 'です・ます調と常体（である調）の混在', hint: '段落内で敬体と常体が混在する' },
  { id: 'particle-dup', label: '同じ助詞の重複', hint: '「の」「が」など同じ助詞が一文内で重複する' },
  { id: 'ranuki', label: 'ら抜き言葉', hint: '「見れる」「食べれる」など' },
  { id: 'tenioha', label: 'テニオハの誤用', hint: '「を」と「が」の取り違えなど' },
  { id: 'unnatural', label: '不自然な日本語表現', hint: '意味を読まなければ判定できない不自然さ' },
];


