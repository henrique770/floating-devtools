import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_INSIGHTS_CONFIG } from '../analysis/diagnostics/types';
import type { ConsoleEntry, NetworkPatch } from '../shared/types';
import { DevtoolsStore } from './store';

let seq = 0;
const log = (v: string, extra: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: `c${++seq}`,
  level: 'error',
  args: [{ t: 'string', v }],
  time: Date.now(),
  ...extra,
});

describe('DevtoolsStore console grouping', () => {
  let store: DevtoolsStore;
  const send = (entry: ConsoleEntry) => store.handlePageMessage({ kind: 'console', entry });
  const snap = () => {
    vi.advanceTimersByTime(100);
    return store.getSnapshot();
  };

  beforeEach(() => {
    vi.useFakeTimers();
    store = new DevtoolsStore(() => {});
  });
  afterEach(() => vi.useRealTimers());

  it('keeps every original entry and groups equivalent ones', () => {
    send(log('QuotaExceededError item 123456'));
    send(log('something else'));
    send(log('QuotaExceededError item 654321'));
    const s = snap();
    expect(s.logs).toHaveLength(3);
    expect(s.groups).toHaveLength(2);
    const quota = s.groups.find((g) => g.count === 2)!;
    expect(s.logs.filter((l) => l.group === quota.key)).toHaveLength(2);
  });

  it('counts consecutive repeats collapsed into one entry as occurrences', () => {
    for (let i = 0; i < 200; i++) send(log('same'));
    const s = snap();
    expect(s.logs).toHaveLength(1);
    expect(s.logs[0].count).toBe(200);
    expect(s.groups).toHaveLength(1);
    expect(s.groups[0].count).toBe(200);
  });

  it('keeps the total count after old entries leave the buffer', () => {
    send(log('old error'));
    for (let i = 0; i < 5000; i++) send(log(`filler ${i % 2 ? 'a' : 'b'}`, { level: 'log' }));
    send(log('old error'));
    const s = snap();
    const old = s.groups.find((g) => (g.sample.args[0] as { v: string }).v === 'old error')!;
    expect(old.count).toBe(2);
    expect(s.logs.filter((l) => l.group === old.key)).toHaveLength(1);
  });

  it('clears groups with the console', () => {
    send(log('a'));
    snap();
    store.clearConsole();
    expect(snap().groups).toEqual([]);
  });
});

describe('DevtoolsStore diagnostics', () => {
  let store: DevtoolsStore;
  const snap = (ms = 100) => {
    vi.advanceTimersByTime(ms);
    return store.getSnapshot();
  };
  const net = (patch: NetworkPatch) => store.handlePageMessage({ kind: 'net', patch });

  beforeEach(() => {
    vi.useFakeTimers();
    store = new DevtoolsStore(() => {}, 'https://app.test');
  });
  afterEach(() => vi.useRealTimers());

  it('diagnoses requests once they finish, with the data that arrived later', () => {
    net({ id: 'f1', url: 'https://app.test/api/a', method: 'GET', type: 'fetch', state: 'pending', startTime: Date.now() });
    expect(snap().diagnostics).toEqual([]);
    net({ id: 'f1', status: 503, duration: 40 });
    expect(snap().diagnostics).toEqual([]); // still pending: body not read yet
    net({ id: 'f1', state: 'done' });
    expect(snap().diagnostics.map((d) => d.ruleId)).toEqual(['net.http-error']);
  });

  it('waits for webRequest before diagnosing a failed cross-origin fetch', () => {
    net({ id: 'f2', url: 'https://api.other/x', method: 'GET', type: 'fetch', state: 'pending', startTime: Date.now() });
    net({ id: 'f2', state: 'failed', error: 'TypeError: Failed to fetch', duration: 10 });
    expect(snap().diagnostics).toEqual([]);
    store.handleWebRequest({ kind: 'webreq', url: 'https://api.other/x', method: 'GET', type: 'xmlhttprequest', statusCode: 200, fromCache: false, failed: false });
    const [d] = snap().diagnostics;
    expect(d.ruleId).toBe('net.possible-cors');
    expect(d.evidence.join(' ')).toContain('HTTP 200');
    snap(2000);
    expect(store.getSnapshot().diagnostics).toHaveLength(1);
  });

  it('diagnoses without webRequest data after the wait', () => {
    net({ id: 'f3', url: 'https://api.other/y', method: 'GET', type: 'fetch', state: 'pending', startTime: Date.now() });
    net({ id: 'f3', state: 'failed', error: 'TypeError: Failed to fetch', duration: 10 });
    expect(snap().diagnostics).toEqual([]);
    expect(snap(2000).diagnostics.map((d) => d.ruleId)).toEqual(['net.possible-cors']);
  });

  it('keeps dismissals by id and rebuilds when limits change', () => {
    net({ id: 's1', url: 'https://app.test/api/slow', method: 'GET', type: 'fetch', state: 'done', status: 200, duration: 1500, startTime: Date.now() });
    const [d] = snap().diagnostics;
    store.setDismissed(d.id, true);
    expect(snap().dismissed.has(d.id)).toBe(true);
    store.setInsightsConfig({ ...DEFAULT_INSIGHTS_CONFIG, slowMs: 2000 });
    expect(snap().diagnostics).toEqual([]);
    store.setInsightsConfig(DEFAULT_INSIGHTS_CONFIG);
    expect(snap().diagnostics.map((x) => x.id)).toEqual([d.id]);
  });

  it('drops diagnostics of cleared data', () => {
    send(log('x', { prefix: 'Uncaught', args: [{ t: 'error', name: 'TypeError', message: 'x' }] }));
    expect(snap().diagnostics).toHaveLength(1);
    store.clearConsole();
    expect(snap().diagnostics).toEqual([]);
  });

  const send = (entry: ConsoleEntry) => store.handlePageMessage({ kind: 'console', entry });
});

describe('DevtoolsStore diagnostics rebuild', () => {
  it('keeps the count of collapsed repeats after a rebuild', () => {
    vi.useFakeTimers();
    const store = new DevtoolsStore(() => {}, 'https://app.test');
    const entry = () => log('x', { prefix: 'Uncaught', args: [{ t: 'error', name: 'TypeError', message: 'x' }] });
    for (let i = 0; i < 300; i++) store.handlePageMessage({ kind: 'console', entry: entry() });
    vi.advanceTimersByTime(100);
    expect(store.getSnapshot().diagnostics[0].count).toBe(300);
    store.clearNetwork(); // rebuilds from what is still captured
    vi.advanceTimersByTime(100);
    expect(store.getSnapshot().diagnostics[0].count).toBe(300);
    vi.useRealTimers();
  });
});
