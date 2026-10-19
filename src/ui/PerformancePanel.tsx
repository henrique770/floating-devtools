import { useMemo, useState } from 'react';
import type { EventRef, InsightsConfig } from '../analysis/diagnostics/types';
import { heaviestResources, phasesOf, slowestRequests, summarize, weightOf } from '../analysis/performance';
import type { NetworkEntry } from '../shared/types';
import { formatBytes, formatMs, shortName, statusLabel } from './format';

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

  return (
    <section className="ins-perf" aria-label="Performance de rede">
      <div className="ins-perf-head">
        <h3>Performance de rede</h3>
        <div className="segmented" role="radiogroup" aria-label="Ranking">
          <button type="button" role="radio" aria-checked={view === 'slow'} onClick={() => setView('slow')}>
            Mais lentas
          </button>
          <button type="button" role="radio" aria-checked={view === 'heavy'} onClick={() => setView('heavy')}>
            Mais pesadas
          </button>
        </div>
      </div>
      <p className="ins-perf-summary">
        {summary.finished} concluídas · {formatBytes(summary.transferred)} transferidos
        {summary.apiMedianMs !== undefined && ` · mediana das chamadas de API: ${formatMs(summary.apiMedianMs)}`}
        {' · '}
        <span className={summary.slow ? 'is-warn' : ''}>
          {summary.slow} acima de {formatMs(limits.slowMs)}
        </span>
        {' · '}
        <span className={summary.large ? 'is-warn' : ''}>
          {summary.large} acima de {formatBytes(limits.largeBytes)}
        </span>
      </p>

      {view === 'slow' && (
        <div className="perf-legend" aria-hidden="true">
          <span>
            <i className="perf-swatch ph-connection" /> Fila/conexão
          </span>
          <span>
            <i className="perf-swatch ph-ttfb" /> Espera do servidor (TTFB)
          </span>
          <span>
            <i className="perf-swatch ph-download" /> Download
          </span>
          <span>
            <i className="perf-swatch ph-total" /> Sem detalhamento
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
        <div className="muted perf-empty">Nenhuma requisição concluída ainda.</div>
      )}
      {rows.length > SHORT && (
        <button type="button" className="link-btn perf-more" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Mostrar menos' : `Mostrar até ${Math.min(LONG, rows.length)}`}
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
  const detail = p
    ? `TTFB ${formatMs(p.ttfb)} · download ${formatMs(p.download)} · fila/conexão ${formatMs(p.connection)}`
    : 'Sem fases: recurso de outra origem sem Timing-Allow-Origin, ou dado indisponível';
  return (
    <button type="button" className="perf-row" onClick={() => onOpen({ kind: 'request', id: r.id })} title={`${r.method} ${r.url}\nDuração total ${formatMs(total)}\n${detail}`}>
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
            <span className="perf-flag" aria-label="acima do limite">
              ▲{' '}
            </span>
          )}
          {formatMs(total)}
        </span>
        <span className="perf-sub">{p ? `TTFB ${formatMs(p.ttfb)}` : 'sem fases'}</span>
      </span>
    </button>
  );
}

function HeavyRow({ entry: r, max, over, onOpen }: RowProps) {
  const weight = weightOf(r);
  const transferred = r.transferSize ?? 0;
  const decoded = r.resourceSize ?? 0;
  const sub = transferred ? (decoded && decoded !== transferred ? `corpo ${formatBytes(decoded)}` : 'transferido') : 'do cache';
  return (
    <button
      type="button"
      className="perf-row"
      onClick={() => onOpen({ kind: 'request', id: r.id })}
      title={`${r.method} ${r.url}\nTransferido: ${formatBytes(transferred)}${decoded ? ` · corpo descomprimido: ${formatBytes(decoded)}` : ''}${r.fromCache ? ' · servido do cache' : ''}`}
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
            <span className="perf-flag" aria-label="acima do limite">
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
