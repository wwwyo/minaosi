import type { ReviewBlock, ReviewedFinding } from './schema';

export const MAX_STYLE_GUIDE_LENGTH = 16_000;
export const MAX_STYLE_GUIDE_BYTES = 65_536;

/** 例外節の項目と、「ただし〜許容する」のように明記された例外文を取り出す。 */
export function styleExceptions(content: string): string[] {
  const exceptions: string[] = [];
  let sectionLevel = 0;
  let fence: { marker: string; length: number } | undefined;
  for (const line of content.split(/\r?\n/)) {
    const boundary = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (boundary && boundary[1]![0] === fence.marker && boundary[1]!.length >= fence.length && !boundary[2]!.trim()) fence = undefined;
      continue;
    }
    if (boundary) { fence = { marker: boundary[1]![0]!, length: boundary[1]!.length }; continue; }
    const heading = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading) {
      if (sectionLevel && heading[1]!.length <= sectionLevel) sectionLevel = 0;
      if (['例外', '許容する表現', '許容表現'].includes(heading[2]!)) sectionLevel = heading[1]!.length;
      continue;
    }
    const item = /^\s*[-*+]\s+(.+?)\s*$/.exec(line);
    if (sectionLevel && item) exceptions.push(item[1]!);
    for (const sentence of line.split(/(?<=[。！？])/u)) {
      const text = sentence.trim();
      if (/^(?:ただし|但し)[、,]?\s*.+(?:許容する|許容します|許容|認める|認めます|使ってよい|使用してよい|でよい)[。！？]?$/.test(text)) exceptions.push(text);
    }
  }
  return [...new Set(exceptions)];
}

/** 明示された例外と対象本文を確認できない抑制は採用せず、指摘を残す。 */
export function applyStyleExceptions(
  findings: ReviewedFinding[],
  styleGuide = '',
  blocks: ReviewBlock[] = [],
): ReviewedFinding[] {
  const allowed = new Set(styleExceptions(styleGuide));
  const texts = new Map(blocks.map(block => [block.index, block.text]));
  return findings.flatMap(raw => {
    const { exception, ...finding } = raw as ReviewedFinding & { exception?: unknown };
    if (finding.kind === 'style' && !styleGuide.trim()) return [];
    if ((finding.kind === 'rule' || finding.kind === 'style') && exception && typeof exception === 'object') {
      const evidence = exception as { rule?: unknown; reason?: unknown };
      const text = typeof finding.block === 'number' ? texts.get(finding.block) : undefined;
      if (typeof evidence.rule === 'string' && allowed.has(evidence.rule) &&
          typeof evidence.reason === 'string' && evidence.reason.trim() && text !== undefined &&
          finding.matches?.length && finding.matches.every(match => match && typeof match === 'object' && typeof match.from === 'string' && match.from.length > 0 && text.includes(match.from))) {
        return [];
      }
    }
    return [finding];
  });
}
