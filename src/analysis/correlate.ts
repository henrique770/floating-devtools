/**
 * Relates console errors to network requests, with an explicit confidence for each link:
 *
 * - high: object identity. The logged error is the very object produced by the request's
 *   failure (fetch rejection, response.json() parse error) - captured in the page hook.
 * - medium: shared code or matching content. The error's stack and the request's initiator
 *   share a first-party function, or a JSON parse error follows a non-JSON response.
 * - low: timing only. A failed request finished shortly before the error. Shown as a lead,
 *   never as a cause: proximity in time does not establish causality.
 *
 * Computed on demand (when the user opens an event), never per captured event.
 */
import type { ConsoleEntry, NetworkEntry, SerializedValue } from '../shared/types';
import type { EventRef } from './diagnostics/types';

export type Confidence = 'high' | 'medium' | 'low';

export interface Correlation {
  ref: EventRef;
  confidence: Confidence;
  reason: string;
  /** Log time minus request end, in ms (positive: the request finished first). */
  deltaMs: number;
}

/** A request that ended this long before an error can still be its cause (timing-only links). */
export const TEMPORAL_WINDOW_MS = 2000;
/** Window for links backed by stack or content evidence. */
export const EVIDENCE_WINDOW_MS = 30_000;
const MAX_RESULTS = 8;

const RANK: Record<Confidence, number> = { high: 0, medium: 1, low: 2 };

const isApi = (r: NetworkEntry) => r.type === 'fetch' || r.type === 'xhr';
const isFailure = (r: NetworkEntry) => r.state === 'failed' || r.status >= 400;
const endOf = (r: NetworkEntry) => r.startTime + (r.duration ?? 0);

const JSON_PARSE_ERROR = /JSON|Unexpected token|Unexpected end of (?:JSON )?input|is not valid JSON/i;
// Library and framework code: sharing these frames says nothing about which request caused what.
const LIBRARY_FRAME = /node_modules|\/\.vite\/deps\/|vendor|react-dom|scheduler|zone\.js|polyfill|webpack\/bootstrap|chunk-vendors/i;

interface Frame {
  fn: string;
  file: string;
}

/** `at fn (https://x/a.js?v=1:10:5)` -> { fn, file } (line/column dropped: the call sites differ by design). */
function parseFrame(line: string): Frame | undefined {
  const m = line.trim().match(/^at\s+(?:async\s+)?(.*?)\s+\(?((?:https?|file|webpack|blob):[^\s)]+?)(?::\d+){1,2}\)?$/);
  if (!m) return undefined;
  const fn = m[1].replace(/^Object\.|^Module\./, '');
  return { fn, file: m[2].split(/[?#]/)[0] };
}

function appFrames(stack: string | undefined, pageOrigin: string): Frame[] {
  if (!stack) return [];
  const out: Frame[] = [];
  for (const line of stack.split('\n')) {
    const f = parseFrame(line);
    if (!f || !f.fn || f.fn === '<anonymous>' || /^(?:new )?Promise|^async /.test(f.fn)) continue;
    if (LIBRARY_FRAME.test(f.file)) continue;
    if (pageOrigin && !f.file.startsWith(pageOrigin)) continue;
    out.push(f);
  }
  return out;
}

const errorStack = (entry: ConsoleEntry) => entry.args.find((a): a is Extract<SerializedValue, { t: 'error' }> => a.t === 'error')?.stack;

function logText(entry: ConsoleEntry) {
  return entry.args.map((a) => (a.t === 'string' ? a.v : a.t === 'error' ? `${a.name}: ${a.message}` : '')).join(' ');
}

const shortFile = (file: string) => file.split('/').pop() || file;
const describe = (r: NetworkEntry) => (r.state === 'failed' ? `falhou (${r.error ?? 'erro de rede'})` : `HTTP ${r.status}`);
const ms = (n: number) => (Math.abs(n) < 1000 ? `${Math.round(n)} ms` : `${(n / 1000).toFixed(1)} s`);

/** Best link between one log and one request, or null. */
export function correlate(log: ConsoleEntry, r: NetworkEntry, pageOrigin: string): Correlation | null {
  const ref: EventRef = { kind: 'request', id: r.id };
  const delta = log.time - endOf(r);

  if (log.request === r.id) {
    return {
      ref,
      confidence: 'high',
      reason: 'O objeto de erro registrado é o mesmo gerado por esta requisição (rejeição do fetch ou falha de response.json()).',
      deltaMs: delta,
    };
  }

  // Everything below needs the request to have started before the error.
  if (r.state === 'pending' || r.startTime > log.time) return null;

  if (delta >= 0 && delta <= EVIDENCE_WINDOW_MS && isApi(r)) {
    const initiator = appFrames(r.initiator, pageOrigin);
    if (initiator.length) {
      const errorFrames = appFrames(errorStack(log) ?? log.stack, pageOrigin);
      const shared = errorFrames.find((f) => initiator.some((i) => i.fn === f.fn && i.file === f.file));
      if (shared) {
        return {
          ref,
          confidence: 'medium',
          reason: `O stack do erro e o código que iniciou a requisição passam pela mesma função: ${shared.fn} (${shortFile(shared.file)}).`,
          deltaMs: delta,
        };
      }
    }
    if (delta <= TEMPORAL_WINDOW_MS && JSON_PARSE_ERROR.test(logText(log)) && r.state === 'done') {
      const body = r.responseBody?.trimStart() ?? '';
      const mime = r.mimeType ?? '';
      if ((body && !/^[[{"\d-]|^(?:true|false|null)\b/.test(body)) || (mime && !/json/i.test(mime))) {
        return {
          ref,
          confidence: 'medium',
          reason: `Erro ao interpretar JSON ${ms(delta)} depois de uma resposta que não é JSON (${mime || 'sem content-type'}${body ? `, começa com “${body.slice(0, 20)}”` : ''}).`,
          deltaMs: delta,
        };
      }
    }
  }

  if (isFailure(r) && delta >= 0 && delta <= TEMPORAL_WINDOW_MS) {
    return {
      ref,
      confidence: 'low',
      reason: `A requisição ${describe(r)} terminou ${ms(delta)} antes. Só há proximidade no tempo, o que não comprova relação.`,
      deltaMs: delta,
    };
  }
  return null;
}

const sortCorrelations = (list: Correlation[]) => list.sort((a, b) => RANK[a.confidence] - RANK[b.confidence] || Math.abs(a.deltaMs) - Math.abs(b.deltaMs)).slice(0, MAX_RESULTS);

/** Requests possibly related to a console error/warning. */
export function relatedRequests(log: ConsoleEntry, requests: NetworkEntry[], pageOrigin: string): Correlation[] {
  if (log.level !== 'error' && log.level !== 'warn') return [];
  const out: Correlation[] = [];
  for (const r of requests) {
    const c = correlate(log, r, pageOrigin);
    if (c) out.push(c);
  }
  return sortCorrelations(out);
}

/** Console errors/warnings possibly related to a request. */
export function relatedLogs(request: NetworkEntry, logs: ConsoleEntry[], pageOrigin: string): Correlation[] {
  const out: Correlation[] = [];
  for (const l of logs) {
    if (l.level !== 'error' && l.level !== 'warn') continue;
    const c = correlate(l, request, pageOrigin);
    if (c) out.push({ ...c, ref: { kind: 'log', id: l.id } });
  }
  return sortCorrelations(out);
}

export const CONFIDENCE_LABEL: Record<Confidence, string> = { high: 'Alta', medium: 'Média', low: 'Baixa' };
