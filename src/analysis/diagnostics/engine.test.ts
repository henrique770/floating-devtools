import { describe, expect, it } from 'vitest';
import type { NetworkEntry } from '../../shared/types';
import { DiagnosticsEngine } from './engine';
import { DEFAULT_INSIGHTS_CONFIG } from './types';

let seq = 0;
const req = (extra: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: `r${++seq}`,
  url: 'https://app.test/api/items',
  method: 'GET',
  status: 500,
  statusText: '',
  type: 'fetch',
  state: 'done',
  startTime: 1000,
  duration: 50,
  ...extra,
});

describe('DiagnosticsEngine', () => {
  const engine = () => new DiagnosticsEngine(DEFAULT_INSIGHTS_CONFIG, 'https://app.test');

  it('merges occurrences of the same problem', () => {
    const e = engine();
    e.onRequest(req({ startTime: 1000 }));
    e.onRequest(req({ startTime: 3000 }));
    const [d] = e.list();
    expect(e.list()).toHaveLength(1);
    expect(d).toMatchObject({ id: 'net.http-error:GET https://app.test/api/items 500', count: 2, firstTime: 1000, lastTime: 3000 });
    expect(d.related).toHaveLength(2);
  });

  it('counts a re-evaluated request once', () => {
    const e = engine();
    const r = req();
    e.onRequest(r);
    e.onRequest({ ...r, transferSize: 10 });
    expect(e.list()[0].count).toBe(1);
  });

  it('refreshes the displayed occurrence when it gains data', () => {
    const e = engine();
    const r = req({ status: 200, duration: 1500 });
    e.onRequest(r);
    expect(e.list()[0].evidence.join(' ')).toContain('não é possível separar');
    e.onRequest({ ...r, timing: { stalled: 0, dns: 0, connect: 0, ssl: 0, waiting: 1400, download: 50 } });
    expect(e.list()[0].evidence.join(' ')).toContain('TTFB');
  });

  it('skips pending requests', () => {
    const e = engine();
    e.onRequest(req({ state: 'pending' }));
    expect(e.list()).toEqual([]);
  });

  it('counts collapsed console repeats as occurrences', () => {
    const e = engine();
    const entry = { id: 'c1', level: 'error' as const, prefix: 'Uncaught', time: 1, args: [{ t: 'error' as const, name: 'TypeError', message: 'x' }], group: 'g' };
    e.onLog(entry);
    e.onLog({ ...entry, count: 2 });
    e.onLog({ ...entry, count: 3 });
    expect(e.list()[0].count).toBe(3);
  });

  it('survives a rule that throws', () => {
    const e = new DiagnosticsEngine(DEFAULT_INSIGHTS_CONFIG, '', () => ({
      log: [],
      request: [
        {
          id: 'broken',
          evaluate: () => {
            throw new Error('bug');
          },
        },
      ],
    }));
    expect(() => e.onRequest(req())).not.toThrow();
  });

  it('starts over on reset with the new config', () => {
    const e = engine();
    e.onRequest(req({ status: 200, duration: 1500 }));
    expect(e.list()).toHaveLength(1);
    e.reset({ ...DEFAULT_INSIGHTS_CONFIG, slowMs: 2000 });
    e.onRequest(req({ status: 200, duration: 1500 }));
    expect(e.list()).toEqual([]);
  });
});
