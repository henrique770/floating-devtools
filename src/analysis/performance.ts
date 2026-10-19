/** Rankings and timing breakdowns for the Network performance view. Pure, so it can be tested. */
import type { NetworkEntry } from '../shared/types';

export interface Phases {
  /** Queueing, DNS, TCP and TLS before the request was sent. */
  connection: number;
  /** Time to first byte: from the request being sent until the response started. */
  ttfb: number;
  download: number;
}

/** Real timing phases, when the browser exposed them (same origin or Timing-Allow-Origin). */
export function phasesOf(r: NetworkEntry): Phases | undefined {
  const t = r.timing;
  if (!t) return undefined;
  return { connection: t.stalled + t.dns + t.connect, ttfb: t.waiting, download: t.download };
}

/** Long-lived responses (streams, media) are "slow" by nature and would only add noise. */
const isLongLived = (r: NetworkEntry) => r.type === 'media' || r.type === 'websocket' || /event-stream/i.test(r.mimeType ?? '');

export function slowestRequests(requests: NetworkEntry[], limit = 10): NetworkEntry[] {
  return requests
    .filter((r) => r.state === 'done' && r.duration !== undefined && !isLongLived(r))
    .sort((a, b) => b.duration! - a.duration!)
    .slice(0, limit);
}

/** Bytes that count for "weight": what went over the network, or the decoded size when served from cache. */
export const weightOf = (r: NetworkEntry) => r.transferSize || r.resourceSize || 0;

export function heaviestResources(requests: NetworkEntry[], limit = 10): NetworkEntry[] {
  return requests
    .filter((r) => r.state === 'done' && weightOf(r) > 0)
    .sort((a, b) => weightOf(b) - weightOf(a))
    .slice(0, limit);
}

export interface PerformanceSummary {
  finished: number;
  slow: number;
  large: number;
  /** Median total duration of finished API calls (fetch/XHR), if any. */
  apiMedianMs?: number;
  /** Bytes transferred over the network (cache hits excluded). */
  transferred: number;
}

export function summarize(requests: NetworkEntry[], slowMs: number, largeBytes: number): PerformanceSummary {
  let finished = 0;
  let slow = 0;
  let large = 0;
  let transferred = 0;
  const api: number[] = [];
  for (const r of requests) {
    if (r.state !== 'done') continue;
    finished++;
    transferred += r.transferSize ?? 0;
    if (!r.fromCache && !isLongLived(r) && (r.duration ?? 0) >= slowMs) slow++;
    if (weightOf(r) >= largeBytes) large++;
    if ((r.type === 'fetch' || r.type === 'xhr') && r.duration !== undefined) api.push(r.duration);
  }
  api.sort((a, b) => a - b);
  const apiMedianMs = api.length ? (api.length % 2 ? api[(api.length - 1) / 2] : (api[api.length / 2 - 1] + api[api.length / 2]) / 2) : undefined;
  return { finished, slow, large, apiMedianMs, transferred };
}
