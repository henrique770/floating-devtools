import { describe, expect, it } from 'vitest';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { correlate, relatedLogs, relatedRequests } from './correlate';

const ORIGIN = 'https://app.test';
let seq = 0;
const req = (extra: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: `r${++seq}`,
  url: 'https://app.test/api/user',
  method: 'GET',
  status: 200,
  statusText: '',
  type: 'fetch',
  state: 'done',
  startTime: 1000,
  duration: 100,
  ...extra,
});
const log = (extra: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: `c${++seq}`,
  level: 'error',
  time: 1500,
  args: [{ t: 'error', name: 'TypeError', message: 'x' }],
  ...extra,
});

describe('correlate', () => {
  it('is high confidence when the error object came from the request', () => {
    const r = req({ state: 'failed', status: 0, error: 'TypeError: Failed to fetch' });
    expect(correlate(log({ request: r.id, time: 50_000 }), r, ORIGIN)).toMatchObject({ confidence: 'high' });
  });

  it('is medium when the error stack and the request initiator share a first-party function', () => {
    const r = req({ initiator: 'at loadUser (https://app.test/src/user.ts:10:3)\nat useEffect (https://app.test/node_modules/react-dom/x.js:1:1)' });
    const l = log({ args: [{ t: 'error', name: 'TypeError', message: 'x', stack: 'TypeError: x\n    at async loadUser (https://app.test/src/user.ts:14:9)' }] });
    const c = correlate(l, r, ORIGIN)!;
    expect(c.confidence).toBe('medium');
    expect(c.reason).toContain('loadUser');
  });

  it('ignores shared library frames', () => {
    const r = req({ initiator: 'at commitRoot (https://app.test/node_modules/.vite/deps/react-dom.js:1:1)' });
    const l = log({ args: [{ t: 'error', name: 'TypeError', message: 'x', stack: 'TypeError: x\n    at commitRoot (https://app.test/node_modules/.vite/deps/react-dom.js:9:9)' }] });
    expect(correlate(l, r, ORIGIN)).toBeNull();
  });

  it('is medium for a JSON parse error right after a non-JSON response', () => {
    const r = req({ mimeType: 'text/html', responseBody: '<!doctype html>' });
    const l = log({ args: [{ t: 'error', name: 'SyntaxError', message: 'Unexpected token < in JSON at position 0' }] });
    expect(correlate(l, r, ORIGIN)!.confidence).toBe('medium');
    expect(correlate(l, req({ mimeType: 'application/json', responseBody: '{"a":1}' }), ORIGIN)).toBeNull();
  });

  it('is low, and says so, when only timing links a failed request', () => {
    const c = correlate(log(), req({ status: 500 }), ORIGIN)!;
    expect(c.confidence).toBe('low');
    expect(c.reason).toContain('não comprova');
  });

  it('never links successful requests by timing, requests after the error, or old failures', () => {
    expect(correlate(log(), req(), ORIGIN)).toBeNull();
    expect(correlate(log({ time: 900 }), req({ status: 500 }), ORIGIN)).toBeNull();
    expect(correlate(log({ time: 10_000 }), req({ status: 500 }), ORIGIN)).toBeNull();
    expect(correlate(log(), req({ status: 500, state: 'pending' }), ORIGIN)).toBeNull();
  });
});

describe('relatedRequests / relatedLogs', () => {
  it('ranks by confidence, then by closeness in time', () => {
    const exact = req({ state: 'failed', status: 0, startTime: 100, duration: 10 });
    const near = req({ status: 500, startTime: 1300, duration: 100 });
    const far = req({ status: 500, startTime: 0, duration: 100 });
    const l = log({ request: exact.id, time: 1500 });
    expect(relatedRequests(l, [far, near, exact], ORIGIN).map((c) => c.ref.id)).toEqual([exact.id, near.id, far.id]);
  });

  it('only looks at errors and warnings', () => {
    const r = req({ status: 500 });
    expect(relatedRequests(log({ level: 'log' }), [r], ORIGIN)).toEqual([]);
    expect(relatedLogs(r, [log(), log({ level: 'info' })], ORIGIN)).toHaveLength(1);
  });
});
