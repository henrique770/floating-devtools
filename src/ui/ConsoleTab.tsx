import { memo, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { DevtoolsStore } from '../content/store';
import type { ConsoleEntry, ConsoleLevel, SerializedValue } from '../shared/types';
import { formatClock } from './format';
import { IconChevron, IconClear } from './Icons';
import { preview, ValueView } from './ValueView';

const LEVELS: { key: string; label: string; match: (l: ConsoleLevel) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'error', label: 'Errors', match: (l) => l === 'error' },
  { key: 'warn', label: 'Warnings', match: (l) => l === 'warn' },
  { key: 'info', label: 'Info', match: (l) => l === 'info' },
  { key: 'log', label: 'Logs', match: (l) => l === 'log' || l === 'command' || l === 'result' },
  { key: 'debug', label: 'Verbose', match: (l) => l === 'debug' },
];

interface Props {
  store: DevtoolsStore;
  logs: ConsoleEntry[];
  active: boolean;
}

export function ConsoleTab({ store, logs, active }: Props) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [showTime, setShowTime] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const visible = useMemo(() => {
    const match = (LEVELS.find((l) => l.key === level) ?? LEVELS[0]).match;
    const q = query.trim().toLowerCase();
    return logs.filter(
      (e) =>
        match(e.level) &&
        (!q || e.args.some((a) => preview(a).toLowerCase().includes(q)) || e.source?.label.toLowerCase().includes(q)),
    );
  }, [logs, level, query]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && active && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible, active]);

  return (
    <div className="con">
      <div className="toolbar">
        <button type="button" className="fdt-icon-btn" onClick={() => store.clearConsole()} title="Limpar console">
          <IconClear />
        </button>
        <input className="fdt-input" placeholder="Filtrar" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <label className="check" title="Mostrar horário">
          <input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} /> Hora
        </label>
      </div>
      <div className="chips" role="radiogroup" aria-label="Nível">
        {LEVELS.map((l) => (
          <button key={l.key} type="button" role="radio" aria-checked={level === l.key} className="chip" onClick={() => setLevel(l.key)}>
            {l.label}
          </button>
        ))}
      </div>
      <div
        className="con-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {visible.map((e) => (
          <Message key={e.id} entry={e} showTime={showTime} />
        ))}
        {!visible.length && <div className="empty">{logs.length ? 'Nenhuma mensagem corresponde ao filtro.' : 'Nenhuma mensagem ainda.'}</div>}
      </div>
      <Prompt onRun={(code) => {
        stickToBottom.current = true;
        store.evaluate(code);
      }} />
    </div>
  );
}

const Message = memo(function Message({ entry: e, showTime }: { entry: ConsoleEntry; showTime: boolean }) {
  const [stackOpen, setStackOpen] = useState(false);
  const icon = e.level === 'error' ? '✕' : e.level === 'warn' ? '⚠' : e.level === 'command' ? '›' : e.level === 'result' ? '‹' : '';
  return (
    <div className={`msg lvl-${e.level}`}>
      <span className="msg-icon">{icon}</span>
      {e.count && e.count > 1 ? <span className="msg-count">{e.count}</span> : null}
      <div className="msg-content">
        {showTime && <span className="msg-time">{formatClock(e.time)}</span>}
        {e.stack && (
          <button type="button" className="v-toggle" onClick={() => setStackOpen(!stackOpen)} title="Stack trace">
            <IconChevron open={stackOpen} />
          </button>
        )}
        {e.prefix && <span className="msg-prefix">{e.prefix} </span>}
        {e.level === 'command' ? <span className="v-text">{(e.args[0] as { v: string }).v}</span> : formatArgs(e.args)}
        {stackOpen && e.stack && <pre className="v-stack">{e.stack}</pre>}
      </div>
      {e.source && (
        <span className="msg-source" title={e.source.url}>
          {e.source.label}
        </span>
      )}
    </div>
  );
});

const ALLOWED_CSS = new Set([
  'color',
  'background',
  'background-color',
  'font-weight',
  'font-style',
  'font-size',
  'text-decoration',
  'padding',
  'border-radius',
  'border',
  'margin',
]);

function parseCss(css: string): CSSProperties {
  const style: Record<string, string> = {};
  for (const decl of css.split(';')) {
    const i = decl.indexOf(':');
    if (i < 0) continue;
    const prop = decl.slice(0, i).trim().toLowerCase();
    const value = decl.slice(i + 1).trim();
    if (ALLOWED_CSS.has(prop) && !/url\(/i.test(value)) style[prop.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase())] = value;
  }
  return style as CSSProperties;
}

/** Applies printf-style substitutions (%s %d %i %f %o %O %c) like the browser console. */
function formatArgs(args: SerializedValue[]): ReactNode {
  const [first, ...rest] = args;
  if (!first || first.t !== 'string' || !first.v.includes('%')) {
    return args.map((a, i) => (
      <span key={i} className="msg-arg">
        <ValueView value={a} top />
      </span>
    ));
  }
  const out: ReactNode[] = [];
  let style: CSSProperties | undefined;
  let buffer = '';
  let key = 0;
  const flush = () => {
    if (buffer) out.push(<span key={key++} style={style}>{buffer}</span>);
    buffer = '';
  };
  const re = /%([sdifoOc%])/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(first.v))) {
    buffer += first.v.slice(last, m.index);
    last = re.lastIndex;
    const spec = m[1];
    if (spec === '%') {
      buffer += '%';
      continue;
    }
    if (!rest.length) {
      buffer += m[0];
      continue;
    }
    const arg = rest.shift()!;
    if (spec === 'c') {
      flush();
      style = arg.t === 'string' ? parseCss(arg.v) : undefined;
    } else if (spec === 's') {
      buffer += preview(arg, arg.t !== 'string');
    } else if (spec === 'd' || spec === 'i') {
      buffer += arg.t === 'number' ? String(Math.trunc(Number(arg.v))) : 'NaN';
    } else if (spec === 'f') {
      buffer += arg.t === 'number' ? arg.v : 'NaN';
    } else {
      flush();
      out.push(<ValueView key={key++} value={arg} />);
    }
  }
  buffer += first.v.slice(last);
  flush();
  rest.forEach((a) =>
    out.push(
      <span key={key++}>
        {' '}
        <ValueView value={a} top />
      </span>,
    ),
  );
  return out;
}

function Prompt({ onRun }: { onRun: (code: string) => void }) {
  const [code, setCode] = useState('');
  const history = useRef<string[]>([]);
  const cursor = useRef(-1);

  return (
    <div className="prompt">
      <span className="prompt-caret">›</span>
      <textarea
        rows={Math.min(6, code.split('\n').length)}
        value={code}
        placeholder="Executar JavaScript na página (Enter executa, Shift+Enter quebra linha)"
        spellCheck={false}
        onChange={(e) => setCode(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            if (!code.trim()) return;
            history.current.push(code);
            cursor.current = -1;
            onRun(code);
            setCode('');
          } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !code.includes('\n')) {
            const h = history.current;
            if (!h.length) return;
            e.preventDefault();
            let c = cursor.current === -1 ? h.length : cursor.current;
            c = e.key === 'ArrowUp' ? Math.max(0, c - 1) : c + 1;
            if (c >= h.length) {
              cursor.current = -1;
              setCode('');
            } else {
              cursor.current = c;
              setCode(h[c]);
            }
          }
        }}
      />
    </div>
  );
}
