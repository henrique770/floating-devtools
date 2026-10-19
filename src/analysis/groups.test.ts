import { describe, expect, it } from 'vitest';
import type { ConsoleEntry } from '../shared/types';
import { LogGroupIndex } from './groups';
import { originOf } from './origin';

let seq = 0;
const log = (v: string, time: number, extra: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: `c${++seq}`,
  level: 'error',
  args: [{ t: 'string', v }],
  time,
  ...extra,
});

describe('LogGroupIndex', () => {
  it('counts occurrences and tracks first and last time', () => {
    const index = new LogGroupIndex();
    const k1 = index.add(log('QuotaExceededError', 100));
    index.add(log('other', 150));
    const k2 = index.add(log('QuotaExceededError', 200));
    expect(k1).toBe(k2);
    const quota = index.list().find((g) => g.key === k1)!;
    expect(quota).toMatchObject({ count: 2, firstTime: 100, lastTime: 200 });
    expect(quota.sample.time).toBe(200);
  });

  it('lists groups by last activity', () => {
    const index = new LogGroupIndex();
    index.add(log('a', 1));
    index.add(log('b', 2));
    index.add(log('a', 3));
    expect(index.list().map((g) => (g.sample.args[0] as { v: string }).v)).toEqual(['b', 'a']);
  });

  it('reuses the list while nothing changed and replaces changed groups', () => {
    const index = new LogGroupIndex();
    index.add(log('a', 1));
    const first = index.list();
    expect(index.list()).toBe(first);
    index.add(log('a', 2));
    expect(index.list()).not.toBe(first);
    expect(index.list()[0]).not.toBe(first[0]);
  });

  it('clears', () => {
    const index = new LogGroupIndex();
    index.add(log('a', 1));
    index.clear();
    expect(index.list()).toEqual([]);
  });

  it('caps the number of groups, dropping the least recently active', () => {
    const index = new LogGroupIndex();
    for (let i = 0; i < 2100; i++) index.add(log(`distinct ${String.fromCharCode(65 + (i % 26))}${Math.floor(i / 26)}`, i));
    expect(index.list()).toHaveLength(2000);
  });
});

describe('originOf', () => {
  const page = 'https://app.test';
  it('classifies by the source url', () => {
    expect(originOf(log('x', 0, { source: { label: 'a.js:1', url: 'https://app.test/a.js:1' } }), page)).toBe('page');
    expect(originOf(log('x', 0, { source: { label: 'gtm.js:1', url: 'https://www.googletagmanager.com/gtm.js:1' } }), page)).toBe('third-party');
    expect(originOf(log('x', 0, { source: { label: 'a.js:1', url: 'webpack://app/a.js:1' } }), page)).toBe('unknown');
    expect(originOf(log('x', 0), page)).toBe('unknown');
  });
});
