import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { relatedRequests, type Correlation } from '../analysis/correlate';
import type { EventRef } from '../analysis/diagnostics/types';
import type { LogGroup } from '../analysis/groups';
import { originOf } from '../analysis/origin';
import type { DevtoolsStore } from '../content/store';
import type { ConsoleEntry, ConsoleLevel, NetworkEntry, SerializedValue } from '../shared/types';
import { CorrelationList, requestLabel, type EventLabel } from './Correlations';
import { formatClock } from './format';
import type { FocusTarget } from './focusContext';
import { IconAssistant, IconChevron, IconClear } from './Icons';
import { defineMessages } from '../i18n';
import { useLocale } from './useLocale';
import { usePersistentState } from './usePersistentState';
import { preview, ValueView } from './ValueView';

const m = defineMessages({
  pt: {
    origins: { all: 'Todas as origens', page: 'Esta origem', 'third-party': 'Terceiros' } as Record<string, string>,
    periods: { all: 'Todo o período', '1m': 'Último minuto', '5m': 'Últimos 5 min', '15m': 'Últimos 15 min' } as Record<string, string>,
    clear: 'Limpar console',
    filter: 'Filtrar',
    groupTitle: 'Agrupar mensagens equivalentes (mesma mensagem, origem e stack trace)',
    group: 'Agrupar',
    timeTitle: 'Mostrar horário',
    time: 'Hora',
    level: 'Nível',
    origin: 'Origem',
    period: 'Período',
    noMatch: 'Nenhuma mensagem corresponde ao filtro.',
    empty: 'Nenhuma mensagem ainda.',
    span: (first: string, last: string) => `primeira ${first} · última ${last}`,
    occurrences: (n: number) => `${n} ocorrências`,
    leftBuffer: (n: number) => ` · ${n} mais antigas já saíram do buffer`,
    showingRecent: (n: number) => ` · exibindo as ${n} entradas mais recentes`,
    toggleTitle: (n: number, span: string, open: boolean) => `${n} ocorrências (${span}) — ${open ? 'recolher' : 'expandir'}`,
    fromRequest: (req: string) => `Este erro veio da requisição ${req} — abrir na aba Network`,
    aiTitle: 'Investigar com IA: abre o Assistant focado nesta mensagem e nas requisições relacionadas',
    ai: 'Investigar com IA',
    related: 'Requisições possivelmente relacionadas',
    noRelated: 'Nenhuma requisição relacionada: sem vínculo de objeto, de stack ou falha logo antes.',
    prompt: 'Executar JavaScript na página (Enter executa, Shift+Enter quebra linha)',
  },
  en: {
    origins: { all: 'All origins', page: 'This origin', 'third-party': 'Third parties' },
    periods: { all: 'Whole period', '1m': 'Last minute', '5m': 'Last 5 min', '15m': 'Last 15 min' },
    clear: 'Clear console',
    filter: 'Filter',
    groupTitle: 'Group equivalent messages (same message, origin and stack trace)',
    group: 'Group',
    timeTitle: 'Show time',
    time: 'Time',
    level: 'Level',
    origin: 'Origin',
    period: 'Period',
    noMatch: 'No message matches the filter.',
    empty: 'No messages yet.',
    span: (first, last) => `first ${first} · last ${last}`,
    occurrences: (n) => `${n} occurrences`,
    leftBuffer: (n) => ` · ${n} older ones already left the buffer`,
    showingRecent: (n) => ` · showing the ${n} most recent entries`,
    toggleTitle: (n, span, open) => `${n} occurrences (${span}) — ${open ? 'collapse' : 'expand'}`,
    fromRequest: (req) => `This error came from the request ${req} — open in the Network tab`,
    aiTitle: 'Investigate with AI: opens the Assistant focused on this message and its related requests',
    ai: 'Investigate with AI',
    related: 'Possibly related requests',
    noRelated: 'No related request: no object link, shared stack or failure right before.',
    prompt: 'Run JavaScript on the page (Enter runs, Shift+Enter adds a line)',
  },
});

const LEVELS: { key: string; label: string; match: (l: ConsoleLevel) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'error', label: 'Errors', match: (l) => l === 'error' },
  { key: 'warn', label: 'Warnings', match: (l) => l === 'warn' },
  { key: 'info', label: 'Info', match: (l) => l === 'info' },
  { key: 'log', label: 'Logs', match: (l) => l === 'log' || l === 'command' || l === 'result' },
  { key: 'debug', label: 'Verbose', match: (l) => l === 'debug' },
];

const ORIGINS = ['all', 'page', 'third-party'];

const PERIODS = [
  { key: 'all', ms: 0 },
  { key: '1m', ms: 60_000 },
  { key: '5m', ms: 5 * 60_000 },
  { key: '15m', ms: 15 * 60_000 },
];

/** Lets message rows look up related requests on demand without re-rendering when requests change. */
interface Relations {
  find: (entry: ConsoleEntry) => Correlation[];
  label: (ref: EventRef) => EventLabel;
  open: (ref: EventRef) => void;
  investigate: (target: FocusTarget) => void;
}
const RelationsContext = createContext<Relations | null>(null);

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
  requests: NetworkEntry[];
  active: boolean;
  onNavigate: (ref: EventRef) => void;
  onInvestigate: (target: FocusTarget) => void;
  /** Entry to reveal (navigation from Insights); the nonce makes repeated clicks re-trigger. */
  focus?: { id: string; nonce: number };
}

export function ConsoleTab({ store, logs, groups, requests, active, focus, onNavigate, onInvestigate }: Props) {
  const [query, setQuery] = useState('');
  const [level, setLevel] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [period, setPeriod] = useState('all');
  const [showTime, setShowTime] = useState(false);
  const [grouped, setGrouped] = usePersistentState('console.grouped', false);
  const [openGroups, setOpenGroups] = useState<ReadonlySet<string>>(() => new Set());
  const listRef = useRef<HTMLDivElement>(null);
  const stickToBottom = useRef(true);

  const requestsRef = useRef(requests);
  requestsRef.current = requests;
  const navigateRef = useRef(onNavigate);
  navigateRef.current = onNavigate;
  const investigateRef = useRef(onInvestigate);
  investigateRef.current = onInvestigate;
  const relations = useMemo<Relations>(
    () => ({
      find: (entry) => relatedRequests(entry, requestsRef.current, location.origin),
      label: (ref) => requestLabel(requestsRef.current.find((r) => r.id === ref.id)),
      open: (ref) => navigateRef.current(ref),
      investigate: (target) => investigateRef.current(target),
    }),
    [],
  );

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

  useEffect(() => {
    if (!focus) return;
    const target = logs.find((l) => l.id === focus.id);
    if (!target) return;
    setQuery('');
    setLevel('all');
    setOrigin('all');
    setPeriod('all');
    if (grouped && target.group) setOpenGroups((prev) => new Set(prev).add(target.group!));
    stickToBottom.current = false;
    // Two frames: let the filter reset and the group expansion render first.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const list = listRef.current;
        const sel = `[data-id="${CSS.escape(focus.id)}"]`;
        const el = list?.querySelector<HTMLElement>(`.msg-group-members ${sel}`) ?? list?.querySelector<HTMLElement>(sel);
        if (!el) return;
        el.scrollIntoView({ block: 'center' });
        el.classList.add('is-focused');
        setTimeout(() => el.classList.remove('is-focused'), 1600);
      }),
    );
    // Only on a new navigation request, not when logs change.
  }, [focus]);

  const shown = grouped ? visibleGroups.length : visible.length;
  const t = m();

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
          title={t.clear}
        >
          <IconClear />
        </button>
        <input className="fdt-input" placeholder={t.filter} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <label className="check" title={t.groupTitle}>
          <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} /> {t.group}
        </label>
        <label className="check" title={t.timeTitle}>
          <input type="checkbox" checked={showTime} onChange={(e) => setShowTime(e.target.checked)} /> {t.time}
        </label>
      </div>
      <div className="chips" role="radiogroup" aria-label={t.level}>
        {LEVELS.map((l) => (
          <button key={l.key} type="button" role="radio" aria-checked={level === l.key} className="chip" onClick={() => setLevel(l.key)}>
            {l.label}
          </button>
        ))}
        <span className="chips-end">
          <select className={`fdt-select${origin !== 'all' ? ' is-set' : ''}`} value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label={t.origin}>
            {ORIGINS.map((o) => (
              <option key={o} value={o}>
                {t.origins[o]}
              </option>
            ))}
          </select>
          <select className={`fdt-select${period !== 'all' ? ' is-set' : ''}`} value={period} onChange={(e) => setPeriod(e.target.value)} aria-label={t.period}>
            {PERIODS.map((p) => (
              <option key={p.key} value={p.key}>
                {t.periods[p.key]}
              </option>
            ))}
          </select>
        </span>
      </div>
      <RelationsContext.Provider value={relations}>
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
          {!shown && <div className="empty">{logs.length ? t.noMatch : t.empty}</div>}
        </div>
      </RelationsContext.Provider>
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
  useLocale();
  const t = m();
  const entry = useMemo(() => ({ ...g.sample, count: g.count }), [g]);
  const span = t.span(formatClock(g.firstTime), formatClock(g.lastTime));
  const recent = members.slice(-MAX_MEMBERS);
  const retained = members.reduce((n, e) => n + (e.count ?? 1), 0);
  return (
    <div className={`msg-group${open ? ' is-open' : ''}`}>
      <Message entry={entry} showTime={showTime} group={{ open, span, onToggle: () => onToggle(g.key) }} />
      {open && (
        <div className="msg-group-members">
          <div className="msg-group-meta">
            {t.occurrences(g.count)} · {span}
            {retained < g.count && t.leftBuffer(g.count - retained)}
            {recent.length < members.length && t.showingRecent(recent.length)}
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
  const [relatedOpen, setRelatedOpen] = useState(false);
  const relations = useContext(RelationsContext);
  useLocale();
  const t = m();
  const canRelate = !!relations && (e.level === 'error' || e.level === 'warn');
  const icon = e.level === 'error' ? '✕' : e.level === 'warn' ? '⚠' : e.level === 'command' ? '›' : e.level === 'result' ? '‹' : '';
  const count = e.count && e.count > 1 ? e.count : 0;
  return (
    <div className={`msg lvl-${e.level}`} data-id={e.id}>
      <span className="msg-icon">{icon}</span>
      {group ? (
        <button
          type="button"
          className="msg-count is-toggle"
          aria-expanded={group.open}
          onClick={group.onToggle}
          title={t.toggleTitle(e.count ?? 0, group.span, group.open)}
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
        {relatedOpen && relations && <RelatedRequests entry={e} relations={relations} />}
      </div>
      {canRelate && (
        <span className="msg-actions">
          {e.request && (
            <button
              type="button"
              className="msg-rel is-exact"
              onClick={() => relations!.open({ kind: 'request', id: e.request! })}
              title={t.fromRequest(relations!.label({ kind: 'request', id: e.request }).text)}
            >
              NET ↗
            </button>
          )}
          <button
            type="button"
            className="msg-rel msg-ai"
            onClick={() => relations!.investigate({ kind: 'log', id: e.id })}
            title={t.aiTitle}
            aria-label={t.ai}
          >
            <IconAssistant size={11} />
          </button>
          <button
            type="button"
            className={`msg-rel${relatedOpen ? ' is-active' : ''}`}
            aria-expanded={relatedOpen}
            onClick={() => setRelatedOpen(!relatedOpen)}
            title={t.related}
          >
            ⇄
          </button>
        </span>
      )}
      {e.source && (
        <span className="msg-source" title={e.source.url}>
          {e.source.label}
        </span>
      )}
    </div>
  );
});

/** Computed once when opened: correlation is on demand, never per captured event. */
function RelatedRequests({ entry, relations }: { entry: ConsoleEntry; relations: Relations }) {
  const items = useMemo(() => relations.find(entry), [entry, relations]);
  return (
    <div className="msg-related">
      <span className="msg-related-title">{m().related}</span>
      <CorrelationList items={items} label={relations.label} onOpen={relations.open} empty={m().noRelated} />
    </div>
  );
}

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
        placeholder={m().prompt}
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
