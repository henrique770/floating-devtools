/**
 * Compares two captured requests: summary fields, query parameters, headers, and bodies
 * (structural diff for JSON, line diff for other text). Values are compared as captured;
 * masking of sensitive values is a display concern (see isSensitiveName).
 *
 * Every diff is bounded so huge payloads can't freeze the page.
 */
import { defineMessages } from '../i18n';
import type { NetworkEntry } from '../shared/types';

const m = defineMessages({
  pt: {
    notCaptured: 'Corpo não capturado.',
    url: 'URL (sem query)',
    method: 'Método',
    type: 'Tipo',
    duration: 'Duração total',
    transferred: 'Transferido',
    bodySize: 'Tamanho do corpo',
    yes: 'sim',
    no: 'não',
  },
  en: {
    notCaptured: 'Body not captured.',
    url: 'URL (without query)',
    method: 'Method',
    type: 'Type',
    duration: 'Total duration',
    transferred: 'Transferred',
    bodySize: 'Body size',
    yes: 'yes',
    no: 'no',
  },
});

export type DiffStatus = 'same' | 'changed' | 'added' | 'removed';

export interface KeyValueDiff {
  key: string;
  a?: string;
  b?: string;
  status: DiffStatus;
}

/** Union of keys, in A's order then B's new ones. `added` = only in B, `removed` = only in A. */
export function diffKeyValues(a: Record<string, string> | undefined, b: Record<string, string> | undefined): KeyValueDiff[] {
  const out: KeyValueDiff[] = [];
  const left = a ?? {};
  const right = b ?? {};
  for (const key of Object.keys(left)) {
    const inB = Object.prototype.hasOwnProperty.call(right, key);
    out.push({ key, a: left[key], b: right[key], status: !inB ? 'removed' : left[key] === right[key] ? 'same' : 'changed' });
  }
  for (const key of Object.keys(right)) if (!Object.prototype.hasOwnProperty.call(left, key)) out.push({ key, b: right[key], status: 'added' });
  return out;
}

/** Query parameters as a map; repeated parameters are joined in order. */
export function queryParams(url: string): Record<string, string> {
  const out: Record<string, string> = {};
  try {
    for (const [k, v] of new URL(url).searchParams) out[k] = k in out ? `${out[k]}, ${v}` : v;
  } catch {
    /* not a URL */
  }
  return out;
}

// ------------------------------------------------------------------ JSON

export interface JsonChange {
  /** `$.items[2].name` */
  path: string;
  kind: 'added' | 'removed' | 'changed';
  before?: unknown;
  after?: unknown;
  /** Last property name on the path (to decide on masking). */
  key?: string;
}

export interface JsonDiff {
  changes: JsonChange[];
  /** Stopped early (too many changes, too deep or too many nodes). */
  truncated: boolean;
}

const MAX_CHANGES = 300;
const MAX_NODES = 50_000;
const MAX_DEPTH = 32;

const typeOf = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
const IDENT = /^[A-Za-z_$][\w$]*$/;
const child = (path: string, key: string | number) => (typeof key === 'number' ? `${path}[${key}]` : IDENT.test(key) ? `${path}.${key}` : `${path}[${JSON.stringify(key)}]`);

/** Structural diff: objects by key, arrays by index. A type change is reported as one change at that path. */
export function jsonDiff(a: unknown, b: unknown): JsonDiff {
  const changes: JsonChange[] = [];
  let nodes = 0;
  let truncated = false;

  const push = (c: JsonChange) => {
    if (changes.length >= MAX_CHANGES) truncated = true;
    else changes.push(c);
  };

  const walk = (x: unknown, y: unknown, path: string, depth: number, key?: string) => {
    if (truncated) return;
    if (++nodes > MAX_NODES || depth > MAX_DEPTH) {
      truncated = true;
      return;
    }
    const tx = typeOf(x);
    const ty = typeOf(y);
    if (tx !== ty || (tx !== 'object' && tx !== 'array')) {
      if (tx !== ty || x !== y) push({ path, kind: 'changed', before: x, after: y, key });
      return;
    }
    if (tx === 'array') {
      const xa = x as unknown[];
      const ya = y as unknown[];
      const n = Math.max(xa.length, ya.length);
      for (let i = 0; i < n && !truncated; i++) {
        if (i >= ya.length) push({ path: child(path, i), kind: 'removed', before: xa[i], key });
        else if (i >= xa.length) push({ path: child(path, i), kind: 'added', after: ya[i], key });
        else walk(xa[i], ya[i], child(path, i), depth + 1, key);
      }
      return;
    }
    const xo = x as Record<string, unknown>;
    const yo = y as Record<string, unknown>;
    for (const k of Object.keys(xo)) {
      if (truncated) return;
      if (!Object.prototype.hasOwnProperty.call(yo, k)) push({ path: child(path, k), kind: 'removed', before: xo[k], key: k });
      else walk(xo[k], yo[k], child(path, k), depth + 1, k);
    }
    for (const k of Object.keys(yo)) {
      if (truncated) return;
      if (!Object.prototype.hasOwnProperty.call(xo, k)) push({ path: child(path, k), kind: 'added', after: yo[k], key: k });
    }
  };

  walk(a, b, '$', 0);
  return { changes, truncated };
}

// ------------------------------------------------------------------ text

export interface TextLine {
  op: 'same' | 'add' | 'del';
  text: string;
}

export interface TextDiff {
  lines: TextLine[];
  truncated: boolean;
}

const MAX_LINES = 1500;

/** Line diff (LCS) bounded to MAX_LINES per side; unchanged runs are collapsed by the UI. */
export function textDiff(a: string, b: string): TextDiff {
  let left = a.split('\n');
  let right = b.split('\n');
  const truncated = left.length > MAX_LINES || right.length > MAX_LINES;
  left = left.slice(0, MAX_LINES);
  right = right.slice(0, MAX_LINES);

  // Trim the common prefix/suffix first: most diffs touch a small part of the text.
  let start = 0;
  while (start < left.length && start < right.length && left[start] === right[start]) start++;
  let endA = left.length;
  let endB = right.length;
  while (endA > start && endB > start && left[endA - 1] === right[endB - 1]) {
    endA--;
    endB--;
  }
  const midA = left.slice(start, endA);
  const midB = right.slice(start, endB);
  const n = midA.length;
  const m = midB.length;
  const lcs = new Uint16Array((n + 1) * (m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * (m + 1) + j] = midA[i] === midB[j] ? lcs[(i + 1) * (m + 1) + j + 1] + 1 : Math.max(lcs[(i + 1) * (m + 1) + j], lcs[i * (m + 1) + j + 1]);
    }
  }
  const lines: TextLine[] = left.slice(0, start).map((text) => ({ op: 'same', text }));
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && midA[i] === midB[j]) {
      lines.push({ op: 'same', text: midA[i++] });
      j++;
    } else if (j < m && (i === n || lcs[i * (m + 1) + j + 1] >= lcs[(i + 1) * (m + 1) + j])) {
      lines.push({ op: 'add', text: midB[j++] });
    } else {
      lines.push({ op: 'del', text: midA[i++] });
    }
  }
  for (const text of left.slice(endA)) lines.push({ op: 'same', text });
  return { lines, truncated };
}

// ------------------------------------------------------------------ bodies

/** Above this, bodies are compared for equality and size only. */
export const MAX_DIFF_BODY = 300_000;

export type BodyComparison =
  | { kind: 'identical' }
  | { kind: 'json'; diff: JsonDiff }
  | { kind: 'text'; diff: TextDiff }
  | { kind: 'too-large'; equal: boolean; sizeA: number; sizeB: number }
  | { kind: 'unavailable'; a?: string; b?: string };

function parseJson(text: string): { ok: true; value: unknown } | { ok: false } {
  const t = text.trim();
  if (!t || !/^[[{]/.test(t)) return { ok: false };
  try {
    return { ok: true, value: JSON.parse(t) };
  } catch {
    return { ok: false };
  }
}

/**
 * `undefined` means the body was not captured (static resource, binary, stream); `note` says why.
 * An empty string is a real empty body and is compared normally.
 */
export function compareBodies(a: string | undefined, b: string | undefined, noteA?: string, noteB?: string): BodyComparison {
  if (a === undefined || b === undefined) {
    return { kind: 'unavailable', a: a === undefined ? (noteA ?? m().notCaptured) : undefined, b: b === undefined ? (noteB ?? m().notCaptured) : undefined };
  }
  const x = a;
  const y = b;
  if (x === y) return { kind: 'identical' };
  if (x.length > MAX_DIFF_BODY || y.length > MAX_DIFF_BODY) return { kind: 'too-large', equal: false, sizeA: x.length, sizeB: y.length };
  const ja = parseJson(x);
  const jb = parseJson(y);
  if (ja.ok && jb.ok) return { kind: 'json', diff: jsonDiff(ja.value, jb.value) };
  return { kind: 'text', diff: textDiff(x, y) };
}

// ------------------------------------------------------------------ summary

export interface SummaryRow {
  label: string;
  a: string;
  b: string;
  status: DiffStatus;
  /** For numeric rows: b - a, and the relative change. */
  delta?: { value: number; ratio?: number; unit: 'ms' | 'bytes' };
}

type Formatter = { ms: (n?: number) => string; bytes: (n?: number) => string; status: (e: NetworkEntry) => string };

export function summaryRows(a: NetworkEntry, b: NetworkEntry, f: Formatter): SummaryRow[] {
  const text = (label: string, x: string, y: string): SummaryRow => ({ label, a: x, b: y, status: x === y ? 'same' : 'changed' });
  const num = (label: string, x: number | undefined, y: number | undefined, unit: 'ms' | 'bytes'): SummaryRow => {
    const fmt = unit === 'ms' ? f.ms : f.bytes;
    const row: SummaryRow = { label, a: fmt(x), b: fmt(y), status: x === y ? 'same' : x === undefined ? 'added' : y === undefined ? 'removed' : 'changed' };
    if (x !== undefined && y !== undefined && x !== y) row.delta = { value: y - x, ratio: x ? (y - x) / x : undefined, unit };
    return row;
  };
  const urlBase = (u: string) => u.split(/[?#]/)[0];
  const t = m();
  const yesNo = (v: boolean | undefined) => (v ? t.yes : t.no);
  return [
    text(t.url, urlBase(a.url), urlBase(b.url)),
    text(t.method, a.method, b.method),
    text('Status', f.status(a), f.status(b)),
    text(t.type, a.type, b.type),
    text('Content-Type', a.mimeType ?? '—', b.mimeType ?? '—'),
    num(t.duration, a.duration, b.duration, 'ms'),
    num('TTFB', a.timing?.waiting, b.timing?.waiting, 'ms'),
    num('Download', a.timing?.download, b.timing?.download, 'ms'),
    num(t.transferred, a.transferSize, b.transferSize, 'bytes'),
    num(t.bodySize, a.resourceSize, b.resourceSize, 'bytes'),
    text('Cache', yesNo(a.fromCache), yesNo(b.fromCache)),
  ];
}
