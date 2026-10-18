import { memo, useEffect, useMemo, useState, type ReactNode } from 'react';
import { copyText } from './format';
import { highlight } from './highlight';
import { IconCheck, IconCopy } from './Icons';

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
    const fence = line.match(/^\s*```([\w+#.-]*)/);
    if (fence) {
      const code: string[] = [];
      i++;
      // Fences nested in a list are indented; drop that indentation from the code lines too.
      const indent = new RegExp(`^ {0,${line.length - line.trimStart().length}}`);
      while (i < lines.length && !/^\s*```/.test(lines[i])) code.push(lines[i++].replace(indent, ''));
      i++;
      blocks.push(<CodeBlock key={blocks.length} code={code.join('\n')} lang={fence[1]} />);
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

function CodeBlock({ code, lang }: { code: string; lang: string }) {
  const [copied, setCopied] = useState(false);
  const tokens = useMemo(() => highlight(code, lang), [code, lang]);

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(t);
  }, [copied]);

  return (
    <div className="md-code">
      <div className="md-code-head">
        <span className="md-code-lang">{lang || 'código'}</span>
        <button
          type="button"
          className="md-code-copy"
          onClick={() => copyText(code).then(() => setCopied(true))}
          title="Copiar código"
          aria-label="Copiar código"
        >
          {copied ? <IconCheck /> : <IconCopy />}
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
      <pre>{tokens}</pre>
    </div>
  );
}
