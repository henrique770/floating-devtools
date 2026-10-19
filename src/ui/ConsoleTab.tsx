import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { LogGroup } from '../analysis/groups';
import { originOf } from '../analysis/origin';
import type { DevtoolsStore } from '../content/store';
import type { ConsoleEntry, ConsoleLevel, SerializedValue } from '../shared/types';
import { formatClock } from './format';
import { IconChevron, IconClear } from './Icons';
import { usePersistentState } from './usePersistentState';
import { preview, ValueView } from './ValueView';

const LEVELS: { key: string; label: string; match: (l: ConsoleLevel) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'error', label: 'Errors', match: (l) => l === 'error' },
  { key: 'warn', label: 'Warnings', match: (l) => l === 'warn' },
  { key: 'info', label: 'Info', match: (l) => l === 'info' },
  { key: 'log', label: 'Logs', match: (l) => l === 'log' || l === 'command' || l === 'result' },
  { key: 'debug', label: 'Verbose', match: (l) => l === 'debug' },
];

const ORIGINS = [
  { key: 'all', label: 'Todas as origens' },
  { key: 'page', label: 'Esta origem' },
  { key: 'third-party', label: 'Terceiros' },
];

const PERIODS = [
  { key: 'all', label: 'Todo o período', ms: 0 },
  { key: '1m', label: 'Último minuto', ms: 60_000 },
  { key: '5m', label: 'Últimos 5 min', ms: 5 * 60_000 },
  { key: '15m', label: 'Últimos 15 min', ms: 15 * 60_000 },
];

/** Occurrences listed when a group is expanded (the most recent ones). */
const MAX_MEMBERS = 200;

/** Current time, refreshed periodically while `enabled` (keeps relative period filters moving). */
function useNow(enabled: boolean, everyMs = 5000) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!enabled) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(id);
  }, [enabled, everyMs]);
  return now;
}

interface Props {
  store: DevtoolsStore;
  logs: ConsoleEntry[];
  groups: LogGroup[];
  active: boolean;
}

export function ConsoleTab({ store, logs, groups, active }: Props) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [period, setPeriod] = useState('all');
  const [showTime, setShowTime] = useState(false);
  const [grouped, setGrouped] = usePersistentState('console.grouped', false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const periodMs = (PERIODS.find((p) => p.key === period) ?? PERIODS[0]).ms;
  const now = useNow(active && periodMs > 0);

  const matches = useMemo(() => {
    const levelMatch = (LEVELS.find((l) => l.key === level) ?? LEVELS[0]).match;
    const q = query.trim().toLowerCase();
    const pageOrigin = location.origin;
    return (e: ConsoleEntry) =>
      levelMatch(e.level) &&
      (origin === 'all' || originOf(e, pageOrigin) === origin) &&
      (!q || e.args.some((a) => preview(a).toLowerCase().includes(q)) || !!e.source?.label.toLowerCase().includes(q));
  }, [level, origin, query]);

  const since = periodMs ? now - periodMs : 0;

  const visible = useMemo(() => (grouped ? [] : logs.filter((e) => e.time >= since && matches(e))), [grouped, logs, matches, since]);
  // A group is shown when it had activity in the period; its count is always the total since the last clear.
  const visibleGroups = useMemo(
    () => (grouped ? groups.filter((g) => g.lastTime >= since && matches(g.sample)) : []),
    [grouped, groups, matches, since],
  );

  // Occurrences of the expanded groups only, so closed rows keep their memoized props.
  const members = useMemo(() => {
    const map = new Map<string, ConsoleEntry[]>();
    if (!grouped || !openGroups.size) return map;
    for (const e of logs) {
      if (!e.group || !openGroups.has(e.group)) continue;
      const list = map.get(e.group);
      if (list) list.push(e);
      else map.set(e.group, [e]);
    }
    return map;
  }, [grouped, logs, openGroups]);

  const toggleGroup = useCallback(
    (key: string) =>
      setOpenGroups((prev) => {
        const next = new Set(prev);
        if (!next.delete(key)) next.add(key);
        return next;
      }),
    [],
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && active && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible, visibleGroups, active]);

  const shown = grouped ? visibleGroups.length : visible.length;

  return (
    <div className="con">
      <div className="toolbar">
        <button
          type="button"
          className="fdt-icon-btn"
          onClick={() => {
            store.clearConsole();
            setOpenGroups(new Set());
          }}
          title="Limpar console"
        >
          <IconClear />
        </button>
        <input className="fdt-input" placeholder="Filtrar" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <label className="check" title="Agrupar mensagens equivalentes (mesma mensagem, origem e stack trace)">
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> Agrupar
        </label>
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
        <span className="chips-end">
          <select className={`fdt-select${origin !== 'all' ? ' is-set' : ''}`} value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Origem">
            {ORIGINS.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
          <select className={`fdt-select${period !== 'all' ? ' is-set' : ''}`} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label="Período">
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        </span>
      </div>
      <div
        className="con-list"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
        }}
      >
        {grouped
          ? visibleGroups.map((g) =>
              g.count > 1 ? (
                <GroupRow key={g.key} group={g} showTime={showTime} open={openGroups.has(g.key)} members={members.get(g.key)} onToggle={toggleGroup} />
              ) : (
                <Message key={g.key} entry={g.sample} showTime={showTime} />
              ),
            )
          : visible.map((e) => <Message key={e.id} entry={e} showTime={showTime} />)}
        {!shown && <div className="empty">{logs.length ? 'Nenhuma mensagem corresponde ao filtro.' : 'Nenhuma mensagem ainda.'}</div>}
      </div>
      <Prompt onRun={(code) => {
        stickToBottom.current = true;
        store.evaluate(code);
      }} />
    </div>
  );
}

interface GroupRowProps {
  group: LogGroup;
  showTime: boolean;
  open: boolean;
  /** Occurrences still in the log buffer; only provided while open. */
  members?: ConsoleEntry[];
  onToggle: (key: string) => void;
}

const GroupRow = memo(function GroupRow({ group: g, showTime, open, members = [], onToggle }: GroupRowProps) {
  const entry = useMemo(() => ({ ...g.sample, count: g.count }), [g]);
  const span = `primeira ${formatClock(g.firstTime)} · última ${formatClock(g.lastTime)}`;
  const recent = members.slice(-MAX_MEMBERS);
  const retained = members.reduce((n, e) => n + (e.count ?? 1), 0);
  return (
    <div className={`msg-group${open ? ' is-open' : ''}`}>
      <Message entry={entry} showTime={showTime} group={{ open, span, onToggle: () => onToggle(g.key) }} />
      {open && (
        <div className="msg-group-members">
          <div className="msg-group-meta">
            {g.count} ocorrências · {span}
            {retained < g.count && ` · ${g.count - retained} mais antigas já saíram do buffer`}
            {recent.length < members.length && ` · exibindo as ${recent.length} entradas mais recentes`}
          </div>
          {recent.map((e) => (
            <Message key={e.id} entry={e} showTime />
          ))}
        </div>
      )}
    </div>
  );
});

interface MessageProps {
  entry: ConsoleEntry;
  showTime: boolean;
  /** Set when the row heads a group: the count becomes the expand toggle. */
  group?: { open: boolean; span: string; onToggle: () => void };
}

const Message = memo(function Message({ entry: e, showTime, group }: MessageProps) {
  const [stackOpen, setStackOpen] = useState(false);
  const icon = e.level === 'error' ? '✕' : e.level === 'warn' ? '⚠' : e.level === 'command' ? '›' : e.level === 'result' ? '‹' : '';
  const count = e.count && e.count > 1 ? e.count : 0;
  return (
    <div className={`msg lvl-${e.level}`}>
      <span className="msg-icon">{icon}</span>
      {group ? (
        <button
          type="button"
          className="msg-count is-toggle"
          aria-expanded={group.open}
          onClick={group.onToggle}
          title={`${e.count} ocorrências (${group.span}) — ${group.open ? 'recolher' : 'expandir'}`}
        >
          <IconChevron open={group.open} width={8} height={8} />
          {e.count}
        </button>
      ) : count ? (
        <span className="msg-count">{count}</span>
      ) : null}
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
