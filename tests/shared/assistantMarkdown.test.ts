import { describe, expect, it } from 'vitest';
import { answerBlocks, answerSummary, extractedText } from '../../src/shared/assistantMarkdown';

describe('assistant Markdown', () => {
  it('creates a short contextual preview while skipping empty fences and generic headings', () => {
    expect(answerSummary('## 概述\n\n这张图展示了 **EMOTE 架构**。')).toBe('这张图展示了 EMOTE 架构。');
    expect(answerSummary('```csv\nItem,Count\nAlpha,3\n```')).toBe('Item,Count');
    expect(answerSummary('x'.repeat(500))).toHaveLength(70);
  });
  it('keeps HTML and links as text rather than producing active content', () => {
    expect(answerBlocks('<script>run()</script>\n[link](javascript:run())')).toEqual([
      { kind: 'paragraph', text: '<script>run()</script>' }, { kind: 'paragraph', text: '[link](javascript:run())' },
    ]);
  });

  it('recognizes headings, lists, fenced code and tables', () => {
    expect(answerBlocks('# Heading\n1. First\n2. Second\n\n```ts\nconst x = 1;\n```\n| A | B |\n| --- | --- |\n| 1 | 2 |')).toEqual([
      { kind: 'heading', text: 'Heading' }, { kind: 'list', ordered: true, items: ['First', 'Second'] },
      { kind: 'code', text: 'const x = 1;' }, { kind: 'table', rows: [['A', 'B'], ['1', '2']] },
    ]);
  });

  it('displays an incomplete streamed code block without dropping its content', () => {
    expect(answerBlocks('```python\nprint(1)')).toEqual([{ kind: 'code', text: 'print(1)' }]);
  });

  it('removes only an outer extraction fence when copying raw output', () => {
    expect(extractedText('```csv\na,b\n1,2\n```')).toBe('a,b\n1,2');
    expect(extractedText('Before\n```csv\na,b\n```')).toBe('Before\n```csv\na,b\n```');
  });
});
