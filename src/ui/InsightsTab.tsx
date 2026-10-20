import { memo, useCallback, useMemo, useState } from 'react';
import { relatedLogs, relatedRequests, type Correlation } from '../analysis/correlate';
import { CATEGORIES, SEVERITIES, severityRank, type Category, type Diagnostic, type EventRef, type InsightsConfig, type Severity } from '../analysis/diagnostics/types';
import { summarize } from '../analysis/performance';
import type { DevtoolsStore, Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { CorrelationList, logLabel, requestLabel, type EventLabel } from './Correlations';
import type { FocusTarget } from './focusContext';
import { formatClock, formatMs, isErrorEntry } from './format';
import { IconAssistant, IconChevron } from './Icons';
import { defineMessages } from '../i18n';
import { categoryLabel, severityLabel } from './labels';
import { PerformancePanel } from './PerformancePanel';
import { ReportView } from './ReportView';
import { useLocale } from './useLocale';

const m = defineMessages({
  pt: {
    relevant: 'Relevantes',
    allSeverities: 'Todas as severidades',
    filter: 'Filtrar diagnósticos',
    category: 'Categoria',
    allCategories: 'Todas as categorias',
    severity: 'Severidade',
    sort: 'Ordenar',
    relevance: 'Relevância',
    recent: 'Mais recentes',
    reportTitle: 'Gerar um relatório de bug revisável com os problemas encontrados',
    report: 'Relatório',
    requests: 'Requisições',
    failed: (n: number) => `${n} com falha`,
    errors: 'Erros',
    warnings: 'Avisos',
    diagnostics: 'Diagnósticos',
    slow: 'Lentas',
    count: (n: number) => (n === 1 ? '1 diagnóstico' : `${n} diagnósticos`),
    showDismissed: (n: number) => `Mostrar dispensados (${n})`,
    none: 'Nenhum problema identificado até agora. Os diagnósticos aparecem aqui conforme a página gera erros e requisições.',
    allDismissed: 'Todos os diagnósticos foram dispensados.',
    noMatch: 'Nenhum diagnóstico corresponde ao filtro.',
    footnote: 'Diagnósticos gerados localmente, sem IA, a partir do que foi capturado nesta página. Evidências são fatos observados; causas são hipóteses a confirmar.',
    distribution: 'Distribuição por severidade',
    filterBySeverity: 'Filtrar por severidade',
    removeFilter: 'Remover filtro',
    onlySeverity: (label: string) => `Mostrar só severidade ${label.toLowerCase()}`,
    occurrences: (n: number) => (n === 1 ? '1 ocorrência' : `${n} ocorrências`),
    evidence: 'Evidências',
    evidenceHint: 'observado nos dados capturados',
    causes: 'Possíveis causas',
    causesHint: 'hipóteses, não confirmadas',
    impact: 'Impacto potencial',
    recommendations: 'Recomendações',
    relatedEvents: 'Eventos relacionados',
    shownOf: (shown: number, total: number) => `${shown} de ${total}`,
    openIn: (tab: string) => `Abrir na aba ${tab}`,
    gone: 'O evento não está mais retido',
    relatedRequests: 'Requisições possivelmente relacionadas',
    relatedLogs: 'Logs possivelmente relacionados',
    relatedHint: 'à ocorrência mais recente, com o grau de confiança',
    meta: (count: string, first: string, last: string) => `${count} · primeira ${first} · última ${last}`,
    askTitle: 'Abre o Assistant focado neste diagnóstico e nos eventos relacionados. Nada é enviado até você escolher uma pergunta.',
    ask: 'Investigar com IA',
    reportOneTitle: 'Relatório de bug com este diagnóstico e os eventos dele',
    restore: 'Restaurar',
    dismiss: 'Dispensar',
  },
  en: {
    relevant: 'Relevant',
    allSeverities: 'All severities',
    filter: 'Filter diagnostics',
    category: 'Category',
    allCategories: 'All categories',
    severity: 'Severity',
    sort: 'Sort',
    relevance: 'Relevance',
    recent: 'Most recent',
    reportTitle: 'Generate a reviewable bug report with the problems found',
    report: 'Report',
    requests: 'Requests',
    failed: (n) => `${n} failed`,
    errors: 'Errors',
    warnings: 'Warnings',
    diagnostics: 'Diagnostics',
    slow: 'Slow',
    count: (n) => (n === 1 ? '1 diagnostic' : `${n} diagnostics`),
    showDismissed: (n) => `Show dismissed (${n})`,
    none: 'No problems found so far. Diagnostics show up here as the page produces errors and requests.',
    allDismissed: 'All diagnostics were dismissed.',
    noMatch: 'No diagnostic matches the filter.',
    footnote: 'Diagnostics generated locally, without AI, from what was captured on this page. Evidence is observed fact; causes are hypotheses to confirm.',
    distribution: 'Distribution by severity',
    filterBySeverity: 'Filter by severity',
    removeFilter: 'Remove filter',
    onlySeverity: (label) => `Show only ${label.toLowerCase()} severity`,
    occurrences: (n) => (n === 1 ? '1 occurrence' : `${n} occurrences`),
    evidence: 'Evidence',
    evidenceHint: 'observed in the captured data',
    causes: 'Possible causes',
    causesHint: 'hypotheses, not confirmed',
    impact: 'Potential impact',
    recommendations: 'Recommendations',
    relatedEvents: 'Related events',
    shownOf: (shown, total) => `${shown} of ${total}`,
    openIn: (tab) => `Open in the ${tab} tab`,
    gone: 'The event is no longer retained',
    relatedRequests: 'Possibly related requests',
    relatedLogs: 'Possibly related logs',
    relatedHint: 'to the latest occurrence, with the confidence level',
    meta: (count, first, last) => `${count} · first ${first} · last ${last}`,
    askTitle: 'Opens the Assistant focused on this diagnostic and its related events. Nothing is sent until you pick a question.',
    ask: 'Investigate with AI',
    reportOneTitle: 'Bug report with this diagnostic and its events',
    restore: 'Restore',
    dismiss: 'Dismiss',
  },
});

const SEVERITY_FILTERS: { key: string; label: () => string; match: (s: Severity) => boolean }[] = [
  { key: 'relevant', label: () => m().relevant, match: (s) => s !== 'info' },
  ...SEVERITIES.map((s) => ({ key: s, label: () => severityLabel(s), match: (x: Severity) => x === s })),
  { key: 'all', label: () => m().allSeverities, match: () => true },
];

type Sort = 'relevance' | 'time';
const SORTERS: Record<Sort, (a: Diagnostic, b: Diagnostic) => number> = {
  relevance: (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count || b.lastTime - a.lastTime,
  time: (a, b) => b.lastTime - a.lastTime,
};

/** Diagnostics counted in the tab badge: not dismissed, not informational. */
export const notableDiagnostics = (snap: Snapshot) => snap.diagnostics.filter((d) => d.severity !== 'info' && !snap.dismissed.has(d.id));

interface Related extends EventLabel {
  ref: EventRef;
}

/** What an expanded diagnostic shows besides its own text (computed only while expanded). */
interface Details {
  related: Related[];
  /** Events of the other kind possibly linked to the latest occurrence (requests for a log, logs for a request). */
  correlations: Correlation[];
  label: (ref: EventRef) => EventLabel;
}

interface Props {
  store: DevtoolsStore;
  snap: Snapshot;
  limits: InsightsConfig;
  onNavigate: (ref: EventRef) => void;
  onInvestigate: (target: FocusTarget) => void;
}

export function InsightsTab({ store, snap, limits, onNavigate, onInvestigate }: Props) {
  const { slowMs } = limits;
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('relevant');
  const [sort, setSort] = useState<Sort>('relevance');
  const [showDismissed, setShowDismissed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  /** Report editor: `ids` set when opened from one diagnostic. */
  const [report, setReport] = useState<{ ids?: string[] } | null>(null);

  const { diagnostics, dismissed, requests } = snap;
  const active = useMemo(() => diagnostics.filter((d) => !dismissed.has(d.id)), [diagnostics, dismissed]);
  const dismissedCount = diagnostics.length - active.length;

  const stats = useMemo(() => {
    let failed = 0;
    for (const r of requests) if (isErrorEntry(r)) failed++;
    const { slow } = summarize(requests, limits.slowMs, limits.largeBytes);
    const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
    for (const d of active) bySeverity[d.severity]++;
    return { failed, slow, bySeverity };
  }, [requests, active, limits.slowMs, limits.largeBytes]);

  const visible = useMemo(() => {
    const sev = (SEVERITY_FILTERS.find((f) => f.key === severity) ?? SEVERITY_FILTERS[0]).match;
    const q = query.trim().toLowerCase();
    return (showDismissed ? diagnostics : active)
      .filter(
        (d) =>
          sev(d.severity) &&
          (category === 'all' || d.category === category) &&
          (!q || d.title.toLowerCase().includes(q) || d.description.toLowerCase().includes(q) || d.evidence.some((e) => e.toLowerCase().includes(q))),
      )
      .sort(SORTERS[sort]);
  }, [diagnostics, active, showDismissed, severity, category, query, sort]);

  // Labels for related events, built only while some diagnostic is expanded.
  const anyOpen = open.size > 0;
  const lookup = useMemo(() => {
    if (!anyOpen) return null;
    return {
      requests: new Map<string, NetworkEntry>(snap.requests.map((r) => [r.id, r])),
      logs: new Map<string, ConsoleEntry>(snap.logs.map((l) => [l.id, l])),
    };
  }, [anyOpen, snap.requests, snap.logs]);

  const detailsOf = (d: Diagnostic): Details | undefined => {
    if (!lookup || !open.has(d.id)) return undefined;
    const label = (ref: EventRef) => (ref.kind === 'request' ? requestLabel(lookup.requests.get(ref.id)) : logLabel(lookup.logs.get(ref.id)));
    const latest = d.related[0];
    let correlations: Correlation[] = [];
    if (latest?.kind === 'log') {
      const l = lookup.logs.get(latest.id);
      if (l) correlations = relatedRequests(l, snap.requests, location.origin);
    } else if (latest?.kind === 'request') {
      const r = lookup.requests.get(latest.id);
      if (r) correlations = relatedLogs(r, snap.logs, location.origin);
    }
    return { related: d.related.slice(0, 12).map((ref) => ({ ref, ...label(ref) })), correlations, label };
  };

  const toggle = useCallback(
    (id: string) =>
      setOpen((prev) => {
        const next = new Set(prev);
        if (!next.delete(id)) next.add(id);
        return next;
      }),
    [],
  );
  const dismiss = useCallback((id: string, value: boolean) => store.setDismissed(id, value), [store]);
  const ask = useCallback((d: Diagnostic) => onInvestigate({ kind: 'diagnostic', id: d.id }), [onInvestigate]);
  const reportOne = useCallback((d: Diagnostic) => setReport({ ids: [d.id] }), []);

  const t = m();
  if (report) return <ReportView store={store} initialIds={report.ids} onClose={() => setReport(null)} />;

  return (
    <div className="ins">
      <div className="toolbar">
        <input className="fdt-input" placeholder={t.filter} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <select className={`fdt-select${category !== 'all' ? ' is-set' : ''}`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label={t.category}>
          <option value="all">{t.allCategories}</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {categoryLabel(c)}
            </option>
          ))}
        </select>
        <select className={`fdt-select${severity !== 'relevant' ? ' is-set' : ''}`} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label={t.severity}>
          {SEVERITY_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label()}
            </option>
          ))}
        </select>
        <select className="fdt-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={t.sort}>
          <option value="relevance">{t.relevance}</option>
          <option value="time">{t.recent}</option>
        </select>
        <button type="button" className="provider-btn ins-report-btn" onClick={() => setReport({})} title={t.reportTitle}>
          {t.report}
        </button>
      </div>

      <div className="ins-scroll">
        <div className="ins-stats">
          <Stat label={t.requests} value={requests.length} note={stats.failed ? t.failed(stats.failed) : undefined} noteTone="error" />
          <Stat label={t.errors} value={snap.errors} tone={snap.errors ? 'error' : undefined} />
          <Stat label={t.warnings} value={snap.warnings} tone={snap.warnings ? 'warn' : undefined} />
          <Stat label={t.diagnostics} value={active.length} />
          <Stat label={t.slow} value={stats.slow} note={`> ${formatMs(slowMs)}`} />
        </div>
        <SeverityBar counts={stats.bySeverity} selected={severity} onSelect={setSeverity} />
        <PerformancePanel requests={requests} limits={limits} onNavigate={onNavigate} />

        <div className="ins-list-head">
          <span>{t.count(visible.length)}</span>
          {dismissedCount > 0 && (
            <label className="check">
              <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> {t.showDismissed(dismissedCount)}
            </label>
          )}
        </div>
        <div className="ins-list">
          {visible.map((d) => (
            <DiagnosticItem
              key={d.id}
              diagnostic={d}
              dismissed={dismissed.has(d.id)}
              open={open.has(d.id)}
              details={detailsOf(d)}
              onToggle={toggle}
              onDismiss={dismiss}
              onNavigate={onNavigate}
              onAsk={ask}
              onReport={reportOne}
            />
          ))}
          {!visible.length && (
            <div className="empty">
              {!diagnostics.length ? t.none : !active.length && !showDismissed ? t.allDismissed : t.noMatch}
            </div>
          )}
        </div>
        <p className="ins-footnote">{t.footnote}</p>
      </div>
    </div>
  );
}

function Stat({ label, value, tone, note, noteTone }: { label: string; value: number; tone?: 'error' | 'warn'; note?: string; noteTone?: 'error' }) {
  return (
    <div className={`ins-stat${tone ? ` is-${tone}` : ''}`}>
      <span className="ins-stat-value">{value}</span>
      <span className="ins-stat-label">{label}</span>
      {note && <span className={`ins-stat-note${noteTone ? ` is-${noteTone}` : ''}`}>{note}</span>}
    </div>
  );
}

/** Share of each severity among active diagnostics. Legend items double as severity filters. */
function SeverityBar({ counts, selected, onSelect }: { counts: Record<Severity, number>; selected: string; onSelect: (s: string) => void }) {
  const total = SEVERITIES.reduce((n, s) => n + counts[s], 0);
  const t = m();
  return (
    <div className="ins-sev-dist" aria-label={t.distribution}>
      <div className="ins-sev-bar" role="img" aria-label={SEVERITIES.map((s) => `${severityLabel(s)}: ${counts[s]}`).join(', ')}>
        {total ? (
          SEVERITIES.filter((s) => counts[s]).map((s) => (
            <span key={s} className={`ins-sev-seg sev-${s}`} style={{ flexGrow: counts[s] }} title={`${severityLabel(s)}: ${counts[s]}`} />
          ))
        ) : (
          <span className="ins-sev-seg is-empty" />
        )}
      </div>
      <div className="ins-sev-legend" role="radiogroup" aria-label={t.filterBySeverity}>
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected === s}
            className="ins-sev-key"
            onClick={() => onSelect(selected === s ? 'relevant' : s)}
            title={selected === s ? t.removeFilter : t.onlySeverity(severityLabel(s))}
          >
            <span className={`ins-swatch sev-${s}`} />
            {severityLabel(s)} <b>{counts[s]}</b>
          </button>
        ))}
      </div>
    </div>
  );
}

interface ItemProps {
  diagnostic: Diagnostic;
  dismissed: boolean;
  open: boolean;
  details?: Details;
  onToggle: (id: string) => void;
  onDismiss: (id: string, value: boolean) => void;
  onNavigate: (ref: EventRef) => void;
  onAsk: (d: Diagnostic) => void;
  onReport: (d: Diagnostic) => void;
}

const DiagnosticItem = memo(function DiagnosticItem({ diagnostic: d, dismissed, open, details, onToggle, onDismiss, onNavigate, onAsk, onReport }: ItemProps) {
  useLocale();
  const t = m();
  return (
    <div className={`ins-item${open ? ' is-open' : ''}${dismissed ? ' is-dismissed' : ''}`}>
      <button type="button" className="ins-head" aria-expanded={open} onClick={() => onToggle(d.id)}>
        <IconChevron open={open} />
        <span className={`ins-sev sev-${d.severity}`}>{severityLabel(d.severity)}</span>
        <span className="ins-title">{d.title}</span>
        {d.count > 1 && (
          <span className="fdt-count" title={t.occurrences(d.count)}>
            {d.count}×
          </span>
        )}
        <span className="ins-cat">{categoryLabel(d.category)}</span>
        <span className="ins-time">{formatClock(d.lastTime)}</span>
      </button>
      {!open && <div className="ins-summary">{d.description}</div>}
      {open && (
        <div className="ins-body">
          <p className="ins-desc">{d.description}</p>
          <Block title={t.evidence} hint={t.evidenceHint} items={d.evidence} />
          <Block title={t.causes} hint={t.causesHint} items={d.causes} />
          <h4>{t.impact}</h4>
          <p>{d.impact}</p>
          <Block title={t.recommendations} items={d.recommendations} />
          {details && details.related.length > 0 && (
            <>
              <h4>
                {t.relatedEvents}{' '}
                <span className="ins-hint">{d.related.length > details.related.length ? t.shownOf(details.related.length, d.related.length) : details.related.length}</span>
              </h4>
              <ul className="ins-related">
                {details.related.map((r) => (
                  <li key={`${r.ref.kind}:${r.ref.id}`}>
                    <button
                      type="button"
                      className={`ins-related-btn${r.error ? ' is-error' : ''}`}
                      disabled={!r.available}
                      onClick={() => onNavigate(r.ref)}
                      title={r.available ? t.openIn(r.ref.kind === 'request' ? 'Network' : 'Console') : t.gone}
                    >
                      <span className="ins-related-kind">{r.ref.kind === 'request' ? 'NET' : 'LOG'}</span>
                      <span className="ellipsis">{r.text}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {details && (
            <>
              <h4>
                {d.related[0]?.kind === 'log' ? t.relatedRequests : t.relatedLogs} <span className="ins-hint">{t.relatedHint}</span>
              </h4>
              <CorrelationList items={details.correlations} label={details.label} onOpen={onNavigate} />
            </>
          )}
          <p className="ins-meta">
            {t.meta(t.occurrences(d.count), formatClock(d.firstTime), formatClock(d.lastTime))}
          </p>
          <div className="ins-actions">
            <button type="button" className="provider-btn is-primary" onClick={() => onAsk(d)} title={t.askTitle}>
              <IconAssistant size={13} /> {t.ask}
            </button>
            <button type="button" className="provider-btn" onClick={() => onReport(d)} title={t.reportOneTitle}>
              {t.report}
            </button>
            <button type="button" className="provider-btn" onClick={() => onDismiss(d.id, !dismissed)}>
              {dismissed ? t.restore : t.dismiss}
            </button>
          </div>
        </div>
      )}
    </div>
  );
});

function Block({ title, hint, items }: { title: string; hint?: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <>
      <h4>
        {title} {hint && <span className="ins-hint">{hint}</span>}
      </h4>
      <ul>
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </>
  );
}
