import { useMemo, useState, type ReactNode } from 'react';
import {
  compareBodies,
  diffKeyValues,
  queryParams,
  summaryRows,
  type BodyComparison,
  type DiffStatus,
  type JsonChange,
  type KeyValueDiff,
  type TextLine,
} from '../analysis/compare';
import { isSensitiveName, redactText } from '../analysis/redact';
import { defineMessages } from '../i18n';
import type { NetworkEntry } from '../shared/types';
import { bodyNoteText, formatBytes, formatMs, shortName, statusLabel } from './format';
import { IconBack, IconClose } from './Icons';
import { Section } from './Section';
import { useLocale } from './useLocale';

const m = defineMessages({
  pt: {
    status: { same: 'igual', changed: 'diferente', added: 'só em B', removed: 'só em A' } as Record<DiffStatus, string>,
    noPayload: 'Sem payload.',
    masked: (n: number) => `•••• (${n} caracteres)`,
    close: 'Fechar comparação',
    title: 'Comparação',
    onlyDiffs: 'Só diferenças',
    revealTitle: 'Mostra valores de headers, parâmetros e campos sensíveis (tokens, cookies, senhas) só nesta tela',
    reveal: 'Valores sensíveis',
    swapTitle: 'Trocar A e B',
    swap: '⇄ Inverter',
    hint: 'Clique em outra requisição da lista para trocar B.',
    summaryDiffs: (n: number) => (n === 1 ? '1 diferença no resumo.' : `${n} diferenças no resumo.`),
    summaryIdentical: 'Resumo idêntico.',
    summary: 'Resumo',
    noSummaryDiffs: 'Nenhuma diferença no resumo.',
    noHeaders: 'Nenhum header visível para estas requisições.',
    noResponseHeaders: 'Headers de resposta indisponíveis.',
    openOriginal: 'Abrir os detalhes originais',
    diffCount: (n: number) => (n === 1 ? '1 diferença' : `${n} diferenças`),
    none: 'Nenhum.',
    field: 'Campo',
    hiddenSame: (n: number) => `+ ${n} iguais ocultos`,
    allSame: (n: number) => `Todos os ${n} são iguais.`,
    identical: 'Idênticos.',
    cannotCompare: 'Não é possível comparar o conteúdo.',
    tooLarge: (a: string, b: string) => `Grandes demais para comparar em detalhe (${a} e ${b} de texto). Os conteúdos são diferentes.`,
    sameJson: 'Mesmo conteúdo JSON (só a formatação difere).',
    jsonCounts: (changed: number, added: number, removed: number) => `${changed} modificado(s) · ${added} adicionado(s) em B · ${removed} removido(s) em B`,
    truncatedList: ' · lista interrompida (muitas diferenças)',
    path: 'Caminho',
    sameLines: (n: number) => `… ${n} linha(s) iguais`,
    same: 'igual',
    legend: '− só em A · + só em B',
    truncatedLines: ' · comparação limitada às primeiras 1500 linhas',
  },
  en: {
    status: { same: 'same', changed: 'different', added: 'only in B', removed: 'only in A' },
    noPayload: 'No payload.',
    masked: (n) => `•••• (${n} characters)`,
    close: 'Close comparison',
    title: 'Comparison',
    onlyDiffs: 'Differences only',
    revealTitle: 'Shows values of sensitive headers, parameters and fields (tokens, cookies, passwords) on this screen only',
    reveal: 'Sensitive values',
    swapTitle: 'Swap A and B',
    swap: '⇄ Swap',
    hint: 'Click another request in the list to replace B.',
    summaryDiffs: (n) => (n === 1 ? '1 difference in the summary.' : `${n} differences in the summary.`),
    summaryIdentical: 'Identical summary.',
    summary: 'Summary',
    noSummaryDiffs: 'No differences in the summary.',
    noHeaders: 'No headers visible for these requests.',
    noResponseHeaders: 'Response headers unavailable.',
    openOriginal: 'Open the original details',
    diffCount: (n) => (n === 1 ? '1 difference' : `${n} differences`),
    none: 'None.',
    field: 'Field',
    hiddenSame: (n) => `+ ${n} identical hidden`,
    allSame: (n) => `All ${n} are identical.`,
    identical: 'Identical.',
    cannotCompare: 'The content cannot be compared.',
    tooLarge: (a, b) => `Too large to compare in detail (${a} and ${b} of text). The contents differ.`,
    sameJson: 'Same JSON content (only the formatting differs).',
    jsonCounts: (changed, added, removed) => `${changed} changed · ${added} added in B · ${removed} removed in B`,
    truncatedList: ' · list cut short (too many differences)',
    path: 'Path',
    sameLines: (n) => `… ${n} identical line(s)`,
    same: 'same',
    legend: '− only in A · + only in B',
    truncatedLines: ' · comparison limited to the first 1500 lines',
  },
});

const MARK: Record<DiffStatus, string> = { same: '=', changed: '~', added: '+', removed: '−' };
const diffLabel = (s: DiffStatus) => m().status[s];
/** Unchanged lines kept around each change in text diffs. */
const CONTEXT_LINES = 3;

interface Props {
  a: NetworkEntry;
  b: NetworkEntry;
  narrow: boolean;
  onClose: () => void;
  onSwap: () => void;
  /** Leaves the comparison and opens one side's details. */
  onOpen: (id: string) => void;
}

/** Side-by-side comparison of two requests. Values are compared raw; sensitive ones are masked on screen unless revealed. */
export function CompareView({ a, b, narrow, onClose, onSwap, onOpen }: Props) {
  const [onlyDiffs, setOnlyDiffs] = useState(true);
  const [reveal, setReveal] = useState(false);
  const locale = useLocale();
  const t = m();

  const summary = useMemo(() => summaryRows(a, b, { ms: (n) => formatMs(n), bytes: (n) => formatBytes(n), status: statusLabel }), [a, b, locale]);
  const query = useMemo(() => diffKeyValues(queryParams(a.url), queryParams(b.url)), [a.url, b.url]);
  const reqHeaders = useMemo(() => diffKeyValues(a.requestHeaders, b.requestHeaders), [a.requestHeaders, b.requestHeaders]);
  const resHeaders = useMemo(() => diffKeyValues(a.responseHeaders, b.responseHeaders), [a.responseHeaders, b.responseHeaders]);
  const payload = useMemo(
    () => (a.requestBody === undefined && b.requestBody === undefined ? undefined : compareBodies(a.requestBody, b.requestBody, t.noPayload, t.noPayload)),
    [a.requestBody, b.requestBody, locale],
  );
  const body = useMemo(
    () => compareBodies(a.responseBody, b.responseBody, bodyNoteText(a.responseBodyNote), bodyNoteText(b.responseBodyNote)),
    [a.responseBody, b.responseBody, a.responseBodyNote, b.responseBodyNote, locale],
  );

  /** What is shown for a value: masked when its name is sensitive, and free text passes through redaction. */
  const show = (key: string, value: string | undefined) => {
    if (value === undefined) return '—';
    if (reveal) return value;
    if (isSensitiveName(key)) return t.masked(value.length);
    return redactText(value);
  };

  const differences = summary.filter((r) => r.status !== 'same').length;

  return (
    <div className="detail cmp">
      <div className="detail-tabs cmp-bar">
        <button type="button" className="fdt-icon-btn" onClick={onClose} title={t.close}>
          {narrow ? <IconBack /> : <IconClose />}
        </button>
        <span className="cmp-title">{t.title}</span>
        <label className="check">
          <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} /> {t.onlyDiffs}
        </label>
        <label className="check" title={t.revealTitle}>
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> {t.reveal}
        </label>
        <button type="button" className="link-btn cmp-swap" onClick={onSwap} title={t.swapTitle}>
          {t.swap}
        </button>
      </div>
      <div className="detail-body">
        <div className="cmp-sides">
          <Side label="A" entry={a} onOpen={onOpen} />
          <Side label="B" entry={b} onOpen={onOpen} />
        </div>
        <p className="muted cmp-hint">
          {t.hint} {differences ? t.summaryDiffs(differences) : t.summaryIdentical}
        </p>

        <Section title={t.summary}>
          <DiffTable
            rows={summary.map((r) => ({
              key: r.label,
              a: r.a,
              b: r.delta ? `${r.b}  (${formatDelta(r.delta)})` : r.b,
              status: r.status,
            }))}
            onlyDiffs={onlyDiffs}
            show={(_k, v) => v ?? '—'}
            emptyText={t.noSummaryDiffs}
          />
        </Section>
        {query.length > 0 && (
          <Section title={`Query string${countLabel(query)}`}>
            <DiffTable rows={query} onlyDiffs={onlyDiffs} show={show} />
          </Section>
        )}
        <Section title={`Request headers${countLabel(reqHeaders)}`}>
          <DiffTable rows={reqHeaders} onlyDiffs={onlyDiffs} show={show} emptyText={t.noHeaders} />
        </Section>
        <Section title={`Response headers${countLabel(resHeaders)}`}>
          <DiffTable rows={resHeaders} onlyDiffs={onlyDiffs} show={show} emptyText={t.noResponseHeaders} />
        </Section>
        {payload && (
          <Section title="Request payload">
            <BodyDiff result={payload} reveal={reveal} />
          </Section>
        )}
        <Section title="Response body">
          <BodyDiff result={body} reveal={reveal} />
        </Section>
      </div>
    </div>
  );
}

function Side({ label, entry, onOpen }: { label: string; entry: NetworkEntry; onOpen: (id: string) => void }) {
  return (
    <button type="button" className="cmp-side" onClick={() => onOpen(entry.id)} title={`${entry.url}\n${m().openOriginal}`}>
      <span className="cmp-side-label">{label}</span>
      <span className="ellipsis">
        {entry.method} {shortName(entry.url)}
      </span>
      <span className="cmp-side-status">{statusLabel(entry)}</span>
    </button>
  );
}

const countLabel = (rows: KeyValueDiff[]) => {
  const n = rows.filter((r) => r.status !== 'same').length;
  return n ? ` · ${m().diffCount(n)}` : '';
};

function formatDelta(d: { value: number; ratio?: number; unit: 'ms' | 'bytes' }) {
  const sign = d.value > 0 ? '+' : '−';
  const abs = Math.abs(d.value);
  const value = d.unit === 'ms' ? formatMs(abs) : formatBytes(abs);
  return `${sign}${value}${d.ratio !== undefined && Number.isFinite(d.ratio) ? `, ${sign}${Math.round(Math.abs(d.ratio) * 100)}%` : ''}`;
}

interface DiffTableProps {
  rows: KeyValueDiff[];
  onlyDiffs: boolean;
  show: (key: string, value: string | undefined) => string;
  emptyText?: string;
}

function DiffTable({ rows, onlyDiffs, show, emptyText = m().none }: DiffTableProps) {
  const visible = onlyDiffs ? rows.filter((r) => r.status !== 'same') : rows;
  const hidden = rows.length - visible.length;
  if (!rows.length) return <div className="muted">{emptyText}</div>;
  return (
    <>
      {visible.length > 0 && (
        <div className="cmp-table" role="table">
          <div className="cmp-row cmp-head" role="row">
            <span />
            <span>{m().field}</span>
            <span>A</span>
            <span>B</span>
          </div>
          {visible.map((r) => (
            <div key={r.key} className={`cmp-row is-${r.status}`} role="row">
              <span className="cmp-mark" title={diffLabel(r.status)} aria-label={diffLabel(r.status)}>
                {MARK[r.status]}
              </span>
              <span className="cmp-key">{r.key}</span>
              <span className="cmp-a">{show(r.key, r.a)}</span>
              <span className="cmp-b">{show(r.key, r.b)}</span>
            </div>
          ))}
        </div>
      )}
      {hidden > 0 && <div className="muted cmp-hidden">{visible.length ? m().hiddenSame(hidden) : m().allSame(hidden)}</div>}
    </>
  );
}

function BodyDiff({ result, reveal }: { result: BodyComparison; reveal: boolean }) {
  const t = m();
  switch (result.kind) {
    case 'identical':
      return <div className="muted">{t.identical}</div>;
    case 'unavailable':
      return (
        <div className="muted">
          {result.a && <div>A: {result.a}</div>}
          {result.b && <div>B: {result.b}</div>}
          {t.cannotCompare}
        </div>
      );
    case 'too-large':
      return <div className="muted">{t.tooLarge(formatBytes(result.sizeA), formatBytes(result.sizeB))}</div>;
    case 'json':
      return <JsonChanges changes={result.diff.changes} truncated={result.diff.truncated} reveal={reveal} />;
    case 'text':
      return <TextChanges lines={result.diff.lines} truncated={result.diff.truncated} reveal={reveal} />;
  }
}

const preview = (v: unknown) => {
  if (v === undefined) return '—';
  const s = JSON.stringify(v) ?? String(v);
  return s.length > 200 ? `${s.slice(0, 200)}…` : s;
};

function JsonChanges({ changes, truncated, reveal }: { changes: JsonChange[]; truncated: boolean; reveal: boolean }) {
  const t = m();
  if (!changes.length) return <div className="muted">{t.sameJson}</div>;
  const value = (c: JsonChange, v: unknown) => {
    if (v === undefined) return '—';
    if (!reveal && c.key && isSensitiveName(c.key) && typeof v !== 'object') return '••••';
    return reveal ? preview(v) : redactText(preview(v));
  };
  const counts = { added: 0, removed: 0, changed: 0 };
  for (const c of changes) counts[c.kind]++;
  return (
    <>
      <div className="muted cmp-json-summary">
        {t.jsonCounts(counts.changed, counts.added, counts.removed)}
        {truncated && t.truncatedList}
      </div>
      <div className="cmp-table cmp-json" role="table">
        <div className="cmp-row cmp-head" role="row">
          <span />
          <span>{t.path}</span>
          <span>A</span>
          <span>B</span>
        </div>
        {changes.map((c) => {
          const status: DiffStatus = c.kind;
          return (
            <div key={c.path} className={`cmp-row is-${status}`} role="row">
              <span className="cmp-mark" title={diffLabel(status)} aria-label={diffLabel(status)}>
                {MARK[status]}
              </span>
              <span className="cmp-key">{c.path}</span>
              <span className="cmp-a">{value(c, c.before)}</span>
              <span className="cmp-b">{value(c, c.after)}</span>
            </div>
          );
        })}
      </div>
    </>
  );
}

/** Line diff with long unchanged runs collapsed. */
function TextChanges({ lines, truncated, reveal }: { lines: TextLine[]; truncated: boolean; reveal: boolean }) {
  const t = m();
  const out: ReactNode[] = [];
  const near = (i: number) => {
    for (let k = Math.max(0, i - CONTEXT_LINES); k <= Math.min(lines.length - 1, i + CONTEXT_LINES); k++) if (lines[k].op !== 'same') return true;
    return false;
  };
  let skipped = 0;
  lines.forEach((l, i) => {
    if (l.op === 'same' && !near(i)) {
      skipped++;
      return;
    }
    if (skipped) {
      out.push(
        <div key={`s${i}`} className="cmp-line is-skip">
          {t.sameLines(skipped)}
        </div>,
      );
      skipped = 0;
    }
    const text = reveal ? l.text : redactText(l.text);
    out.push(
      <div key={i} className={`cmp-line is-${l.op}`}>
        <span className="cmp-line-op" aria-label={l.op === 'add' ? t.status.added : l.op === 'del' ? t.status.removed : t.same}>
          {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
        </span>
        {text || ' '}
      </div>,
    );
  });
  if (skipped)
    out.push(
      <div key="end" className="cmp-line is-skip">
        {t.sameLines(skipped)}
      </div>,
    );
  return (
    <>
      <div className="muted cmp-json-summary">
        {t.legend}
        {truncated && t.truncatedLines}
      </div>
      <pre className="code-block cmp-text">{out}</pre>
    </>
  );
}
