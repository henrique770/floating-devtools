/**
 * Bug report built from what was captured: a structured object (exported as JSON) and its
 * Markdown / GitHub issue renderings. Every captured string goes through redaction, URLs lose
 * their query values, and only diagnostics, errors and requests relevant to the report are kept.
 */
import { CONFIDENCE_LABEL, relatedRequests } from '../analysis/correlate';
import { severityRank, type Diagnostic, type Severity } from '../analysis/diagnostics/types';
import { redact, type Redaction } from '../analysis/redact';
import { safeUrl } from '../analysis/url';
import type { Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { formatMs, isErrorEntry, statusLabel } from './format';
import { CATEGORY_LABEL, SEVERITY_LABEL } from './labels';
import { preview } from './ValueView';

export const REPORT_VERSION = 1;
const MAX_ERRORS = 10;
const MAX_REQUESTS = 15;
const MAX_CORRELATIONS = 10;
const STACK_LINES = 6;

export interface ReportEnvironment {
  userAgent: string;
  browser?: string;
  platform?: string;
  viewport: string;
  language: string;
  timeZone: string;
}

export interface ReportError {
  message: string;
  level: string;
  count: number;
  firstSeen: string;
  lastSeen: string;
  source?: string;
  stack?: string;
}

export interface ReportRequest {
  method: string;
  url: string;
  status: string;
  durationMs?: number;
  ttfbMs?: number;
  type: string;
  error?: string;
  at: string;
}

export interface ReportDiagnostic {
  title: string;
  severity: Severity;
  category: string;
  count: number;
  description: string;
  evidence: string[];
  possibleCauses: string[];
  impact: string;
  recommendations: string[];
}

export interface BugReport {
  version: number;
  title: string;
  summary: string;
  url: string;
  generatedAt: string;
  /** First and last captured event that made it into the report. */
  period?: { from: string; to: string };
  /** Time zone used to show times (always kept, even without the environment section). */
  timeZone: string;
  environment?: ReportEnvironment;
  steps: string[];
  diagnostics: ReportDiagnostic[];
  errors: ReportError[];
  requests: ReportRequest[];
  /** "error ← request (confidence: reason)" lines, only medium/high confidence. */
  correlations: string[];
  redactions: Pick<Redaction, 'found' | 'total'>;
}

export interface ReportOptions {
  /** Diagnostics to report; defaults to every active, non-informational one. */
  diagnosticIds?: string[];
  /**
   * Which errors/requests go in: only those behind the chosen diagnostics ('related'), or every
   * error and failed request too ('all'). Defaults to 'related' when diagnosticIds is given.
   */
  scope?: 'related' | 'all';
  title?: string;
  summary?: string;
  steps?: string[];
  include?: { environment?: boolean; errors?: boolean; requests?: boolean; diagnostics?: boolean };
  now?: Date;
  pageUrl?: string;
  pageOrigin?: string;
  environment?: ReportEnvironment;
}

function collector() {
  const found: Redaction['found'] = {};
  let total = 0;
  const run = (s: string) => {
    const r = redact(s);
    for (const [k, n] of Object.entries(r.found) as [keyof Redaction['found'], number][]) found[k] = (found[k] ?? 0) + n;
    total += r.total;
    return r.text;
  };
  return { run, result: () => ({ found, total }) };
}

const iso = (epoch: number) => new Date(epoch).toISOString();
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function currentEnvironment(): ReportEnvironment {
  const nav = navigator as Navigator & { userAgentData?: { brands?: { brand: string; version: string }[]; platform?: string } };
  const brand = nav.userAgentData?.brands?.find((b) => !/Not.?A.?Brand|Chromium/i.test(b.brand)) ?? nav.userAgentData?.brands?.[0];
  return {
    userAgent: navigator.userAgent,
    browser: brand ? `${brand.brand} ${brand.version}` : undefined,
    platform: nav.userAgentData?.platform || undefined,
    viewport: `${window.innerWidth}×${window.innerHeight} @${window.devicePixelRatio}x`,
    language: navigator.language,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Diagnostics selected by default: active and not informational, most relevant first. */
export function defaultDiagnostics(snap: Snapshot): Diagnostic[] {
  return snap.diagnostics
    .filter((d) => !snap.dismissed.has(d.id) && d.severity !== 'info')
    .sort((a, b) => severityRank(a.severity) - severityRank(b.severity) || b.count - a.count);
}

export function buildReport(snap: Snapshot, opts: ReportOptions = {}): BugReport {
  const red = collector();
  const r = red.run;
  const include = { environment: true, errors: true, requests: true, diagnostics: true, ...opts.include };
  const pageUrl = opts.pageUrl ?? location.href;
  const pageOrigin = opts.pageOrigin ?? location.origin;
  const now = opts.now ?? new Date();

  const selected = opts.diagnosticIds
    ? opts.diagnosticIds.map((id) => snap.diagnostics.find((d) => d.id === id)).filter((d): d is Diagnostic => !!d)
    : defaultDiagnostics(snap);
  const scoped = opts.scope ? opts.scope === 'related' : !!opts.diagnosticIds;

  // Events: those behind the selected diagnostics; without a selection, every error and failed request.
  const relatedLogIds = new Set(selected.flatMap((d) => d.related.filter((x) => x.kind === 'log').map((x) => x.id)));
  const relatedRequestIds = new Set(selected.flatMap((d) => d.related.filter((x) => x.kind === 'request').map((x) => x.id)));

  const errorGroups = snap.groups.filter((g) => g.level === 'error' && (!scoped || snap.logs.some((l) => l.group === g.key && relatedLogIds.has(l.id))));
  const groupSamples = [...errorGroups].sort((a, b) => b.count - a.count).slice(0, MAX_ERRORS);
  const errors: ReportError[] = groupSamples.map((g) => {
    const e = g.sample;
    const stack = errorStack(e)
      ?.split('\n')
      .filter((l) => l.trim().startsWith('at '))
      .slice(0, STACK_LINES)
      .map((l) => l.trim())
      .join('\n');
    return {
      message: clip(r(messageOf(e)), 500),
      level: e.level,
      count: g.count,
      firstSeen: iso(g.firstTime),
      lastSeen: iso(g.lastTime),
      source: e.source ? r(`${e.source.label} (${safeUrl(e.source.url.replace(/:\d+$/, ''))})`) : undefined,
      stack: stack ? r(stack) : undefined,
    };
  });

  const requestPool = snap.requests.filter((q) => (scoped ? relatedRequestIds.has(q.id) : isErrorEntry(q) || relatedRequestIds.has(q.id)));
  const requests: ReportRequest[] = requestPool
    .slice(-MAX_REQUESTS)
    .reverse()
    .map((q) => ({
      method: q.method,
      url: safeUrl(q.url),
      status: statusLabel(q),
      durationMs: q.duration !== undefined ? Math.round(q.duration) : undefined,
      ttfbMs: q.timing ? Math.round(q.timing.waiting) : undefined,
      type: q.type,
      error: q.error ? r(q.error) : undefined,
      at: iso(q.startTime),
    }));

  const byId = new Map(snap.requests.map((q) => [q.id, q]));
  const correlations: string[] = [];
  for (const g of groupSamples) {
    for (const c of relatedRequests(g.sample, snap.requests, pageOrigin)) {
      if (c.confidence === 'low' || correlations.length >= MAX_CORRELATIONS) continue;
      const q = byId.get(c.ref.id)!;
      correlations.push(r(`${clip(messageOf(g.sample), 120)} ← ${q.method} ${safeUrl(q.url)} → ${statusLabel(q)} (confiança ${CONFIDENCE_LABEL[c.confidence].toLowerCase()}: ${c.reason})`));
    }
  }

  const diagnostics: ReportDiagnostic[] = selected.map((d) => ({
    title: r(d.title),
    severity: d.severity,
    category: CATEGORY_LABEL[d.category],
    count: d.count,
    description: r(d.description),
    evidence: d.evidence.map(r),
    possibleCauses: d.causes.map(r),
    impact: r(d.impact),
    recommendations: d.recommendations.map(r),
  }));

  const times = [...groupSamples.flatMap((g) => [g.firstTime, g.lastTime]), ...requestPool.map((q) => q.startTime), ...selected.flatMap((d) => [d.firstTime, d.lastTime])];
  const host = (() => {
    try {
      return new URL(pageUrl).host;
    } catch {
      return '';
    }
  })();
  const top = selected[0];
  const environment = opts.environment ?? currentEnvironment();

  return {
    version: REPORT_VERSION,
    title: r(opts.title?.trim() || (top ? `${top.title}${host ? ` em ${host}` : ''}` : `Problemas encontrados${host ? ` em ${host}` : ''}`)),
    summary: r(opts.summary?.trim() || defaultSummary(selected, snap)),
    url: safeUrl(pageUrl, 400),
    generatedAt: now.toISOString(),
    period: times.length ? { from: iso(Math.min(...times)), to: iso(Math.max(...times)) } : undefined,
    timeZone: environment.timeZone,
    environment: include.environment ? environment : undefined,
    steps: (opts.steps ?? []).map((s) => r(s.trim())).filter(Boolean),
    diagnostics: include.diagnostics ? diagnostics : [],
    errors: include.errors ? errors : [],
    requests: include.requests ? requests : [],
    correlations: include.errors && include.requests ? correlations : [],
    redactions: red.result(),
  };
}

function defaultSummary(selected: Diagnostic[], snap: Snapshot): string {
  if (!selected.length) return `Nenhum diagnóstico automático. Capturados: ${snap.errors} erros e ${snap.requests.filter(isErrorEntry).length} requisições com falha.`;
  const high = selected.filter((d) => d.severity === 'high').length;
  const list = selected
    .slice(0, 3)
    .map((d) => d.title)
    .join('; ');
  return `${selected.length} problema(s) identificado(s) automaticamente${high ? `, ${high} de severidade alta` : ''}: ${list}${selected.length > 3 ? '…' : '.'}`;
}

const messageOf = (l: ConsoleEntry) => `${l.prefix ? `${l.prefix} ` : ''}${l.args.map((a) => preview(a)).join(' ')}`;

function errorStack(l: ConsoleEntry): string | undefined {
  for (const a of l.args) if (a.t === 'error' && a.stack) return a.stack;
  return l.stack;
}

// ------------------------------------------------------------------ renderers

const cell = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const code = (s: string) => {
  const ticks = s.includes('`') ? '``' : '`';
  return `${ticks}${s}${ticks}`;
};
const fence = (s: string) => {
  const ticks = s.includes('```') ? '````' : '```';
  return `${ticks}\n${s}\n${ticks}`;
};
const dateTime = (isoString: string, timeZone: string) =>
  new Date(isoString).toLocaleString('pt-BR', { timeZone, dateStyle: 'short', timeStyle: 'medium' });
const time = (isoString: string, timeZone: string) => new Date(isoString).toLocaleTimeString('pt-BR', { timeZone });

function environmentTable(rep: BugReport): string {
  const e = rep.environment;
  const tz = rep.timeZone;
  const rows: [string, string][] = [
    ['URL', code(rep.url)],
    ['Data', `${dateTime(rep.generatedAt, tz)} (${tz})`],
  ];
  if (rep.period) rows.push(['Período dos eventos', `${time(rep.period.from, tz)} – ${time(rep.period.to, tz)}`]);
  if (e) {
    if (e.browser) rows.push(['Navegador', `${e.browser}${e.platform ? ` · ${e.platform}` : ''}`]);
    rows.push(['Viewport', e.viewport], ['Idioma', e.language], ['User agent', code(e.userAgent)]);
  }
  return ['| | |', '|---|---|', ...rows.map(([k, v]) => `| ${k} | ${cell(v)} |`)].join('\n');
}

function diagnosticsSection(rep: BugReport): string {
  return rep.diagnostics
    .map((d) =>
      [
        `### [${SEVERITY_LABEL[d.severity]}] ${d.title}`,
        `${d.category} · ${d.count} ${d.count === 1 ? 'ocorrência' : 'ocorrências'}`,
        '',
        d.description,
        '',
        '**Evidências (observado nos dados capturados):**',
        ...d.evidence.map((x) => `- ${x}`),
        ...(d.possibleCauses.length ? ['', '**Possíveis causas (hipóteses, não confirmadas):**', ...d.possibleCauses.map((x) => `- ${x}`)] : []),
        '',
        `**Impacto potencial:** ${d.impact}`,
        ...(d.recommendations.length ? ['', '**Recomendações:**', ...d.recommendations.map((x) => `- ${x}`)] : []),
      ].join('\n'),
    )
    .join('\n\n');
}

function errorsSection(rep: BugReport): string {
  const tz = rep.timeZone;
  return rep.errors
    .map((e) =>
      [
        `- ${code(e.message)} — ${e.count}× (primeira ${time(e.firstSeen, tz)}, última ${time(e.lastSeen, tz)})${e.source ? ` em ${e.source}` : ''}`,
        ...(e.stack ? ['', fence(e.stack).replace(/^/gm, '  ')] : []),
      ].join('\n'),
    )
    .join('\n');
}

function requestsSection(rep: BugReport): string {
  const tz = rep.timeZone;
  return [
    '| Horário | Método | URL | Status | Duração | TTFB |',
    '|---|---|---|---|---|---|',
    ...rep.requests.map(
      (q) =>
        `| ${time(q.at, tz)} | ${q.method} | ${cell(code(q.url))} | ${cell(q.status)}${q.error ? ` (${cell(q.error)})` : ''} | ${q.durationMs !== undefined ? formatMs(q.durationMs) : '—'} | ${q.ttfbMs !== undefined ? formatMs(q.ttfbMs) : '—'} |`,
    ),
  ].join('\n');
}

const STEPS_PLACEHOLDER = '1. _(descreva os passos para reproduzir)_';
const FOOTER = '_Gerado pelo Floating DevTools a partir dos dados capturados na página. Valores sensíveis foram mascarados automaticamente — revise antes de compartilhar. Causas listadas são hipóteses._';

function body(rep: BugReport, collapsible: boolean): string {
  const wrap = (title: string, content: string) =>
    collapsible ? `<details>\n<summary><b>${title}</b></summary>\n\n${content}\n\n</details>` : `## ${title}\n\n${content}`;
  const parts = [
    `**Resumo:** ${rep.summary}`,
    collapsible ? `### Ambiente\n\n${environmentTable(rep)}` : `## Ambiente\n\n${environmentTable(rep)}`,
    `${collapsible ? '###' : '##'} Passos para reproduzir\n\n${rep.steps.length ? rep.steps.map((s, i) => `${i + 1}. ${s}`).join('\n') : STEPS_PLACEHOLDER}`,
  ];
  if (rep.diagnostics.length) parts.push(collapsible ? `### Diagnósticos\n\n${diagnosticsSection(rep).replace(/^### /gm, '#### ')}` : `## Diagnósticos\n\n${diagnosticsSection(rep)}`);
  if (rep.errors.length) parts.push(wrap(`Erros relevantes (${rep.errors.length})`, errorsSection(rep)));
  if (rep.requests.length) parts.push(wrap(`Requisições relacionadas (${rep.requests.length})`, requestsSection(rep)));
  if (rep.correlations.length) parts.push(wrap('Relações entre erros e requisições', rep.correlations.map((c) => `- ${c}`).join('\n')));
  parts.push('---', FOOTER);
  return parts.join('\n\n');
}

export function toMarkdown(rep: BugReport): string {
  return `# ${rep.title}\n\n${body(rep, false)}\n`;
}

/** Body for a GitHub issue (title goes separately); long sections are collapsible. */
export function toGitHubIssue(rep: BugReport): { title: string; body: string } {
  return { title: rep.title, body: `${body(rep, true)}\n` };
}

export function toJson(rep: BugReport): string {
  const { redactions, ...rest } = rep;
  return `${JSON.stringify({ ...rest, redactedValues: redactions.total, generator: 'floating-devtools' }, null, 2)}\n`;
}

/** GitHub "new issue" URL, or undefined when the body is too long for a URL (copy it instead). */
export function githubIssueUrl(repo: string, issue: { title: string; body: string }): { url: string; bodyIncluded: boolean } | undefined {
  const m = repo.trim().match(/^(?:https?:\/\/github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  if (!m) return undefined;
  const base = `https://github.com/${m[1]}/${m[2]}/issues/new`;
  const full = `${base}?title=${encodeURIComponent(issue.title)}&body=${encodeURIComponent(issue.body)}`;
  if (full.length <= 7500) return { url: full, bodyIncluded: true };
  return { url: `${base}?title=${encodeURIComponent(issue.title)}`, bodyIncluded: false };
}
