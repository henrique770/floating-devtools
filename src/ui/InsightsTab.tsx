import { memo, useCallback, useMemo, useState } from 'react';
import { CATEGORIES, SEVERITIES, severityRank, type Category, type Diagnostic, type EventRef, type Severity } from '../analysis/diagnostics/types';
import { redactText } from '../analysis/redact';
import type { DevtoolsStore, Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { formatClock, formatMs, isErrorEntry, nameOf, statusLabel } from './format';
import { IconAssistant, IconChevron } from './Icons';
import { preview } from './ValueView';

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'Alta', medium: 'Média', low: 'Baixa', info: 'Info' };
export const CATEGORY_LABEL: Record<Category, string> = { javascript: 'JavaScript', network: 'Network', storage: 'Storage', performance: 'Performance' };

const SEVERITY_FILTERS: { key: string; label: string; match: (s: Severity) => boolean }[] = [
  { key: 'relevant', label: 'Relevantes', match: (s) => s !== 'info' },
  ...SEVERITIES.map((s) => ({ key: s, label: SEVERITY_LABEL[s], match: (x: Severity) => x === s })),
  { key: 'all', label: 'Todas as severidades', match: () => true },
];

type Sort = 'relevance' | 'time';
const SORTERS: Record<Sort, (a: Diagnostic, b: Diagnostic) => number> = {
  relevance: (a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count || b.lastTime - a.lastTime,
  time: (a, b) => b.lastTime - a.lastTime,
};

/** Diagnostics counted in the tab badge: not dismissed, not informational. */
export const notableDiagnostics = (snap: Snapshot) => snap.diagnostics.filter((d) => d.severity !== 'info' && !snap.dismissed.has(d.id));

interface Related {
  ref: EventRef;
  label: string;
  /** False once the event left the capture buffer (or was cleared). */
  available: boolean;
  error?: boolean;
}

interface Props {
  store: DevtoolsStore;
  snap: Snapshot;
  slowMs: number;
  onNavigate: (ref: EventRef) => void;
  onAskAi: (text: string) => void;
}

export function InsightsTab({ store, snap, slowMs, onNavigate, onAskAi }: Props) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [severity, setSeverity] = useState('relevant');
  const [sort, setSort] = useState<Sort>('relevance');
  const [showDismissed, setShowDismissed] = useState(false);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());

  const { diagnostics, dismissed, requests } = snap;
  const active = useMemo(() => diagnostics.filter((d) => !dismissed.has(d.id)), [diagnostics, dismissed]);
  const dismissedCount = diagnostics.length - active.length;

  const stats = useMemo(() => {
    let failed = 0;
    let slow = 0;
    for (const r of requests) {
      if (isErrorEntry(r)) failed++;
      if (r.state === 'done' && !r.fromCache && (r.duration ?? 0) >= slowMs) slow++;
    }
    const bySeverity: Record<Severity, number> = { high: 0, medium: 0, low: 0, info: 0 };
    for (const d of active) bySeverity[d.severity]++;
    return { failed, slow, bySeverity };
  }, [requests, active, slowMs]);

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

  const relatedOf = (d: Diagnostic): Related[] | undefined => {
    if (!lookup || !open.has(d.id)) return undefined;
    return d.related.slice(0, 12).map((ref) => {
      if (ref.kind === 'request') {
        const r = lookup.requests.get(ref.id);
        return r
          ? { ref, label: `${r.method} ${nameOf(r.url)} → ${statusLabel(r)}${r.duration !== undefined ? ` · ${formatMs(r.duration)}` : ''}`, available: true, error: isErrorEntry(r) }
          : { ref, label: 'Requisição fora do buffer', available: false };
      }
      const l = lookup.logs.get(ref.id);
      return l
        ? { ref, label: `${formatClock(l.time)} ${l.prefix ? `${l.prefix} ` : ''}${l.args.map((a) => preview(a)).join(' ')}`.slice(0, 140), available: true, error: l.level === 'error' }
        : { ref, label: 'Mensagem fora do buffer', available: false };
    });
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
  const ask = useCallback((d: Diagnostic) => onAskAi(aiPrompt(d)), [onAskAi]);

  return (
    <div className="ins">
      <div className="toolbar">
        <input className="fdt-input" placeholder="Filtrar diagnósticos" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
        <select className={`fdt-select${category !== 'all' ? ' is-set' : ''}`} value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Categoria">
          <option value="all">Todas as categorias</option>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select className={`fdt-select${severity !== 'relevant' ? ' is-set' : ''}`} value={severity} onChange={(e) => setSeverity(e.target.value)} aria-label="Severidade">
          {SEVERITY_FILTERS.map((f) => (
            <option key={f.key} value={f.key}>
              {f.label}
            </option>
          ))}
        </select>
        <select className="fdt-select" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="Ordenar">
          <option value="relevance">Relevância</option>
          <option value="time">Mais recentes</option>
        </select>
      </div>

      <div className="ins-scroll">
        <div className="ins-stats">
          <Stat label="Requisições" value={requests.length} note={stats.failed ? `${stats.failed} com falha` : undefined} noteTone="error" />
          <Stat label="Erros" value={snap.errors} tone={snap.errors ? 'error' : undefined} />
          <Stat label="Avisos" value={snap.warnings} tone={snap.warnings ? 'warn' : undefined} />
          <Stat label="Diagnósticos" value={active.length} />
          <Stat label="Lentas" value={stats.slow} note={`> ${formatMs(slowMs)}`} />
        </div>
        <SeverityBar counts={stats.bySeverity} selected={severity} onSelect={setSeverity} />

        <div className="ins-list-head">
          <span>
            {visible.length} {visible.length === 1 ? 'diagnóstico' : 'diagnósticos'}
          </span>
          {dismissedCount > 0 && (
            <label className="check">
              <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} /> Mostrar dispensados ({dismissedCount})
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
              related={relatedOf(d)}
              onToggle={toggle}
              onDismiss={dismiss}
              onNavigate={onNavigate}
              onAsk={ask}
            />
          ))}
          {!visible.length && (
            <div className="empty">
              {!diagnostics.length
                ? 'Nenhum problema identificado até agora. Os diagnósticos aparecem aqui conforme a página gera erros e requisições.'
                : !active.length && !showDismissed
                  ? 'Todos os diagnósticos foram dispensados.'
                  : 'Nenhum diagnóstico corresponde ao filtro.'}
            </div>
          )}
        </div>
        <p className="ins-footnote">
          Diagnósticos gerados localmente, sem IA, a partir do que foi capturado nesta página. Evidências são fatos observados; causas são
          hipóteses a confirmar.
        </p>
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
  return (
    <div className="ins-sev-dist" aria-label="Distribuição por severidade">
      <div className="ins-sev-bar" role="img" aria-label={SEVERITIES.map((s) => `${SEVERITY_LABEL[s]}: ${counts[s]}`).join(', ')}>
        {total ? (
          SEVERITIES.filter((s) => counts[s]).map((s) => (
            <span key={s} className={`ins-sev-seg sev-${s}`} style={{ flexGrow: counts[s] }} title={`${SEVERITY_LABEL[s]}: ${counts[s]}`} />
          ))
        ) : (
          <span className="ins-sev-seg is-empty" />
        )}
      </div>
      <div className="ins-sev-legend" role="radiogroup" aria-label="Filtrar por severidade">
        {SEVERITIES.map((s) => (
          <button
            key={s}
            type="button"
            role="radio"
            aria-checked={selected === s}
            className="ins-sev-key"
            onClick={() => onSelect(selected === s ? 'relevant' : s)}
            title={selected === s ? 'Remover filtro' : `Mostrar só severidade ${SEVERITY_LABEL[s].toLowerCase()}`}
          >
            <span className={`ins-swatch sev-${s}`} />
            {SEVERITY_LABEL[s]} <b>{counts[s]}</b>
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
  related?: Related[];
  onToggle: (id: string) => void;
  onDismiss: (id: string, value: boolean) => void;
  onNavigate: (ref: EventRef) => void;
  onAsk: (d: Diagnostic) => void;
}

const DiagnosticItem = memo(function DiagnosticItem({ diagnostic: d, dismissed, open, related, onToggle, onDismiss, onNavigate, onAsk }: ItemProps) {
  return (
    <div className={`ins-item${open ? ' is-open' : ''}${dismissed ? ' is-dismissed' : ''}`}>
      <button type="button" className="ins-head" aria-expanded={open} onClick={() => onToggle(d.id)}>
        <IconChevron open={open} />
        <span className={`ins-sev sev-${d.severity}`}>{SEVERITY_LABEL[d.severity]}</span>
        <span className="ins-title">{d.title}</span>
        {d.count > 1 && (
          <span className="fdt-count" title={`${d.count} ocorrências`}>
            {d.count}×
          </span>
        )}
        <span className="ins-cat">{CATEGORY_LABEL[d.category]}</span>
        <span className="ins-time">{formatClock(d.lastTime)}</span>
      </button>
      {!open && <div className="ins-summary">{d.description}</div>}
      {open && (
        <div className="ins-body">
          <p className="ins-desc">{d.description}</p>
          <Block title="Evidências" hint="observado nos dados capturados" items={d.evidence} />
          <Block title="Possíveis causas" hint="hipóteses, não confirmadas" items={d.causes} />
          <h4>Impacto potencial</h4>
          <p>{d.impact}</p>
          <Block title="Recomendações" items={d.recommendations} />
          {related && related.length > 0 && (
            <>
              <h4>
                Eventos relacionados <span className="ins-hint">{d.related.length > related.length ? `${related.length} de ${d.related.length}` : related.length}</span>
              </h4>
              <ul className="ins-related">
                {related.map((r) => (
                  <li key={`${r.ref.kind}:${r.ref.id}`}>
                    <button
                      type="button"
                      className={`ins-related-btn${r.error ? ' is-error' : ''}`}
                      disabled={!r.available}
                      onClick={() => onNavigate(r.ref)}
                      title={r.available ? `Abrir na aba ${r.ref.kind === 'request' ? 'Network' : 'Console'}` : 'O evento não está mais retido'}
                    >
                      <span className="ins-related-kind">{r.ref.kind === 'request' ? 'NET' : 'LOG'}</span>
                      <span className="ellipsis">{r.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          <p className="ins-meta">
            {d.count} {d.count === 1 ? 'ocorrência' : 'ocorrências'} · primeira {formatClock(d.firstTime)} · última {formatClock(d.lastTime)}
          </p>
          <div className="ins-actions">
            <button type="button" className="provider-btn is-primary" onClick={() => onAsk(d)} title="Abre o Assistant com a pergunta preenchida para você revisar antes de enviar">
              <IconAssistant size={13} /> Investigar com IA
            </button>
            <button type="button" className="provider-btn" onClick={() => onDismiss(d.id, !dismissed)}>
              {dismissed ? 'Restaurar' : 'Dispensar'}
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
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </>
  );
}

/** Question prefilled in the Assistant: the diagnostic, with facts and hypotheses kept apart, secrets masked. */
export function aiPrompt(d: Diagnostic): string {
  const list = (items: string[]) => items.map((t) => `- ${t}`).join('\n');
  return [
    `Investigue este diagnóstico do Floating DevTools: **${d.title}** (${CATEGORY_LABEL[d.category]}, severidade ${SEVERITY_LABEL[d.severity].toLowerCase()}, ${d.count} ${d.count === 1 ? 'ocorrência' : 'ocorrências'}).`,
    d.description,
    `Evidências observadas:\n${list(d.evidence)}`,
    d.causes.length ? `Hipóteses levantadas localmente (não confirmadas):\n${list(d.causes)}` : '',
    'Explique o problema, diga quais hipóteses os dados sustentam, como investigar e como corrigir.',
  ]
    .filter(Boolean)
    .map(redactText)
    .join('\n\n');
}
