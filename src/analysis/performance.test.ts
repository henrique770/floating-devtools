import { describe, expect, it } from 'vitest';
import type { NetworkEntry } from '../shared/types';
import { heaviestResources, phasesOf, slowestRequests, summarize } from './performance';

let seq = 0;
const req = (extra: Partial<NetworkEntry>): NetworkEntry => ({ id: `r${++seq}`, url: 'https://a.test/x', method: 'GET', status: 200, statusText: '', type: 'fetch', state: 'done', startTime: 0, ...extra });

describe('performance', () => {
  it('ranks finished requests by duration, ignoring pending and long-lived ones', () => {
    const a = req({ duration: 300 });
    const b = req({ duration: 900 });
    const list = [a, b, req({ duration: 5000, state: 'pending' }), req({ duration: 9000, type: 'media' }), req({ duration: 8000, mimeType: 'text/event-stream' })];
    expect(slowestRequests(list).map((r) => r.id)).toEqual([b.id, a.id]);
  });

  it('ranks by bytes transferred, or decoded size when cached', () => {
    const net = req({ transferSize: 500 });
    const cached = req({ transferSize: 0, resourceSize: 800, fromCache: true });
    expect(heaviestResources([net, cached, req({})]).map((r) => r.id)).toEqual([cached.id, net.id]);
  });

  it('splits TTFB from download and connection', () => {
    expect(phasesOf(req({ timing: { stalled: 1, dns: 2, connect: 3, ssl: 1, waiting: 50, download: 10 } }))).toEqual({ connection: 6, ttfb: 50, download: 10 });
    expect(phasesOf(req({}))).toBeUndefined();
  });

  it('summarizes with the configured limits', () => {
    const s = summarize([req({ duration: 100, transferSize: 10 }), req({ duration: 300, transferSize: 2000 }), req({ duration: 2000, fromCache: true })], 1000, 1000);
    expect(s).toEqual({ finished: 3, slow: 0, large: 1, apiMedianMs: 300, transferred: 2010 });
  });
});
