/**
 * Structured context about ONE item the developer chose to investigate (a console error, a
 * request or a diagnostic): the item in detail plus only what is related to it. Sent to the AI
 * provider ahead of the page overview, after masking, and bounded in size.
 */
import { confidenceLabel, relatedLogs, relatedRequests, type Correlation } from '../analysis/correlate';
import type { Diagnostic, EventRef } from '../analysis/diagnostics/types';
import { redact, type Redaction } from '../analysis/redact';
import { safeUrl } from '../analysis/url';
import { defineMessages } from '../i18n';
import type { Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { bodyNoteText, formatBytes, formatClock, formatMs, shortName, statusLabel } from './format';
import { categoryLabel, severityLabel } from './labels';
import { preview } from './ValueView';

type ActionKey =
  | 'summarize'
  | 'firstErrors'
  | 'lastError'
  | 'failing'
  | 'performance'
  | 'improve'
  | 'explainError'
  | 'errorCause'
  | 'fixError'
  | 'relatedRequests'
  | 'prevent'
  | 'analyzeRequest'
  | 'whyFailed'
  | 'requestPerf'
  | 'fixRequest'
  | 'explainDiagnostic'
  | 'diagnosticCause'
  | 'investigate'
  | 'fixDiagnostic';

const m = defineMessages({
  pt: {
    time: 'horário',
    source: 'origem',
    equivalent: (n: number, first: string, last: string) => `ocorrências equivalentes: ${n} (primeira ${first}, última ${last})`,
    timing: (start: string, total: string) => `horário: ${start} · duração total ${total}`,
    phases: (ttfb: string, download: string, queue: string) => ` · TTFB ${ttfb} · download ${download} · fila/conexão ${queue}`,
    noPhases: ' · sem fases de timing',
    sizes: (transferred: string, body: string, cached: boolean) => `transferido ${transferred} · corpo ${body}${cached ? ' · servido do cache' : ''}`,
    pageError: 'erro na página',
    web: (detail: string) => `visto pela extensão (webRequest): ${detail}`,
    serverAnswered: (status: number) => `servidor respondeu HTTP ${status}`,
    noAnswer: 'sem resposta',
    params: 'parâmetros de query (só nomes)',
    requestHeaders: 'headers de requisição (seleção sem credenciais)',
    responseHeaders: 'headers de resposta (seleção sem credenciais)',
    initiator: 'iniciador',
    payload: 'payload',
    response: 'resposta',
    empty: '(vazia)',
    relation: (level: string, reason: string) => `relação: confiança ${level} — ${reason}`,
    noRelation: 'nenhuma relação encontrada nos dados capturados',
    diagnosticHead: (title: string, category: string, severity: string, count: number, first: string, last: string) =>
      `${title} (${category}, severidade ${severity}, ${count === 1 ? '1 ocorrência' : `${count} ocorrências`}, primeira ${first}, última ${last})`,
    evidence: 'evidências (fatos observados)',
    hypotheses: 'hipóteses locais (não confirmadas)',
    impact: 'impacto potencial',
    recommendations: 'recomendações locais',
    consoleMessage: '### Mensagem do console',
    relatedRequests: '### Requisições possivelmente relacionadas',
    diagnosticWithLog: '### Diagnóstico local que inclui esta mensagem',
    request: '### Requisição',
    relatedLogs: '### Logs possivelmente relacionados',
    diagnosticWithRequest: '### Diagnóstico local que inclui esta requisição',
    diagnostic: '### Diagnóstico',
    latest: '### Ocorrência mais recente',
    others: (shown: number, total: number) => `### Outras ocorrências (${shown} de ${total})`,
    actions: {
      summarize: ['Resuma os problemas da sessão', 'Resuma os problemas desta sessão, do mais grave ao menos grave, separando o que é da aplicação do que é ruído de terceiros.'],
      firstErrors: ['Quais erros devo resolver primeiro?'],
      lastError: ['Explique o último erro do console'],
      failing: ['Por que essas requisições estão falhando?'],
      performance: ['Existe algum problema de performance?'],
      improve: ['Recomende melhorias'],
      explainError: ['Explique este erro', 'Explique este erro: o que aconteceu e onde, com base no stack e nos dados.'],
      errorCause: ['Qual pode ser a causa?', 'Quais são as causas possíveis deste erro? Diga quais os dados sustentam e quais são só hipóteses.'],
      fixError: ['Como corrigir?', 'Como corrigir este erro? Mostre um exemplo de código se ajudar.'],
      relatedRequests: ['Analise as requisições relacionadas', 'As requisições relacionadas explicam este erro? Avalie a confiança de cada relação.'],
      prevent: ['Como evitar que se repita?'],
      analyzeRequest: ['Analise esta requisição', 'Analise esta requisição: status, timing, headers e resposta. Há algo errado?'],
      whyFailed: ['Por que ela falhou?', 'Por que esta requisição falhou ou retornou este status? Separe fatos de hipóteses.'],
      requestPerf: ['Existe problema de performance?', 'Esta requisição tem problema de performance? Separe TTFB de download e diga o que melhorar.'],
      fixRequest: ['Como corrigir?', 'Como corrigir o problema desta requisição, no cliente e/ou no servidor? Mostre código se ajudar.'],
      explainDiagnostic: ['Explique este diagnóstico', 'Explique este diagnóstico e o impacto dele.'],
      diagnosticCause: ['Qual pode ser a causa?', 'Quais hipóteses deste diagnóstico os dados sustentam? O que falta para confirmar?'],
      investigate: ['Como investigar?', 'Quais os próximos passos para investigar e confirmar a causa?'],
      fixDiagnostic: ['Como corrigir?', 'Como corrigir? Mostre um exemplo de código se ajudar.'],
    } as Record<ActionKey, [string, string?]>,
  },
  en: {
    time: 'time',
    source: 'source',
    equivalent: (n, first, last) => `equivalent occurrences: ${n} (first ${first}, last ${last})`,
    timing: (start, total) => `time: ${start} · total duration ${total}`,
    phases: (ttfb, download, queue) => ` · TTFB ${ttfb} · download ${download} · queue/connection ${queue}`,
    noPhases: ' · no timing phases',
    sizes: (transferred, body, cached) => `transferred ${transferred} · body ${body}${cached ? ' · served from cache' : ''}`,
    pageError: 'error on the page',
    web: (detail) => `seen by the extension (webRequest): ${detail}`,
    serverAnswered: (status) => `server responded HTTP ${status}`,
    noAnswer: 'no response',
    params: 'query parameters (names only)',
    requestHeaders: 'request headers (selection without credentials)',
    responseHeaders: 'response headers (selection without credentials)',
    initiator: 'initiator',
    payload: 'payload',
    response: 'response',
    empty: '(empty)',
    relation: (level, reason) => `link: ${level} confidence — ${reason}`,
    noRelation: 'no relation found in the captured data',
    diagnosticHead: (title, category, severity, count, first, last) =>
      `${title} (${category}, ${severity} severity, ${count === 1 ? '1 occurrence' : `${count} occurrences`}, first ${first}, last ${last})`,
    evidence: 'evidence (observed facts)',
    hypotheses: 'local hypotheses (not confirmed)',
    impact: 'potential impact',
    recommendations: 'local recommendations',
    consoleMessage: '### Console message',
    relatedRequests: '### Possibly related requests',
    diagnosticWithLog: '### Local diagnostic that includes this message',
    request: '### Request',
    relatedLogs: '### Possibly related logs',
    diagnosticWithRequest: '### Local diagnostic that includes this request',
    diagnostic: '### Diagnostic',
    latest: '### Latest occurrence',
    others: (shown, total) => `### Other occurrences (${shown} of ${total})`,
    actions: {
      summarize: ['Summarize the session problems', 'Summarize the problems in this session, from most to least severe, separating what belongs to the application from third-party noise.'],
      firstErrors: ['Which errors should I fix first?'],
      lastError: ['Explain the last console error'],
      failing: ['Why are these requests failing?'],
      performance: ['Is there any performance problem?'],
      improve: ['Recommend improvements'],
      explainError: ['Explain this error', 'Explain this error: what happened and where, based on the stack and the data.'],
      errorCause: ['What could be the cause?', 'What are the possible causes of this error? Say which ones the data supports and which are only hypotheses.'],
      fixError: ['How to fix it?', 'How do I fix this error? Show a code example if it helps.'],
      relatedRequests: ['Analyze the related requests', 'Do the related requests explain this error? Assess the confidence of each link.'],
      prevent: ['How to keep it from happening again?'],
      analyzeRequest: ['Analyze this request', 'Analyze this request: status, timing, headers and response. Is anything wrong?'],
      whyFailed: ['Why did it fail?', 'Why did this request fail or return this status? Separate facts from hypotheses.'],
      requestPerf: ['Is there a performance problem?', 'Does this request have a performance problem? Separate TTFB from download and say what to improve.'],
      fixRequest: ['How to fix it?', "How do I fix this request's problem, on the client and/or the server? Show code if it helps."],
      explainDiagnostic: ['Explain this diagnostic', 'Explain this diagnostic and its impact.'],
      diagnosticCause: ['What could be the cause?', "Which of this diagnostic's hypotheses does the data support? What is missing to confirm it?"],
      investigate: ['How to investigate?', 'What are the next steps to investigate and confirm the cause?'],
      fixDiagnostic: ['How to fix it?', 'How do I fix it? Show a code example if it helps.'],
    },
  },
});

export type FocusTarget = EventRef | { kind: 'diagnostic'; id: string };

export interface FocusContext {
  target: FocusTarget;
  /** Short name shown in the Assistant ("TypeError: x", "GET users → 500"). */
  title: string;
  text: string;
  redactions: Pick<Redaction, 'found' | 'total'>;
}

const MAX_FOCUS = 12_000;
const MESSAGE = 2000;
const REQUEST_BODY = 1500;
const RESPONSE_BODY = 3000;
const STACK_LINES = 12;
const MAX_RELATED = 5;

/** Headers that help diagnose and don't carry credentials. Everything else stays out. */
const SAFE_RESPONSE_HEADERS = [
  'content-type',
  'content-length',
  'content-encoding',
  'cache-control',
  'age',
  'etag',
  'location',
  'retry-after',
  'www-authenticate',
  'server-timing',
  'timing-allow-origin',
  'vary',
  'access-control-allow-origin',
  'access-control-allow-credentials',
  'access-control-allow-methods',
  'access-control-allow-headers',
  'access-control-expose-headers',
  'x-request-id',
  'x-correlation-id',
];
const SAFE_REQUEST_HEADERS = ['content-type', 'accept', 'content-length'];

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

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
type Redact = (s: string) => string;

const messageOf = (l: ConsoleEntry) => `${l.prefix ? `${l.prefix} ` : ''}${l.args.map((a) => preview(a)).join(' ')}`;

function errorStack(l: ConsoleEntry): string | undefined {
  for (const a of l.args) if (a.t === 'error' && a.stack) return a.stack;
  return l.stack;
}

function logDetail(l: ConsoleEntry, snap: Snapshot, r: Redact): string {
  const group = l.group ? snap.groups.find((g) => g.key === l.group) : undefined;
  const stack = errorStack(l)
    ?.split('\n')
    .filter((line) => line.trim().startsWith('at '))
    .slice(0, STACK_LINES)
    .map((line) => `    ${line.trim()}`)
    .join('\n');
  const t = m();
  return [
    `- [${l.level}] ${clip(r(messageOf(l)), MESSAGE)}`,
    `  ${t.time}: ${formatClock(l.time)}${l.source ? ` · ${t.source}: ${l.source.label} (${safeUrl(l.source.url.replace(/:\d+$/, ''))})` : ''}`,
    group && group.count > 1 && `  ${t.equivalent(group.count, formatClock(group.firstTime), formatClock(group.lastTime))}`,
    stack && `  stack:\n${r(stack)}`,
  ]
    .filter(Boolean)
    .join('\n');
}

function pickHeaders(headers: Record<string, string> | undefined, allowed: string[]) {
  if (!headers) return '';
  return allowed
    .filter((h) => headers[h] !== undefined)
    .map((h) => `${h}: ${headers[h]}`)
    .join(' · ');
}

function requestDetail(q: NetworkEntry, r: Redact, full: boolean): string {
  const t = q.timing;
  const tx = m();
  const lines = [
    `- ${q.method} ${safeUrl(q.url)} → ${statusLabel(q)} (${q.type}${q.mimeType ? `, ${q.mimeType.split(';')[0]}` : ''})`,
    `  ${tx.timing(formatClock(q.startTime), formatMs(q.duration))}${t ? tx.phases(formatMs(t.waiting), formatMs(t.download), formatMs(t.stalled + t.dns + t.connect)) : tx.noPhases}`,
    `  ${tx.sizes(formatBytes(q.transferSize), formatBytes(q.resourceSize), !!q.fromCache)}`,
    q.error && `  ${tx.pageError}: ${r(q.error)}`,
    q.web && `  ${tx.web(`${q.web.status ? tx.serverAnswered(q.web.status) : tx.noAnswer}${q.web.error ? ` · ${q.web.error}` : ''}`)}`,
  ];
  if (full) {
    const params = (() => {
      try {
        return [...new URL(q.url).searchParams.keys()];
      } catch {
        return [];
      }
    })();
    const resHeaders = pickHeaders(q.responseHeaders, SAFE_RESPONSE_HEADERS);
    const reqHeaders = pickHeaders(q.requestHeaders, SAFE_REQUEST_HEADERS);
    lines.push(
      params.length ? `  ${tx.params}: ${params.join(', ')}` : '',
      reqHeaders && `  ${tx.requestHeaders}: ${reqHeaders}`,
      resHeaders && `  ${tx.responseHeaders}: ${r(resHeaders)}`,
      q.initiator ? `  ${tx.initiator}:\n${r(q.initiator.split('\n').slice(0, 6).map((l) => `    ${l}`).join('\n'))}` : '',
      q.requestBody ? `  ${tx.payload}:\n    ${clip(r(q.requestBody), REQUEST_BODY)}` : '',
      q.responseBody !== undefined
        ? `  ${tx.response}:\n    ${q.responseBody ? clip(r(q.responseBody.trim()), RESPONSE_BODY) : tx.empty}`
        : q.responseBodyNote
          ? `  ${tx.response}: ${r(bodyNoteText(q.responseBodyNote)!)}`
          : '',
    );
  }
  return lines.filter(Boolean).join('\n');
}

function correlationLines(items: Correlation[], describe: (ref: EventRef) => string | undefined): string {
  const out = items
    .slice(0, MAX_RELATED)
    .map((c) => {
      const d = describe(c.ref);
      return d && `${d}\n  ${m().relation(confidenceLabel(c.confidence).toLowerCase(), c.reason)}`;
    })
    .filter(Boolean);
  return out.length ? out.join('\n') : m().noRelation;
}

function diagnosticBlock(d: Diagnostic, r: Redact): string {
  const list = (items: string[]) => items.map((x) => `  - ${r(x)}`).join('\n');
  const t = m();
  return [
    `- ${t.diagnosticHead(d.title, categoryLabel(d.category), severityLabel(d.severity).toLowerCase(), d.count, formatClock(d.firstTime), formatClock(d.lastTime))}`,
    `  ${r(d.description)}`,
    `  ${t.evidence}:\n${list(d.evidence)}`,
    d.causes.length ? `  ${t.hypotheses}:\n${list(d.causes)}` : '',
    `  ${t.impact}: ${r(d.impact)}`,
    d.recommendations.length ? `  ${t.recommendations}:\n${list(d.recommendations)}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const diagnosticsOf = (snap: Snapshot, ref: EventRef) => snap.diagnostics.filter((d) => d.related.some((x) => x.kind === ref.kind && x.id === ref.id));

/** Builds the context for one item, or null when it is no longer captured. */
export function buildFocusContext(target: FocusTarget, snap: Snapshot, pageOrigin = location.origin): FocusContext | null {
  const red = collector();
  const r = red.run;
  const logs = new Map(snap.logs.map((l) => [l.id, l]));
  const requests = new Map(snap.requests.map((q) => [q.id, q]));
  const describeRequest = (ref: EventRef) => (ref.kind === 'request' && requests.has(ref.id) ? requestDetail(requests.get(ref.id)!, r, false) : undefined);
  const describeLog = (ref: EventRef) => (ref.kind === 'log' && logs.has(ref.id) ? logDetail(logs.get(ref.id)!, snap, r) : undefined);

  let title: string;
  let sections: string[];
  const t = m();

  if (target.kind === 'log') {
    const l = logs.get(target.id);
    if (!l) return null;
    title = clip(messageOf(l), 80);
    sections = [
      t.consoleMessage,
      logDetail(l, snap, r),
      t.relatedRequests,
      correlationLines(relatedRequests(l, snap.requests, pageOrigin), describeRequest),
      ...diagnosticsOf(snap, target).slice(0, 2).flatMap((d) => [t.diagnosticWithLog, diagnosticBlock(d, r)]),
    ];
  } else if (target.kind === 'request') {
    const q = requests.get(target.id);
    if (!q) return null;
    title = `${q.method} ${shortName(q.url)} → ${statusLabel(q)}`;
    sections = [
      t.request,
      requestDetail(q, r, true),
      t.relatedLogs,
      correlationLines(relatedLogs(q, snap.logs, pageOrigin), describeLog),
      ...diagnosticsOf(snap, target).slice(0, 3).flatMap((d) => [t.diagnosticWithRequest, diagnosticBlock(d, r)]),
    ];
  } else {
    const d = snap.diagnostics.find((x) => x.id === target.id);
    if (!d) return null;
    title = d.title;
    const latest = d.related[0];
    sections = [t.diagnostic, diagnosticBlock(d, r)];
    if (latest?.kind === 'log' && logs.has(latest.id)) {
      const l = logs.get(latest.id)!;
      sections.push(
        t.latest,
        logDetail(l, snap, r),
        t.relatedRequests,
        correlationLines(relatedRequests(l, snap.requests, pageOrigin), describeRequest),
      );
    } else if (latest?.kind === 'request' && requests.has(latest.id)) {
      const q = requests.get(latest.id)!;
      sections.push(t.latest, requestDetail(q, r, true), t.relatedLogs, correlationLines(relatedLogs(q, snap.logs, pageOrigin), describeLog));
    }
    const others = d.related.slice(1, 1 + MAX_RELATED).map((ref) => (ref.kind === 'request' ? describeRequest(ref) : describeLog(ref))).filter(Boolean);
    if (others.length) sections.push(t.others(others.length, d.related.length - 1), ...(others as string[]));
  }

  const text = r(sections.join('\n'));
  return { target, title: r(title), text: clip(text, MAX_FOCUS), redactions: red.result() };
}

export interface QuickAction {
  label: string;
  question: string;
}

/** Questions offered for the item in focus (or for the whole page when nothing is in focus). */
export function quickActions(focus: FocusContext | null, snap: Snapshot): QuickAction[] {
  const a = m().actions;
  const q = (key: ActionKey): QuickAction => {
    const [label, question = label] = a[key];
    return { label, question };
  };
  if (!focus) {
    const list = [q('summarize')];
    if (snap.errors) list.push(q('firstErrors'), q('lastError'));
    if (snap.requests.some((r) => r.state === 'failed' || r.status >= 400)) list.push(q('failing'));
    list.push(q('performance'), q('improve'));
    return list.slice(0, 5);
  }
  if (focus.target.kind === 'log') return (['explainError', 'errorCause', 'fixError', 'relatedRequests', 'prevent'] as const).map(q);
  if (focus.target.kind === 'request') return (['analyzeRequest', 'whyFailed', 'requestPerf', 'fixRequest'] as const).map(q);
  return (['explainDiagnostic', 'diagnosticCause', 'investigate', 'fixDiagnostic', 'prevent'] as const).map(q);
}
