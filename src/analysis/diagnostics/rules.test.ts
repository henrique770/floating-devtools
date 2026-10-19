import { describe, expect, it } from 'vitest';
import type { ConsoleEntry, NetworkEntry, SerializedValue } from '../../shared/types';
import { javascriptRule, scriptLoadRule } from './rules/javascript';
import { classifyFailure, httpErrorRule, requestFailureRule, unexpectedResponseRule } from './rules/network';
import { duplicateRequestRule, largeResourceRule, slowRequestRule } from './rules/performance';
import { storageRule } from './rules/storage';
import { DEFAULT_INSIGHTS_CONFIG, type RuleContext } from './types';

const ctx: RuleContext = { config: DEFAULT_INSIGHTS_CONFIG, pageOrigin: 'https://app.test' };
let seq = 0;

const err = (name: string, message: string): SerializedValue => ({ t: 'error', name, message, stack: `${name}: ${message}\n    at f (https://app.test/a.js:1:1)` });
const log = (args: SerializedValue[], extra: Partial<ConsoleEntry> = {}): ConsoleEntry => ({
  id: `c${++seq}`,
  level: 'error',
  args,
  time: 1000,
  source: { label: 'a.js:1', url: 'https://app.test/a.js:1' },
  ...extra,
});
const req = (extra: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: `r${++seq}`,
  url: 'https://app.test/api/items',
  method: 'GET',
  status: 200,
  statusText: '',
  type: 'fetch',
  state: 'done',
  startTime: 1000,
  duration: 100,
  ...extra,
});

describe('javascript rule', () => {
  it('reports uncaught errors as high severity with an explanation', () => {
    const f = javascriptRule.evaluate(log([err('TypeError', "Cannot read properties of undefined (reading 'id')")], { prefix: 'Uncaught' }), ctx)!;
    expect(f).toMatchObject({ ruleId: 'js.uncaught', category: 'javascript', severity: 'high' });
    expect(f.title).toContain('nulo/indefinido');
    expect(f.evidence.some((e) => e.includes('Não foi tratada'))).toBe(true);
  });

  it('reports unhandled rejections', () => {
    const f = javascriptRule.evaluate(log([{ t: 'string', v: 'boom' }], { prefix: 'Uncaught (in promise)' }), ctx)!;
    expect(f).toMatchObject({ ruleId: 'js.unhandled-rejection', severity: 'high' });
  });

  it('reports Error objects logged by the app as medium, and ignores plain console.error strings', () => {
    expect(javascriptRule.evaluate(log([err('ReferenceError', 'foo is not defined')]), ctx)).toMatchObject({ ruleId: 'js.logged-error', severity: 'medium' });
    expect(javascriptRule.evaluate(log([{ t: 'string', v: 'Something went wrong' }]), ctx)).toBeNull();
    expect(javascriptRule.evaluate(log([err('TypeError', 'x')], { level: 'warn' }), ctx)).toBeNull();
  });

  it('recognizes errors written as text', () => {
    expect(javascriptRule.evaluate(log([{ t: 'string', v: 'SyntaxError: Unexpected token < in JSON at position 0' }], { prefix: 'Uncaught' }), ctx)!.title).toContain('JSON');
  });

  it('downgrades third-party errors', () => {
    const f = javascriptRule.evaluate(
      log([err('TypeError', 'x is not a function')], { prefix: 'Uncaught', source: { label: 'w.js:1', url: 'https://widget.other/w.js:1' } }),
      ctx,
    )!;
    expect(f.severity).toBe('medium');
  });

  it('reports scripts that failed to load', () => {
    expect(scriptLoadRule.evaluate(req({ type: 'script', url: 'https://app.test/chunk.js', status: 404 }), ctx)).toMatchObject({ severity: 'high', category: 'javascript' });
    expect(scriptLoadRule.evaluate(req({ type: 'script', url: 'https://app.test/chunk.js' }), ctx)).toBeNull();
  });
});

describe('storage rule', () => {
  it('detects quota errors', () => {
    expect(storageRule.evaluate(log([err('QuotaExceededError', "Failed to execute 'setItem' on 'Storage'")], { prefix: 'Uncaught' }), ctx)).toMatchObject({
      ruleId: 'storage.quota',
      severity: 'high',
    });
  });

  it('detects access and IndexedDB failures', () => {
    expect(storageRule.evaluate(log([err('SecurityError', "Failed to read the 'localStorage' property from 'Window': Access is denied")]), ctx)!.ruleId).toBe('storage.access');
    expect(storageRule.evaluate(log([err('InvalidStateError', "Failed to execute 'transaction' on 'IDBDatabase'")]), ctx)!.ruleId).toBe('storage.persistence');
  });

  it('ignores unrelated errors', () => {
    expect(storageRule.evaluate(log([err('TypeError', 'x')]), ctx)).toBeNull();
  });
});

describe('network rules', () => {
  it('rates HTTP errors by status and context', () => {
    expect(httpErrorRule.evaluate(req({ status: 500 }), ctx)!.severity).toBe('high');
    expect(httpErrorRule.evaluate(req({ status: 401 }), ctx)!.title).toContain('401');
    expect(httpErrorRule.evaluate(req({ status: 404, type: 'image', url: 'https://app.test/a.png' }), ctx)!.severity).toBe('low');
    expect(httpErrorRule.evaluate(req({ status: 404, type: 'other', url: 'https://app.test/favicon.ico' }), ctx)!.severity).toBe('info');
    expect(httpErrorRule.evaluate(req({ status: 500, url: 'https://api.other/x' }), ctx)!.severity).toBe('medium');
    expect(httpErrorRule.evaluate(req({ status: 200 }), ctx)).toBeNull();
  });

  it('groups HTTP errors by endpoint, ignoring ids and query', () => {
    const a = httpErrorRule.evaluate(req({ status: 500, url: 'https://app.test/api/users/123?x=1' }), ctx)!;
    const b = httpErrorRule.evaluate(req({ status: 500, url: 'https://app.test/api/users/456?x=2' }), ctx)!;
    const c = httpErrorRule.evaluate(req({ status: 502, url: 'https://app.test/api/users/456' }), ctx)!;
    expect(a.subject).toBe(b.subject);
    expect(a.subject).not.toBe(c.subject);
  });

  it('classifies failures', () => {
    const failed = (extra: Partial<NetworkEntry>) => req({ state: 'failed', status: 0, ...extra });
    expect(classifyFailure(failed({ error: 'AbortError: The user aborted a request.' }), ctx.pageOrigin)).toBe('aborted');
    expect(classifyFailure(failed({ type: 'xhr', error: 'Timeout' }), ctx.pageOrigin)).toBe('timeout');
    expect(classifyFailure(failed({ type: 'image', error: 'net::ERR_BLOCKED_BY_CLIENT' }), ctx.pageOrigin)).toBe('blocked');
    expect(classifyFailure(failed({ error: 'TypeError: Failed to fetch', web: { method: 'GET', status: 0, error: 'net::ERR_NAME_NOT_RESOLVED' } }), ctx.pageOrigin)).toBe('connection');
  });

  it('only suggests CORS for cross-origin calls, and says when it is not confirmed', () => {
    const cors = requestFailureRule.evaluate(
      req({ url: 'https://api.other/x', state: 'failed', status: 0, error: 'TypeError: Failed to fetch', web: { method: 'GET', status: 200 } }),
      ctx,
    )!;
    expect(cors.ruleId).toBe('net.possible-cors');
    expect(cors.evidence.join(' ')).toContain('O servidor respondeu HTTP 200');
    expect(cors.description).toContain('não é confirmado');
    const sameOrigin = requestFailureRule.evaluate(req({ state: 'failed', status: 0, error: 'TypeError: Failed to fetch' }), ctx)!;
    expect(sameOrigin.ruleId).toBe('net.failure');
  });

  it('reports HTML returned to an API call and invalid JSON', () => {
    expect(unexpectedResponseRule.evaluate(req({ mimeType: 'text/html; charset=utf-8', responseBody: '<!doctype html>' }), ctx)!.title).toContain('HTML');
    expect(unexpectedResponseRule.evaluate(req({ mimeType: 'application/json', responseBody: '{"a":' }), ctx)!.title).toContain('JSON inválido');
    expect(unexpectedResponseRule.evaluate(req({ mimeType: 'application/json', responseBody: '{"a":1}' }), ctx)).toBeNull();
  });
});

describe('performance rules', () => {
  const timing = { stalled: 5, dns: 0, connect: 0, ssl: 0, waiting: 2600, download: 100 };

  it('reports slow requests and tells TTFB apart from download', () => {
    const f = slowRequestRule.evaluate(req({ duration: 2800, timing }), ctx)!;
    expect(f.severity).toBe('medium');
    expect(f.evidence.join(' ')).toContain('TTFB');
    expect(f.causes[0]).toContain('esperando o servidor');
  });

  it('does not guess phases without timing data', () => {
    const f = slowRequestRule.evaluate(req({ duration: 1500 }), ctx)!;
    expect(f.evidence.join(' ')).toContain('não é possível separar o TTFB');
  });

  it('ignores fast and cached requests', () => {
    expect(slowRequestRule.evaluate(req({ duration: 300 }), ctx)).toBeNull();
    expect(slowRequestRule.evaluate(req({ duration: 3000, fromCache: true }), ctx)).toBeNull();
  });

  it('reports large resources and mentions missing compression only with headers', () => {
    const big = largeResourceRule.evaluate(req({ type: 'script', transferSize: 2_000_000, responseHeaders: {} }), ctx)!;
    expect(big.causes.join(' ')).toContain('sem compressão');
    const noHeaders = largeResourceRule.evaluate(req({ type: 'script', transferSize: 2_000_000 }), ctx)!;
    expect(noHeaders.causes.join(' ')).not.toContain('sem compressão');
    expect(largeResourceRule.evaluate(req({ transferSize: 10_000 }), ctx)).toBeNull();
  });

  it('needs the configured number of identical calls inside the window', () => {
    const rule = duplicateRequestRule();
    expect(rule.evaluate(req({ startTime: 0 }), ctx)).toBeNull();
    expect(rule.evaluate(req({ startTime: 100 }), ctx)).toBeNull(); // 2x: e.g. React StrictMode
    const f = rule.evaluate(req({ startTime: 200 }), ctx)!;
    expect(f.related).toHaveLength(2);
    expect(f.impact).toContain('não é possível afirmar');
    expect(duplicateRequestRule().evaluate(req({ startTime: 0, method: 'POST', requestBody: 'a' }), ctx)).toBeNull();
  });

  it('does not count the same request twice when re-evaluated', () => {
    const rule = duplicateRequestRule();
    const r = req({ startTime: 0 });
    rule.evaluate(r, ctx);
    rule.evaluate(r, ctx);
    expect(rule.evaluate(r, ctx)).toBeNull();
  });
});
