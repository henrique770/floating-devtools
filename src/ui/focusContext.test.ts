import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Diagnostic } from '../analysis/diagnostics/types';
import type { Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { buildPayload } from './assistantContext';
import { buildFocusContext, quickActions } from './focusContext';

const ORIGIN = 'https://app.test';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';

const request: NetworkEntry = {
  id: 'r1',
  url: `${ORIGIN}/api/user?session=abc123`,
  method: 'GET',
  status: 500,
  statusText: '',
  type: 'fetch',
  state: 'done',
  startTime: 1000,
  duration: 300,
  timing: { stalled: 1, dns: 0, connect: 0, ssl: 0, waiting: 250, download: 20 },
  requestHeaders: { accept: 'application/json', authorization: `Bearer ${JWT}`, cookie: 'sid=secret' },
  responseHeaders: { 'content-type': 'application/json', 'set-cookie': 'sid=other', 'x-request-id': 'req-9' },
  responseBody: `{"error":"boom","token":"${JWT}"}`,
  initiator: `at loadUser (${ORIGIN}/src/user.ts:3:1)`,
};
const error: ConsoleEntry = {
  id: 'c1',
  level: 'error',
  prefix: 'Uncaught (in promise)',
  time: 1400,
  args: [{ t: 'error', name: 'TypeError', message: "Cannot read properties of undefined (reading 'name')", stack: `TypeError: x\n    at loadUser (${ORIGIN}/src/user.ts:9:1)` }],
  request: 'r1',
};
const diagnostic: Diagnostic = {
  id: 'net.http-error:x',
  ruleId: 'net.http-error',
  category: 'network',
  severity: 'high',
  title: 'Erro do servidor (HTTP 500)',
  description: 'GET app.test respondeu com status 500.',
  evidence: ['GET /api/user → HTTP 500'],
  causes: ['Exceção não tratada no servidor.'],
  impact: 'A operação não foi concluída.',
  recommendations: ['Consulte os logs do servidor.'],
  count: 1,
  firstTime: 1000,
  lastTime: 1000,
  related: [{ kind: 'request', id: 'r1' }],
};
const snap: Snapshot = { requests: [request], logs: [error], groups: [], diagnostics: [diagnostic], dismissed: new Set(), errors: 1, warnings: 0, recording: true };

beforeAll(() => vi.stubGlobal('location', { origin: ORIGIN, href: `${ORIGIN}/` }));
afterAll(() => vi.unstubAllGlobals());

describe('buildFocusContext', () => {
  it('describes a console error with its related request and confidence', () => {
    const ctx = buildFocusContext({ kind: 'log', id: 'c1' }, snap)!;
    expect(ctx.title).toContain('TypeError');
    expect(ctx.text).toContain('### Requisições possivelmente relacionadas');
    expect(ctx.text).toContain('confiança alta');
    expect(ctx.text).toContain('loadUser');
  });

  it('describes a request with safe headers only and masked bodies', () => {
    const ctx = buildFocusContext({ kind: 'request', id: 'r1' }, snap)!;
    expect(ctx.text).toContain('TTFB 250 ms');
    expect(ctx.text).toContain('x-request-id: req-9');
    expect(ctx.text).toContain('accept: application/json');
    for (const secret of [JWT, 'sid=secret', 'sid=other', 'abc123', 'authorization']) expect(ctx.text).not.toContain(secret);
    expect(ctx.text).toContain('[REDACTED:jwt]');
    expect(ctx.text).toContain('### Logs possivelmente relacionados');
    expect(ctx.text).toContain('Erro do servidor (HTTP 500)');
    expect(ctx.redactions.total).toBeGreaterThan(0);
  });

  it('describes a diagnostic keeping evidence and hypotheses apart', () => {
    const ctx = buildFocusContext({ kind: 'diagnostic', id: diagnostic.id }, snap)!;
    expect(ctx.text).toContain('evidências (fatos observados)');
    expect(ctx.text).toContain('hipóteses locais (não confirmadas)');
    expect(ctx.text).toContain('### Ocorrência mais recente');
  });

  it('returns null for items no longer captured, and stays bounded', () => {
    expect(buildFocusContext({ kind: 'log', id: 'gone' }, snap)).toBeNull();
    const huge = { ...snap, requests: [{ ...request, responseBody: 'x'.repeat(200_000) }] };
    expect(buildFocusContext({ kind: 'request', id: 'r1' }, huge)!.text.length).toBeLessThanOrEqual(12_001);
  });
});

describe('quickActions', () => {
  it('offers actions that fit the focused item', () => {
    const forLog = quickActions(buildFocusContext({ kind: 'log', id: 'c1' }, snap), snap).map((a) => a.label);
    expect(forLog).toContain('Explique este erro');
    expect(quickActions(buildFocusContext({ kind: 'request', id: 'r1' }, snap), snap).map((a) => a.label)).toContain('Analise esta requisição');
    expect(quickActions(null, snap)[0].label).toBe('Resuma os problemas da sessão');
  });
});

describe('buildPayload with focus', () => {
  it('puts the item in focus before the page overview, inside the data block', () => {
    const [, user] = buildPayload([{ role: 'user', content: 'Como corrigir?' }], 'overview', { title: 'GET user → 500', text: 'details' });
    expect(user.content).toBe('<dados_capturados>\n## Item em foco: GET user → 500\ndetails\n\n## Visão geral da página\noverview\n</dados_capturados>\n\nComo corrigir?');
  });
});
