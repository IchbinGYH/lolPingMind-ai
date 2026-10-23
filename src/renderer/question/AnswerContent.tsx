import { Fragment } from 'react';
import { answerBlocks, extractedText } from '../../shared/assistantMarkdown';
import type { AssistantEntry } from '../../shared/ipc';

function inline(text: string) {
  return text.split(/(\*\*[^*\n]+\*\*|`[^`\n]+`)/g).map((part, index) => part.startsWith('**') && part.endsWith('**')
    ? <strong key={index}>{part.slice(2, -2)}</strong> : part.startsWith('`') && part.endsWith('`')
      ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>);
}

export function AnswerContent({ entry }: { entry: AssistantEntry }) {
  if (entry.action === 'extract' && entry.options.format !== 'markdown') {
    return <pre className="lensRawOutput"><code>{extractedText(entry.answer)}</code></pre>;
  }
  return <div className="lensMarkdown">{answerBlocks(entry.answer).map((block, index) => {
    if (block.kind === 'code') return <pre key={index}><code>{block.text}</code></pre>;
    if (block.kind === 'heading') return <h3 key={index}>{inline(block.text)}</h3>;
    if (block.kind === 'list') {
      const children = block.items.map((item, i) => <li key={i}>{inline(item)}</li>);
      return block.ordered ? <ol key={index}>{children}</ol> : <ul key={index}>{children}</ul>;
    }
    if (block.kind === 'table') return <div className="lensTableScroll" key={index}><table>
      <thead><tr>{block.rows[0].map((cell, i) => <th key={i}>{inline(cell)}</th>)}</tr></thead>
      <tbody>{block.rows.slice(1).map((row, i) => <tr key={i}>{row.map((cell, j) => <td key={j}>{inline(cell)}</td>)}</tr>)}</tbody>
    </table></div>;
    return <p key={index}>{inline(block.text)}</p>;
  })}</div>;
}
