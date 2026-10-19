import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../analysis/diagnostics/types';
import type { LogGroup } from '../analysis/groups';
import type { Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { buildReport, githubIssueUrl, toGitHubIssue, toJson, toMarkdown, type ReportEnvironment } from './bugReport';

const ORIGIN = 'https://app.test';
const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U';
const T = Date.UTC(2026, 9, 19, 15, 0, 0);
const env: ReportEnvironment = { userAgent: 'Mozilla/5.0 Test', browser: 'Google Chrome 141', platform: 'macOS', viewport: '1440×900 @2x', language: 'pt-BR', timeZone: 'UTC' };

const failed: NetworkEntry = { id: 'r1', url: `${ORIGIN}/api/login?token=${JWT}`, method: 'POST', status: 500, statusText: '', type: 'fetch', state: 'done', startTime: T, duration: 320, timing: { stalled: 0, dns: 0, connect: 0, ssl: 0, waiting: 300, download: 5 }, responseBody: `{"token":"${JWT}"}` };
const ok: NetworkEntry = { ...failed, id: 'r2', url: `${ORIGIN}/api/ok`, status: 200, startTime: T + 10 };
const error: ConsoleEntry = { id: 'c1', level: 'error', prefix: 'Uncaught', time: T + 500, args: [{ t: 'error', name: 'TypeError', message: `bad token ${JWT} for ana@empresa.com`, stack: `TypeError: x\n    at login (${ORIGIN}/src/login.ts:4:2)` }], group: 'g1', request: 'r1' };
const group: LogGroup = { key: 'g1', level: 'error', sample: error, count: 7, firstTime: T + 100, lastTime: T + 500 };
const diag = (id: string, severity: Diagnostic['severity'], related: Diagnostic['related']): Diagnostic => ({
  id,
  ruleId: id,
  category: 'network',
  severity,
  title: `Problema ${id}`,
  description: 'desc | com pipe',
  evidence: [`POST /api/login → HTTP 500 com ${JWT}`],
  causes: ['Exceção no servidor.'],
  impact: 'Login falha.',
  recommendations: ['Ver logs.'],
  count: 2,
  firstTime: T,
  lastTime: T + 600,
  related,
});
const snap: Snapshot = {
  requests: [failed, ok],
  logs: [error],
  groups: [group],
  diagnostics: [diag('d-low', 'low', [{ kind: 'request', id: 'r2' }]), diag('d-high', 'high', [{ kind: 'request', id: 'r1' }]), diag('d-info', 'info', [])],
  dismissed: new Set(),
  errors: 1,
  warnings: 0,
  recording: true,
};
const base = { pageUrl: `${ORIGIN}/conta?session=abc#x`, pageOrigin: ORIGIN, environment: env, now: new Date(T + 1000) };

describe('buildReport', () => {
  it('selects active, non-informational diagnostics by relevance and the related events', () => {
    const rep = buildReport(snap, base);
    expect(rep.diagnostics.map((d) => d.title)).toEqual(['Problema d-high', 'Problema d-low']);
    expect(rep.title).toBe('Problema d-high em app.test');
    expect(rep.errors).toHaveLength(1);
    expect(rep.errors[0].count).toBe(7);
    expect(rep.requests.map((q) => q.url)).toEqual([`${ORIGIN}/api/ok`, `${ORIGIN}/api/login?token=…`]);
    expect(rep.correlations[0]).toContain('confiança alta');
  });

  it('can be scoped to chosen diagnostics', () => {
    const rep = buildReport(snap, { ...base, diagnosticIds: ['d-low'] });
    expect(rep.diagnostics).toHaveLength(1);
    expect(rep.requests.map((q) => q.url)).toEqual([`${ORIGIN}/api/ok`]);
    expect(rep.errors).toEqual([]);
  });

  it('masks secrets and personal data everywhere, and keeps no query values', () => {
    const rep = buildReport(snap, { ...base, steps: [`Logar com ana@empresa.com e senha password=hunter2`] });
    const all = [toMarkdown(rep), toJson(rep), toGitHubIssue(rep).body].join('\n');
    for (const secret of [JWT, 'ana@empresa.com', 'hunter2', 'abc', '#x']) expect(all).not.toContain(secret);
    expect(rep.url).toBe(`${ORIGIN}/conta?session=…`);
    expect(rep.redactions.total).toBeGreaterThan(0);
  });

  it('honours the sections to include and the user edits', () => {
    const rep = buildReport(snap, { ...base, title: 'Login quebra', summary: 'Ao logar, erro 500.', steps: ['Abrir /login', ' ', 'Enviar'], include: { requests: false } });
    expect(rep.title).toBe('Login quebra');
    expect(rep.steps).toEqual(['Abrir /login', 'Enviar']);
    expect(rep.requests).toEqual([]);
    expect(rep.correlations).toEqual([]);
  });
});

describe('renderers', () => {
  const rep = buildReport(snap, { ...base, steps: ['Abrir /login'] });

  it('renders Markdown with facts and hypotheses labelled', () => {
    const md = toMarkdown(rep);
    expect(md.startsWith('# Problema d-high em app.test\n')).toBe(true);
    expect(md).toContain('## Passos para reproduzir\n\n1. Abrir /login');
    expect(md).toContain('**Evidências (observado nos dados capturados):**');
    expect(md).toContain('**Possíveis causas (hipóteses, não confirmadas):**');
    expect(md).toContain('| 15:00:00 | POST |');
    expect(md).toContain('desc | com pipe'); // plain text outside tables is left as is
  });

  it('puts a placeholder when no steps were given', () => {
    expect(toMarkdown(buildReport(snap, base))).toContain('_(descreva os passos para reproduzir)_');
  });

  it('renders a GitHub issue with collapsible long sections', () => {
    const issue = toGitHubIssue(rep);
    expect(issue.title).toBe(rep.title);
    expect(issue.body).toContain('<details>\n<summary><b>Erros relevantes (1)</b></summary>');
    expect(issue.body).not.toMatch(/^# /m);
  });

  it('exports JSON with a version and without internal fields', () => {
    const json = JSON.parse(toJson(rep));
    expect(json.version).toBe(1);
    expect(json.redactions).toBeUndefined();
    expect(typeof json.redactedValues).toBe('number');
  });
});

describe('githubIssueUrl', () => {
  it('builds a new-issue url and drops the body when it would be too long', () => {
    expect(githubIssueUrl('acme/app', { title: 'T', body: 'B' })).toEqual({ url: 'https://github.com/acme/app/issues/new?title=T&body=B', bodyIncluded: true });
    expect(githubIssueUrl('https://github.com/acme/app.git', { title: 'T', body: 'x'.repeat(9000) })).toEqual({ url: 'https://github.com/acme/app/issues/new?title=T', bodyIncluded: false });
    expect(githubIssueUrl('not a repo', { title: 'T', body: 'B' })).toBeUndefined();
  });
});

describe('environment section', () => {
  it('can be left out while keeping URL, date and time zone', () => {
    const rep = buildReport(snap, { ...base, include: { environment: false } });
    expect(rep.environment).toBeUndefined();
    const md = toMarkdown(rep);
    expect(md).toContain('| URL |');
    expect(md).not.toContain('User agent');
  });
});

describe('scope', () => {
  it("'all' keeps every error and failed request besides the chosen diagnostics", () => {
    const rep = buildReport(snap, { ...base, diagnosticIds: ['d-low'], scope: 'all' });
    expect(rep.errors).toHaveLength(1);
    expect(rep.requests.map((q) => q.url)).toEqual([`${ORIGIN}/api/ok`, `${ORIGIN}/api/login?token=…`]);
  });
});
