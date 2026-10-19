import { describe, expect, it } from 'vitest';
import type { NetworkEntry } from '../shared/types';
import { compareBodies, diffKeyValues, jsonDiff, queryParams, summaryRows, textDiff } from './compare';
import { isSensitiveName } from './redact';

describe('diffKeyValues', () => {
  it('classifies each key', () => {
    expect(diffKeyValues({ a: '1', b: '2', c: '3' }, { a: '1', b: 'x', d: '4' })).toEqual([
      { key: 'a', a: '1', b: '1', status: 'same' },
      { key: 'b', a: '2', b: 'x', status: 'changed' },
      { key: 'c', a: '3', b: undefined, status: 'removed' },
      { key: 'd', b: '4', status: 'added' },
    ]);
    expect(diffKeyValues(undefined, undefined)).toEqual([]);
  });
});

describe('queryParams', () => {
  it('joins repeated parameters and tolerates bad urls', () => {
    expect(queryParams('https://a.test/?x=1&x=2&y=3')).toEqual({ x: '1, 2', y: '3' });
    expect(queryParams('not a url')).toEqual({});
  });
});

describe('jsonDiff', () => {
  it('reports added, removed and changed fields with paths', () => {
    const { changes, truncated } = jsonDiff(
      { id: 1, user: { name: 'Ana', roles: ['a', 'b'] }, old: true, 'x-y': 1 },
      { id: 2, user: { name: 'Ana', roles: ['a'], email: 'e' }, 'x-y': '1' },
    );
    expect(truncated).toBe(false);
    expect(changes).toEqual([
      { path: '$.id', kind: 'changed', before: 1, after: 2, key: 'id' },
      { path: '$.user.roles[1]', kind: 'removed', before: 'b', key: 'roles' },
      { path: '$.user.email', kind: 'added', after: 'e', key: 'email' },
      { path: '$.old', kind: 'removed', before: true, key: 'old' },
      { path: '$["x-y"]', kind: 'changed', before: 1, after: '1', key: 'x-y' },
    ]);
  });

  it('reports a type change once, at the path where it happens', () => {
    expect(jsonDiff({ a: { b: 1 } }, { a: [1] }).changes).toEqual([{ path: '$.a', kind: 'changed', before: { b: 1 }, after: [1], key: 'a' }]);
  });

  it('finds nothing in equal documents', () => {
    expect(jsonDiff({ a: [1, { b: null }] }, { a: [1, { b: null }] }).changes).toEqual([]);
  });

  it('stops early on huge diffs', () => {
    const a = Array.from({ length: 1000 }, (_, i) => i);
    const b = a.map((n) => n + 1);
    const d = jsonDiff(a, b);
    expect(d.truncated).toBe(true);
    expect(d.changes.length).toBe(300);
  });
});

describe('textDiff', () => {
  it('produces a line diff', () => {
    expect(textDiff('a\nb\nc', 'a\nx\nc\nd').lines).toEqual([
      { op: 'same', text: 'a' },
      { op: 'add', text: 'x' },
      { op: 'del', text: 'b' },
      { op: 'same', text: 'c' },
      { op: 'add', text: 'd' },
    ]);
  });

  it('bounds the number of lines', () => {
    const big = Array.from({ length: 3000 }, (_, i) => `l${i}`).join('\n');
    const d = textDiff(big, `${big}\nmore`);
    expect(d.truncated).toBe(true);
    expect(d.lines.length).toBeLessThanOrEqual(1500);
  });
});

describe('compareBodies', () => {
  it('picks the right comparison', () => {
    expect(compareBodies('{"a":1}', '{"a":1}').kind).toBe('identical');
    expect(compareBodies('{"a":1}', '{"a":2}')).toMatchObject({ kind: 'json' });
    expect(compareBodies('<p>a</p>', '<p>b</p>')).toMatchObject({ kind: 'text' });
    expect(compareBodies('{"a":1}', 'not json')).toMatchObject({ kind: 'text' });
    expect(compareBodies(undefined, 'x', 'Conteúdo binário (image/png).')).toEqual({ kind: 'unavailable', a: 'Conteúdo binário (image/png).', b: undefined });
    expect(compareBodies('x'.repeat(400_000), 'y')).toMatchObject({ kind: 'too-large', equal: false });
    expect(compareBodies('', '{"a":1}')).toMatchObject({ kind: 'text' });
  });
});

describe('summaryRows', () => {
  const req = (extra: Partial<NetworkEntry>): NetworkEntry => ({ id: 'x', url: 'https://a.test/api?x=1', method: 'GET', status: 200, statusText: '', type: 'fetch', state: 'done', startTime: 0, ...extra });
  const f = { ms: (n?: number) => (n === undefined ? '—' : `${n} ms`), bytes: (n?: number) => (n === undefined ? '—' : `${n} B`), status: (e: NetworkEntry) => String(e.status) };

  it('shows deltas for numbers and ignores the query in the url row', () => {
    const rows = summaryRows(req({ duration: 100 }), req({ url: 'https://a.test/api?x=2', duration: 150, status: 500 }), f);
    expect(rows.find((r) => r.label === 'URL (sem query)')!.status).toBe('same');
    expect(rows.find((r) => r.label === 'Status')!.status).toBe('changed');
    expect(rows.find((r) => r.label === 'Duração total')!.delta).toEqual({ value: 50, ratio: 0.5, unit: 'ms' });
  });
});

describe('isSensitiveName', () => {
  it('recognizes secret-bearing names only', () => {
    for (const n of ['authorization', 'cookie', 'set-cookie', 'x-api-key', 'accessToken', 'password', 'client_secret']) expect(isSensitiveName(n)).toBe(true);
    for (const n of ['content-type', 'author', 'tokens', 'user', 'accept']) expect(isSensitiveName(n)).toBe(false);
  });
});
