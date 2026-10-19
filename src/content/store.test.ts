import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConsoleEntry } from '../shared/types';
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
