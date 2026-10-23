export type AnswerBlock = { kind: 'paragraph' | 'heading' | 'code'; text: string }
  | { kind: 'list'; items: string[]; ordered: boolean }
  | { kind: 'table'; rows: string[][] };

export function extractedText(text: string): string {
  const match = /^\s*```[^\n]*\n([\s\S]*?)\n```\s*$/.exec(text);
  return match ? match[1] : text;
}

/** Uses the answer's first content line as a history preview without another model request. */
export function answerSummary(text: string): string {
  return text.split(/\r?\n/).slice(0, 30)
    .map((line) => line.replace(/^\s*```.*$/, '').replace(/^\s*[#>*+\-\d.)]+\s*/, '')
      .replace(/[*`]/g, '').replace(/\|/g, ' ').replace(/\s+/g, ' ').trim())
    .find((line) => line.length > 2 && !/^(?:overview|summary|analysis|translation|概述|总结|分析|翻译|问题分析|风险检查)[:：]?$/i.test(line))
    ?.slice(0, 70) ?? '';
}

const cells = (line: string): string[] => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((cell) => cell.trim());
const tableDivider = (line: string): boolean => line.includes('|') && cells(line).every((cell) => /^:?-{3,}:?$/.test(cell));

/** A small display-only Markdown subset. HTML and links remain text; sources have their own validated controls. */
export function answerBlocks(text: string): AnswerBlock[] {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const blocks: AnswerBlock[] = [];
  let i = 0;
  while (i < lines.length && blocks.length < 1500) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (/^\s*```/.test(line)) {
      const content: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) content.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push({ kind: 'code', text: content.join('\n') });
      continue;
    }
    if (i + 1 < lines.length && tableDivider(lines[i + 1])) {
      const rows = [cells(line)];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) rows.push(cells(lines[i++]));
      blocks.push({ kind: 'table', rows });
      continue;
    }
    if (/^#{1,6}\s+/.test(line)) {
      blocks.push({ kind: 'heading', text: line.replace(/^#{1,6}\s+/, '') }); i++; continue;
    }
    const item = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(line);
    if (item) {
      const ordered = !!item[2];
      const items: string[] = [];
      while (i < lines.length) {
        const next = /^\s*(?:([-*+])|(\d+)[.)])\s+(.+)$/.exec(lines[i]);
        if (!next || !!next[2] !== ordered) break;
        items.push(next[3]); i++;
      }
      blocks.push({ kind: 'list', items, ordered }); continue;
    }
    blocks.push({ kind: 'paragraph', text: line }); i++;
  }
  if (i < lines.length) blocks.push({ kind: 'paragraph', text: lines.slice(i).join('\n') });
  return blocks;
}
