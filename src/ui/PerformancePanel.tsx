import { useMemo, useState } from 'react';
import type { EventRef, InsightsConfig } from '../analysis/diagnostics/types';
import { heaviestResources, phasesOf, slowestRequests, summarize, weightOf } from '../analysis/performance';
import type { NetworkEntry } from '../shared/types';
import { defineMessages } from '../i18n';
import { formatBytes, formatMs, shortName, statusLabel } from './format';

const m = defineMessages({
  pt: {
    title: 'Performance de rede',
    slowest: 'Mais lentas',
    heaviest: 'Mais pesadas',
    summary: (finished: number, transferred: string) => `${finished} concluídas · ${transferred} transferidos`,
    median: (ms: string) => ` · mediana das chamadas de API: ${ms}`,
    above: (n: number, limit: string) => `${n} acima de ${limit}`,
    queue: 'Fila/conexão',
    ttfb: 'Espera do servidor (TTFB)',
    noBreakdown: 'Sem detalhamento',
    empty: 'Nenhuma requisição concluída ainda.',
    less: 'Mostrar menos',
    upTo: (n: number) => `Mostrar até ${n}`,
    phases: (ttfb: string, download: string, queue: string) => `TTFB ${ttfb} · download ${download} · fila/conexão ${queue}`,
    noPhases: 'Sem fases: recurso de outra origem sem Timing-Allow-Origin, ou dado indisponível',
    total: (ms: string) => `Duração total ${ms}`,
    overLimit: 'acima do limite',
    noPhasesShort: 'sem fases',
    body: (size: string) => `corpo ${size}`,
    transferred: 'transferido',
    fromCache: 'do cache',
    heavyTitle: (transferred: string, decoded: string, cached: boolean) =>
      `Transferido: ${transferred}${decoded ? ` · corpo descomprimido: ${decoded}` : ''}${cached ? ' · servido do cache' : ''}`,
  },
  en: {
    title: 'Network performance',
    slowest: 'Slowest',
    heaviest: 'Heaviest',
    summary: (finished, transferred) => `${finished} finished · ${transferred} transferred`,
    median: (ms) => ` · median API call: ${ms}`,
    above: (n, limit) => `${n} above ${limit}`,
    queue: 'Queue/connection',
    ttfb: 'Server wait (TTFB)',
    noBreakdown: 'No breakdown',
    empty: 'No finished requests yet.',
    less: 'Show less',
    upTo: (n) => `Show up to ${n}`,
    phases: (ttfb, download, queue) => `TTFB ${ttfb} · download ${download} · queue/connection ${queue}`,
    noPhases: 'No phases: cross-origin resource without Timing-Allow-Origin, or data unavailable',
    total: (ms) => `Total duration ${ms}`,
    overLimit: 'above the limit',
    noPhasesShort: 'no phases',
    body: (size) => `body ${size}`,
    transferred: 'transferred',
    fromCache: 'from cache',
    heavyTitle: (transferred, decoded, cached) => `Transferred: ${transferred}${decoded ? ` · decoded body: ${decoded}` : ''}${cached ? ' · served from cache' : ''}`,
  },
});

type View = 'slow' | 'heavy';
const SHORT = 6;
const LONG = 20;

interface Props {
  requests: NetworkEntry[];
  limits: InsightsConfig;
  onNavigate: (ref: EventRef) => void;
}

/** Rankings of the slowest requests and heaviest resources, with the real timing phases when available. */
export function PerformancePanel({ requests, limits, onNavigate }: Props) {
  const [view, setView] = useState<View>('slow');
  const [expanded, setExpanded] = useState(false);
  const limit = expanded ? LONG : SHORT;
  const summary = useMemo(() => summarize(requests, limits.slowMs, limits.largeBytes), [requests, limits.slowMs, limits.largeBytes]);
  const rows = useMemo(() => (view === 'slow' ? slowestRequests(requests, LONG) : heaviestResources(requests, LONG)), [view, requests]);
  const shown = rows.slice(0, limit);
  const max = Math.max(1, ...shown.map((r) => (view === 'slow' ? r.duration ?? 0 : weightOf(r))));
  const t = m();

  return (
    <section className="ins-perf" aria-label={t.title}>
      <div className="ins-perf-head">
        <h3>{t.title}</h3>
        <div className="segmented" role="radiogroup" aria-label="Ranking">
          <button type="button" role="radio" aria-checked={view === 'slow'} onClick={() => setView('slow')}>
            {t.slowest}
          </button>
          <button type="button" role="radio" aria-checked={view === 'heavy'} onClick={() => setView('heavy')}>
            {t.heaviest}
          </button>
        </div>
      </div>
      <p className="ins-perf-summary">
        {t.summary(summary.finished, formatBytes(summary.transferred))}
        {summary.apiMedianMs !== undefined && t.median(formatMs(summary.apiMedianMs))}
        {' · '}
        <span className={summary.slow ? 'is-warn' : ''}>
          {t.above(summary.slow, formatMs(limits.slowMs))}
        </span>
        {' · '}
        <span className={summary.large ? 'is-warn' : ''}>
          {t.above(summary.large, formatBytes(limits.largeBytes))}
        </span>
      </p>

      {view === 'slow' && (
        <div className="perf-legend" aria-hidden="true">
          <span>
            <i className="perf-swatch ph-connection" /> {t.queue}
          </span>
          <span>
            <i className="perf-swatch ph-ttfb" /> {t.ttfb}
          </span>
          <span>
            <i className="perf-swatch ph-download" /> Download
          </span>
          <span>
            <i className="perf-swatch ph-total" /> {t.noBreakdown}
          </span>
        </div>
      )}

      {shown.length ? (
        <ol className="perf-list">
          {shown.map((r) => (
            <li key={r.id}>
              {view === 'slow' ? (
                <SlowRow entry={r} max={max} over={(r.duration ?? 0) >= limits.slowMs && !r.fromCache} onOpen={onNavigate} />
              ) : (
                <HeavyRow entry={r} max={max} over={weightOf(r) >= limits.largeBytes} onOpen={onNavigate} />
              )}
            </li>
          ))}
        </ol>
      ) : (
        <div className="muted perf-empty">{t.empty}</div>
      )}
      {rows.length > SHORT && (
        <button type="button" className="link-btn perf-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? t.less : t.upTo(Math.min(LONG, rows.length))}
        </button>
      )}
    </section>
  );
}

interface RowProps {
  entry: NetworkEntry;
  max: number;
  over: boolean;
  onOpen: (ref: EventRef) => void;
}

function SlowRow({ entry: r, max, over, onOpen }: RowProps) {
  const total = r.duration ?? 0;
  const p = phasesOf(r);
  const width = (total / max) * 100;
  // Phases are drawn in proportion to the request's own total, so the bar length stays the total duration.
  const sum = p ? p.connection + p.ttfb + p.download || 1 : 1;
  const t = m();
  const detail = p ? t.phases(formatMs(p.ttfb), formatMs(p.download), formatMs(p.connection)) : t.noPhases;
  return (
    <button type="button" className="perf-row" onClick={() => onOpen({ kind: 'request', id: r.id })} title={`${r.method} ${r.url}\n${t.total(formatMs(total))}\n${detail}`}>
      <span className="perf-name">
        <span className="ellipsis">
          {r.method !== 'GET' && `${r.method} `}
          {shortName(r.url)}
        </span>
        <span className="perf-meta">
          {r.type} · {statusLabel(r)}
          {r.fromCache && ' · cache'}
        </span>
      </span>
      <span className="perf-track">
        <span className="perf-bar" style={{ width: `${Math.max(1, width)}%` }}>
          {p ? (
            <>
              {p.connection > 0 && <span className="ph-connection" style={{ flexGrow: p.connection / sum }} />}
              <span className="ph-ttfb" style={{ flexGrow: p.ttfb / sum }} />
              {p.download > 0 && <span className="ph-download" style={{ flexGrow: p.download / sum }} />}
            </>
          ) : (
            <span className="ph-total" style={{ flexGrow: 1 }} />
          )}
        </span>
      </span>
      <span className={`perf-value${over ? ' is-over' : ''}`}>
        <span>
          {over && (
            <span className="perf-flag" aria-label={t.overLimit}>
              ▲{' '}
            </span>
          )}
          {formatMs(total)}
        </span>
        <span className="perf-sub">{p ? `TTFB ${formatMs(p.ttfb)}` : t.noPhasesShort}</span>
      </span>
    </button>
  );
}

function HeavyRow({ entry: r, max, over, onOpen }: RowProps) {
  const weight = weightOf(r);
  const transferred = r.transferSize ?? 0;
  const decoded = r.resourceSize ?? 0;
  const t = m();
  const sub = transferred ? (decoded && decoded !== transferred ? t.body(formatBytes(decoded)) : t.transferred) : t.fromCache;
  return (
    <button
      type="button"
      className="perf-row"
      onClick={() => onOpen({ kind: 'request', id: r.id })}
      title={`${r.method} ${r.url}\n${t.heavyTitle(formatBytes(transferred), decoded ? formatBytes(decoded) : '', !!r.fromCache)}`}
    >
      <span className="perf-name">
        <span className="ellipsis">{shortName(r.url)}</span>
        <span className="perf-meta">
          {r.type}
          {r.mimeType && ` · ${r.mimeType.split(';')[0]}`}
        </span>
      </span>
      <span className="perf-track">
        <span className="perf-bar" style={{ width: `${Math.max(1, (weight / max) * 100)}%` }}>
          <span className="ph-size" style={{ flexGrow: 1 }} />
        </span>
      </span>
      <span className={`perf-value${over ? ' is-over' : ''}`}>
        <span>
          {over && (
            <span className="perf-flag" aria-label={t.overLimit}>
              ▲{' '}
            </span>
          )}
          {formatBytes(weight)}
        </span>
        <span className="perf-sub">{sub}</span>
      </span>
    </button>
  );
}
