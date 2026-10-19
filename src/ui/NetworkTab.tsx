import { Fragment, memo, useEffect, useMemo, useRef, useState } from 'react';
import { relatedLogs } from '../analysis/correlate';
import type { EventRef } from '../analysis/diagnostics/types';
import type { DevtoolsStore } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { CorrelationList, logLabel } from './Correlations';
import {
  copyText,
  formatBytes,
  formatClock,
  formatMs,
  hostOf,
  isErrorEntry,
  nameOf,
  sizeLabel,
  statusLabel,
  toCurl,
  tryParseJson,
  TYPE_FILTERS,
  typeLabel,
} from './format';
import { IconBack, IconClear, IconClose, IconCopy, IconRecord } from './Icons';
import { JsonTree } from './ValueView';

type SortKey = 'start' | 'name' | 'status' | 'type' | 'size' | 'time';

const COLUMNS: { key: SortKey; label: string; className: string }[] = [
  { key: 'name', label: 'Name', className: 'c-name' },
  { key: 'status', label: 'Status', className: 'c-status' },
  { key: 'type', label: 'Type', className: 'c-type' },
  { key: 'size', label: 'Size', className: 'c-size' },
  { key: 'time', label: 'Time', className: 'c-time' },
];

const sorters: Record<SortKey, (a: NetworkEntry, b: NetworkEntry) => number> = {
  start: (a, b) => a.startTime - b.startTime,
  name: (a, b) => nameOf(a.url).localeCompare(nameOf(b.url)),
  status: (a, b) => a.status - b.status,
  type: (a, b) => typeLabel(a).localeCompare(typeLabel(b)),
  size: (a, b) => (a.transferSize || a.resourceSize || 0) - (b.transferSize || b.resourceSize || 0),
  time: (a, b) => (a.duration ?? 0) - (b.duration ?? 0),
};

interface Props {
  store: DevtoolsStore;
  requests: NetworkEntry[];
  recording: boolean;
  width: number;
  /** Request to reveal (navigation from Insights); the nonce makes repeated clicks re-trigger. */
  focus?: { id: string; nonce: number };
  logs: ConsoleEntry[];
  onNavigate: (ref: EventRef) => void;
}

export function NetworkTab({ store, requests, recording, width, focus, logs, onNavigate }: Props) {
  const [query, setQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'start', dir: 1 });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const rowsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!focus) return;
    // Clear the filters so the request is guaranteed to be in the list, then select it.
    setQuery('');
    setTypeFilter('all');
    setErrorsOnly(false);
    setSelectedId(focus.id);
    requestAnimationFrame(() => rowsRef.current?.querySelector(`[data-id="${CSS.escape(focus.id)}"]`)?.scrollIntoView({ block: 'nearest' }));
  }, [focus]);

  const visible = useMemo(() => {
    const filter = TYPE_FILTERS.find((f) => f.key === typeFilter) ?? TYPE_FILTERS[0];
    const q = query.trim().toLowerCase();
    const negate = q.startsWith('-');
    const needle = negate ? q.slice(1) : q;
    const list = requests.filter((r) => {
      if (!filter.match(r.type)) return false;
      if (errorsOnly && !isErrorEntry(r)) return false;
      if (!needle) return true;
      const hit = r.url.toLowerCase().includes(needle) || r.method.toLowerCase() === needle || String(r.status) === needle;
      return negate ? !hit : hit;
    });
    if (sort.key !== 'start' || sort.dir !== 1) list.sort((a, b) => sorters[sort.key](a, b) * sort.dir);
    return list;
  }, [requests, query, typeFilter, errorsOnly, sort]);

  const selected = selectedId ? requests.find((r) => r.id === selectedId) : undefined;
  const narrow = width < 600;

  const totals = useMemo(() => {
    let transferred = 0;
    let resources = 0;
    let first = Infinity;
    let last = 0;
    for (const r of visible) {
      transferred += r.transferSize ?? 0;
      resources += r.resourceSize ?? 0;
      first = Math.min(first, r.startTime);
      last = Math.max(last, r.startTime + (r.duration ?? 0));
    }
    return { transferred, resources, finish: visible.length ? last - first : 0 };
  }, [visible]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? (s.dir === 1 ? { key, dir: -1 } : { key: 'start', dir: 1 }) : { key, dir: 1 }));

  return (
    <div className="net">
      <div className="toolbar">
        <button
          type="button"
          className={`fdt-icon-btn${recording ? ' is-active' : ''}`}
          onClick={() => store.toggleRecording()}
          title={recording ? 'Parar gravação' : 'Gravar'}
        >
          <IconRecord active={recording} />
        </button>
        <button type="button" className="fdt-icon-btn" onClick={() => (store.clearNetwork(), setSelectedId(null))} title="Limpar">
          <IconClear />
        </button>
        <input
          className="fdt-input"
          placeholder="Filtrar (url, método, status; -texto inverte)"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          spellCheck={false}
        />
      </div>
      <div className="chips" role="radiogroup" aria-label="Tipo">
        {TYPE_FILTERS.map((f) => (
          <Fragment key={f.key}>
            <button type="button" role="radio" aria-checked={typeFilter === f.key} className="chip" onClick={() => setTypeFilter(f.key)}>
              {f.label}
            </button>
            {f.key === 'all' && (
              // Independent of the type chips, so it combines with them (e.g. Errors + Img).
              <button
                type="button"
                role="switch"
                aria-checked={errorsOnly}
                className="chip chip-errors"
                onClick={() => setErrorsOnly(!errorsOnly)}
                title="Só requisições com falha ou status >= 400"
              >
                Errors
              </button>
            )}
          </Fragment>
        ))}
      </div>

      <div className={`net-main${selected ? ' has-detail' : ''}${narrow ? ' is-narrow' : ''}`}>
        {(!selected || !narrow) && (
          <div className="net-table" role="table">
            <div className="net-row net-head" role="row">
              {(selected ? COLUMNS.slice(0, 1) : COLUMNS).map((c) => (
                <button type="button" key={c.key} className={`cell ${c.className}`} onClick={() => toggleSort(c.key)} role="columnheader">
                  {c.label}
                  {sort.key === c.key && <span className="sort">{sort.dir === 1 ? '▲' : '▼'}</span>}
                </button>
              ))}
            </div>
            <div className="net-rows" ref={rowsRef}>
              {visible.map((r) => (
                <Row key={r.id} entry={r} compact={!!selected} selected={r.id === selectedId} onSelect={setSelectedId} />
              ))}
              {!visible.length && (
                <div className="empty">
                  {requests.length ? 'Nenhuma requisição corresponde ao filtro.' : recording ? 'Gravando atividade de rede…' : 'Gravação pausada.'}
                </div>
              )}
            </div>
          </div>
        )}
        {selected && <Details entry={selected} narrow={narrow} logs={logs} onNavigate={onNavigate} onClose={() => setSelectedId(null)} />}
      </div>

      <footer className="statusbar">
        <span>
          {visible.length === requests.length ? `${requests.length} requests` : `${visible.length} / ${requests.length} requests`}
        </span>
        <span>{formatBytes(totals.transferred)} transferred</span>
        <span>{formatBytes(totals.resources)} resources</span>
        <span>Finish: {formatMs(totals.finish)}</span>
      </footer>
    </div>
  );
}

const Row = memo(function Row({
  entry: r,
  compact,
  selected,
  onSelect,
}: {
  entry: NetworkEntry;
  compact: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const error = isErrorEntry(r);
  return (
    <div
      role="row"
      data-id={r.id}
      className={`net-row${selected ? ' is-selected' : ''}${error ? ' is-error' : ''}${r.state === 'pending' ? ' is-pending' : ''}`}
      onClick={() => onSelect(r.id)}
      title={r.url}
    >
      <div className="cell c-name">
        <span className={`type-dot t-${r.type}`} />
        <span className="ellipsis">{nameOf(r.url)}</span>
      </div>
      {!compact && (
        <>
          <div className="cell c-status">{statusLabel(r)}</div>
          <div className="cell c-type">{typeLabel(r)}</div>
          <div className="cell c-size">{sizeLabel(r)}</div>
          <div className="cell c-time">{r.state === 'pending' ? '' : formatMs(r.duration)}</div>
        </>
      )}
    </div>
  );
});

// ------------------------------------------------------------------ details

type DetailTab = 'headers' | 'payload' | 'preview' | 'response' | 'timing' | 'related';

interface DetailsProps {
  entry: NetworkEntry;
  narrow: boolean;
  logs: ConsoleEntry[];
  onNavigate: (ref: EventRef) => void;
  onClose: () => void;
}

function Details({ entry, narrow, logs, onNavigate, onClose }: DetailsProps) {
  const [tab, setTab] = useState<DetailTab>('headers');
  const json = useMemo(() => tryParseJson(entry.responseBody), [entry.responseBody]);
  const hasPayload = !!entry.requestBody || entry.url.includes('?');
  const tabs: { key: DetailTab; label: string; show: boolean }[] = [
    { key: 'headers', label: 'Headers', show: true },
    { key: 'payload', label: 'Payload', show: hasPayload },
    { key: 'preview', label: 'Preview', show: entry.type === 'image' || json !== undefined },
    { key: 'response', label: 'Response', show: true },
    { key: 'timing', label: 'Timing', show: true },
    { key: 'related', label: 'Relacionados', show: true },
  ];
  const current = tabs.find((t) => t.key === tab && t.show) ? tab : 'headers';

  return (
    <div className="detail">
      <div className="detail-tabs">
        <button type="button" className="fdt-icon-btn" onClick={onClose} title="Fechar detalhes">
          {narrow ? <IconBack /> : <IconClose />}
        </button>
        {tabs
          .filter((t) => t.show)
          .map((t) => (
            <button key={t.key} type="button" className="detail-tab" aria-selected={current === t.key} onClick={() => setTab(t.key)}>
              {t.label}
            </button>
          ))}
      </div>
      <div className="detail-body">
        {current === 'headers' && <HeadersView entry={entry} />}
        {current === 'payload' && <PayloadView entry={entry} />}
        {current === 'preview' &&
          (entry.type === 'image' ? (
            <div className="img-preview">
              <img src={entry.url} alt="" />
            </div>
          ) : (
            <div className="code-block">
              <JsonTree data={json} />
            </div>
          ))}
        {current === 'response' && <ResponseView entry={entry} json={json} />}
        {current === 'timing' && <TimingView entry={entry} />}
        {current === 'related' && <RelatedView entry={entry} logs={logs} onNavigate={onNavigate} />}
      </div>
    </div>
  );
}

function Section({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  const [open, setOpen] = useState(true);
  return (
    <section className="section">
      <div className="section-title">
        <button type="button" onClick={() => setOpen(!open)}>
          <span className="caret">{open ? '▾' : '▸'}</span> {title}
        </button>
        {actions}
      </div>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

function KeyValues({ data }: { data: [string, string][] }) {
  if (!data.length) return <div className="muted">Nenhum</div>;
  return (
    <dl className="kv">
      {data.map(([k, v], i) => (
        <div key={`${k}${i}`} className="kv-row">
          <dt>{k}</dt>
          <dd>{v}</dd>
        </div>
      ))}
    </dl>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className="link-btn"
      onClick={() => {
        copyText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1200);
      }}
    >
      <IconCopy width={12} height={12} /> {done ? 'Copiado!' : label}
    </button>
  );
}

function HeadersView({ entry: e }: { entry: NetworkEntry }) {
  const general: [string, string][] = [
    ['Request URL', e.url],
    ['Request Method', e.method],
    ['Status Code', e.state === 'failed' ? `(failed) ${e.error ?? ''}` : `${e.status || '—'} ${e.statusText}`.trim()],
  ];
  if (e.remoteAddress) general.push(['Remote Address', e.remoteAddress]);
  if (e.fromCache) general.push(['Cache', 'Servido do cache']);
  general.push(['Iniciado em', formatClock(e.startTime)]);
  return (
    <>
      <Section title="General" actions={<CopyButton text={toCurl(e)} label="Copiar como cURL" />}>
        <KeyValues data={general} />
      </Section>
      {e.initiator && (
        <Section title="Iniciador">
          <pre className="code-block initiator">{e.initiator}</pre>
        </Section>
      )}
      <Section title="Response Headers">
        {e.responseHeaders ? (
          <KeyValues data={Object.entries(e.responseHeaders)} />
        ) : (
          <div className="muted">Não disponível (resposta opaca ou ainda pendente).</div>
        )}
      </Section>
      <Section title="Request Headers">
        {e.requestHeaders && Object.keys(e.requestHeaders).length ? (
          <KeyValues data={Object.entries(e.requestHeaders)} />
        ) : (
          <div className="muted">Somente headers definidos pela página são visíveis para este tipo de requisição.</div>
        )}
      </Section>
    </>
  );
}

function PayloadView({ entry: e }: { entry: NetworkEntry }) {
  let params: [string, string][] = [];
  try {
    params = [...new URL(e.url).searchParams.entries()];
  } catch {
    /* ignore */
  }
  const json = tryParseJson(e.requestBody);
  let form: [string, string][] | undefined;
  if (e.requestBody && json === undefined && /^[^=&\s]+=[^&]*(&[^=&\s]+=[^&]*)*$/.test(e.requestBody)) {
    form = [...new URLSearchParams(e.requestBody).entries()];
  }
  return (
    <>
      {params.length > 0 && (
        <Section title="Query String Parameters">
          <KeyValues data={params} />
        </Section>
      )}
      {e.requestBody && (
        <Section title="Request Payload" actions={<CopyButton text={e.requestBody} label="Copiar" />}>
          {json !== undefined ? (
            <div className="code-block">
              <JsonTree data={json} />
            </div>
          ) : form ? (
            <KeyValues data={form} />
          ) : (
            <pre className="code-block">{e.requestBody}</pre>
          )}
        </Section>
      )}
    </>
  );
}

function ResponseView({ entry: e, json }: { entry: NetworkEntry; json: unknown }) {
  const [pretty, setPretty] = useState(true);
  if (e.state === 'pending' && !e.responseBody) return <div className="muted pad">Aguardando resposta…</div>;
  if (!e.responseBody) {
    return (
      <div className="muted pad">
        {e.responseBodyNote ??
          (e.type === 'fetch' || e.type === 'xhr'
            ? 'Sem conteúdo.'
            : 'O corpo de recursos estáticos (imagens, CSS, JS…) não é capturado. Use “Abrir em nova aba” para vê-lo.')}
        {e.type !== 'fetch' && e.type !== 'xhr' && (
          <div style={{ marginTop: 8 }}>
            <a className="link-btn" href={e.url} target="_blank" rel="noreferrer">
              Abrir em nova aba ↗
            </a>
          </div>
        )}
      </div>
    );
  }
  const text = json !== undefined && pretty ? JSON.stringify(json, null, 2) : e.responseBody;
  return (
    <div className="response">
      <div className="response-actions">
        {json !== undefined && (
          <label className="check">
            <input type="checkbox" checked={pretty} onChange={(ev) => setPretty(ev.target.checked)} /> Formatar JSON
          </label>
        )}
        <CopyButton text={e.responseBody} label="Copiar resposta" />
      </div>
      <pre className="code-block">{text}</pre>
    </div>
  );
}

/** Console errors/warnings possibly related to this request, computed when the tab is opened. */
function RelatedView({ entry, logs, onNavigate }: { entry: NetworkEntry; logs: ConsoleEntry[]; onNavigate: (ref: EventRef) => void }) {
  const items = useMemo(() => relatedLogs(entry, logs, location.origin), [entry, logs]);
  const byId = useMemo(() => new Map(logs.map((l) => [l.id, l])), [logs]);
  return (
    <div className="pad">
      <CorrelationList
        items={items}
        label={(ref) => logLabel(byId.get(ref.id))}
        onOpen={onNavigate}
        empty="Nenhum erro ou aviso do console relacionado a esta requisição."
      />
      <p className="muted corr-note">
        Alta: o erro é o mesmo objeto gerado por esta requisição. Média: stack em comum com o iniciador, ou erro de JSON logo após uma resposta que não
        é JSON. Baixa: só proximidade no tempo, o que não comprova relação.
      </p>
    </div>
  );
}

function TimingView({ entry: e }: { entry: NetworkEntry }) {
  const t = e.timing;
  const phases: [string, number, string][] = t
    ? [
        ['Fila / Stalled', t.stalled, 'var(--t-stalled)'],
        ['DNS Lookup', t.dns, 'var(--t-dns)'],
        ['Conexão inicial', t.connect - t.ssl, 'var(--t-connect)'],
        ['SSL', t.ssl, 'var(--t-ssl)'],
        ['Aguardando servidor (TTFB)', t.waiting, 'var(--t-wait)'],
        ['Download do conteúdo', t.download, 'var(--t-download)'],
      ]
    : [];
  const total = Math.max(e.duration ?? 0, phases.reduce((s, [, v]) => s + Math.max(0, v), 0)) || 1;
  let offset = 0;
  return (
    <div className="timing pad">
      <div className="kv-row">
        <dt>Início</dt>
        <dd>{formatClock(e.startTime)}</dd>
      </div>
      <div className="kv-row">
        <dt>Duração total</dt>
        <dd>{formatMs(e.duration)}</dd>
      </div>
      {t ? (
        <div className="phases">
          {phases.map(([label, value, color]) => {
            const v = Math.max(0, value);
            const bar = (
              <div key={label} className="phase">
                <span className="phase-label">{label}</span>
                <span className="phase-track">
                  <span className="phase-bar" style={{ left: `${(offset / total) * 100}%`, width: `${Math.max(0.5, (v / total) * 100)}%`, background: color }} />
                </span>
                <span className="phase-value">{v < 1 ? `${v.toFixed(2)} ms` : formatMs(v)}</span>
              </div>
            );
            offset += v;
            return bar;
          })}
        </div>
      ) : (
        <div className="muted" style={{ marginTop: 10 }}>
          Detalhamento indisponível: recurso de outra origem sem o header <code>Timing-Allow-Origin</code>.
        </div>
      )}
      <div className="muted" style={{ marginTop: 10 }}>
        Host: {hostOf(e.url) || '—'}
      </div>
    </div>
  );
}
