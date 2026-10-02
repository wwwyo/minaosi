interface Change {
  fid: string;
  start: number;
  length: number;
}

/** 重なる修正案は選択中を優先し、原稿の後ろから表示用DOMへ挿入できる順に並べる。 */
export function planInlineChanges<T extends Change>(changes: T[], selectedId: string | null): T[] {
  const selectedFirst = [...changes].sort((a, b) => Number(b.fid === selectedId) - Number(a.fid === selectedId));
  const accepted: T[] = [];
  for (const change of selectedFirst) {
    if (!accepted.some(other => change.start < other.start + other.length && change.start + change.length > other.start)) accepted.push(change);
  }
  return accepted.sort((a, b) => b.start - a.start);
}
