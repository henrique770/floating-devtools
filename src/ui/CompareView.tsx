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
import type { NetworkEntry } from '../shared/types';
import { formatBytes, formatMs, shortName, statusLabel } from './format';
import { IconBack, IconClose } from './Icons';
import { Section } from './Section';

const MARK: Record<DiffStatus, string> = { same: '=', changed: '~', added: '+', removed: '−' };
const STATUS_LABEL: Record<DiffStatus, string> = { same: 'igual', changed: 'diferente', added: 'só em B', removed: 'só em A' };
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

  const summary = useMemo(() => summaryRows(a, b, { ms: (n) => formatMs(n), bytes: (n) => formatBytes(n), status: statusLabel }), [a, b]);
  const query = useMemo(() => diffKeyValues(queryParams(a.url), queryParams(b.url)), [a.url, b.url]);
  const reqHeaders = useMemo(() => diffKeyValues(a.requestHeaders, b.requestHeaders), [a.requestHeaders, b.requestHeaders]);
  const resHeaders = useMemo(() => diffKeyValues(a.responseHeaders, b.responseHeaders), [a.responseHeaders, b.responseHeaders]);
  const payload = useMemo(
    () => (a.requestBody === undefined && b.requestBody === undefined ? undefined : compareBodies(a.requestBody, b.requestBody, 'Sem payload.', 'Sem payload.')),
    [a.requestBody, b.requestBody],
  );
  const body = useMemo(() => compareBodies(a.responseBody, b.responseBody, a.responseBodyNote, b.responseBodyNote), [a.responseBody, b.responseBody, a.responseBodyNote, b.responseBodyNote]);

  /** What is shown for a value: masked when its name is sensitive, and free text passes through redaction. */
  const show = (key: string, value: string | undefined) => {
    if (value === undefined) return '—';
    if (reveal) return value;
    if (isSensitiveName(key)) return `•••• (${value.length} caracteres)`;
    return redactText(value);
  };

  const differences = summary.filter((r) => r.status !== 'same').length;

  return (
    <div className="detail cmp">
      <div className="detail-tabs cmp-bar">
        <button type="button" className="fdt-icon-btn" onClick={onClose} title="Fechar comparação">
          {narrow ? <IconBack /> : <IconClose />}
        </button>
        <span className="cmp-title">Comparação</span>
        <label className="check">
          <input type="checkbox" checked={onlyDiffs} onChange={(e) => setOnlyDiffs(e.target.checked)} /> Só diferenças
        </label>
        <label className="check" title="Mostra valores de headers, parâmetros e campos sensíveis (tokens, cookies, senhas) só nesta tela">
          <input type="checkbox" checked={reveal} onChange={(e) => setReveal(e.target.checked)} /> Valores sensíveis
        </label>
        <button type="button" className="link-btn cmp-swap" onClick={onSwap} title="Trocar A e B">
          ⇄ Inverter
        </button>
      </div>
      <div className="detail-body">
        <div className="cmp-sides">
          <Side label="A" entry={a} onOpen={onOpen} />
          <Side label="B" entry={b} onOpen={onOpen} />
        </div>
        <p className="muted cmp-hint">Clique em outra requisição da lista para trocar B. {differences ? `${differences} diferença(s) no resumo.` : 'Resumo idêntico.'}</p>

        <Section title="Resumo">
          <DiffTable
            rows={summary.map((r) => ({
              key: r.label,
              a: r.a,
              b: r.delta ? `${r.b}  (${formatDelta(r.delta)})` : r.b,
              status: r.status,
            }))}
            onlyDiffs={onlyDiffs}
            show={(_k, v) => v ?? '—'}
            emptyText="Nenhuma diferença no resumo."
          />
        </Section>
        {query.length > 0 && (
          <Section title={`Query string${countLabel(query)}`}>
            <DiffTable rows={query} onlyDiffs={onlyDiffs} show={show} />
          </Section>
        )}
        <Section title={`Request headers${countLabel(reqHeaders)}`}>
          <DiffTable rows={reqHeaders} onlyDiffs={onlyDiffs} show={show} emptyText="Nenhum header visível para estas requisições." />
        </Section>
        <Section title={`Response headers${countLabel(resHeaders)}`}>
          <DiffTable rows={resHeaders} onlyDiffs={onlyDiffs} show={show} emptyText="Headers de resposta indisponíveis." />
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
    <button type="button" className="cmp-side" onClick={() => onOpen(entry.id)} title={`${entry.url}\nAbrir os detalhes originais`}>
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
  return n ? ` · ${n} diferença${n > 1 ? 's' : ''}` : '';
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

function DiffTable({ rows, onlyDiffs, show, emptyText = 'Nenhum.' }: DiffTableProps) {
  const visible = onlyDiffs ? rows.filter((r) => r.status !== 'same') : rows;
  const hidden = rows.length - visible.length;
  if (!rows.length) return <div className="muted">{emptyText}</div>;
  return (
    <>
      {visible.length > 0 && (
        <div className="cmp-table" role="table">
          <div className="cmp-row cmp-head" role="row">
            <span />
            <span>Campo</span>
            <span>A</span>
            <span>B</span>
          </div>
          {visible.map((r) => (
            <div key={r.key} className={`cmp-row is-${r.status}`} role="row">
              <span className="cmp-mark" title={STATUS_LABEL[r.status]} aria-label={STATUS_LABEL[r.status]}>
                {MARK[r.status]}
              </span>
              <span className="cmp-key">{r.key}</span>
              <span className="cmp-a">{show(r.key, r.a)}</span>
              <span className="cmp-b">{show(r.key, r.b)}</span>
            </div>
          ))}
        </div>
      )}
      {hidden > 0 && <div className="muted cmp-hidden">{visible.length ? `+ ${hidden} iguais ocultos` : `Todos os ${hidden} são iguais.`}</div>}
    </>
  );
}

function BodyDiff({ result, reveal }: { result: BodyComparison; reveal: boolean }) {
  switch (result.kind) {
    case 'identical':
      return <div className="muted">Idênticos.</div>;
    case 'unavailable':
      return (
        <div className="muted">
          {result.a && <div>A: {result.a}</div>}
          {result.b && <div>B: {result.b}</div>}
          Não é possível comparar o conteúdo.
        </div>
      );
    case 'too-large':
      return (
        <div className="muted">
          Grandes demais para comparar em detalhe ({formatBytes(result.sizeA)} e {formatBytes(result.sizeB)} de texto). Os conteúdos são diferentes.
        </div>
      );
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
  if (!changes.length) return <div className="muted">Mesmo conteúdo JSON (só a formatação difere).</div>;
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
        {counts.changed} modificado(s) · {counts.added} adicionado(s) em B · {counts.removed} removido(s) em B{truncated && ' · lista interrompida (muitas diferenças)'}
      </div>
      <div className="cmp-table cmp-json" role="table">
        <div className="cmp-row cmp-head" role="row">
          <span />
          <span>Caminho</span>
          <span>A</span>
          <span>B</span>
        </div>
        {changes.map((c) => {
          const status: DiffStatus = c.kind;
          return (
            <div key={c.path} className={`cmp-row is-${status}`} role="row">
              <span className="cmp-mark" title={STATUS_LABEL[status]} aria-label={STATUS_LABEL[status]}>
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
          … {skipped} linha(s) iguais
        </div>,
      );
      skipped = 0;
    }
    const text = reveal ? l.text : redactText(l.text);
    out.push(
      <div key={i} className={`cmp-line is-${l.op}`}>
        <span className="cmp-line-op" aria-label={l.op === 'add' ? 'só em B' : l.op === 'del' ? 'só em A' : 'igual'}>
          {l.op === 'add' ? '+' : l.op === 'del' ? '−' : ' '}
        </span>
        {text || ' '}
      </div>,
    );
  });
  if (skipped) out.push(<div key="end" className="cmp-line is-skip">… {skipped} linha(s) iguais</div>);
  return (
    <>
      <div className="muted cmp-json-summary">− só em A · + só em B{truncated && ' · comparação limitada às primeiras 1500 linhas'}</div>
      <pre className="code-block cmp-text">{out}</pre>
    </>
  );
}
