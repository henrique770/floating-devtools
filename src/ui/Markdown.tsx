import { memo, type ReactNode } from 'react';

/** Inline `code`, **bold** and *italic*. Everything is rendered as text nodes (no HTML). */
function inline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] !== undefined) out.push(<code key={m.index}>{m[1]}</code>);
    else if (m[2] !== undefined) out.push(<strong key={m.index}>{m[2]}</strong>);
    else out.push(<em key={m.index}>{m[3]}</em>);
    last = re.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

/** Small Markdown subset used by the assistant replies: headings, lists, fenced code, paragraphs. */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks: ReactNode[] = [];
  const lines = text.split('\n');
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const fence = line.match(/^\s*```(\w*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++]);
      i++;
      blocks.push(
        <pre key={blocks.length} className="md-code">
          {code.join('\n')}
        </pre>,
      );
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.*)/);
    if (heading) {
      blocks.push(
        <p key={blocks.length} className="md-heading">
          {inline(heading[2])}
        </p>,
      );
      i++;
      continue;
    }
    const listItem = /^\s*([-*•]|\d+[.)])\s+/;
    if (listItem.test(line)) {
      const ordered = /^\s*\d/.test(line);
      const items: ReactNode[] = [];
      while (i < lines.length && listItem.test(lines[i])) {
        items.push(<li key={items.length}>{inline(lines[i].replace(listItem, ''))}</li>);
        i++;
      }
      blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !listItem.test(lines[i]) && !/^\s*```|^#{1,4}\s/.test(lines[i])) para.push(lines[i++]);
    blocks.push(<p key={blocks.length}>{inline(para.join('\n'))}</p>);
  }
  return <div className="md">{blocks}</div>;
});
