/**
 * Structured context about ONE item the developer chose to investigate (a console error, a
 * request or a diagnostic): the item in detail plus only what is related to it. Sent to the AI
 * provider ahead of the page overview, after masking, and bounded in size.
 */
import { CONFIDENCE_LABEL, relatedLogs, relatedRequests, type Correlation } from '../analysis/correlate';
import type { Diagnostic, EventRef } from '../analysis/diagnostics/types';
import { redact, type Redaction } from '../analysis/redact';
import { safeUrl } from '../analysis/url';
import type { Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { formatBytes, formatClock, formatMs, shortName, statusLabel } from './format';
import { CATEGORY_LABEL, SEVERITY_LABEL } from './labels';
import { preview } from './ValueView';

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
  return [
    `- [${l.level}] ${clip(r(messageOf(l)), MESSAGE)}`,
    `  horário: ${formatClock(l.time)}${l.source ? ` · origem: ${l.source.label} (${safeUrl(l.source.url.replace(/:\d+$/, ''))})` : ''}`,
    group && group.count > 1 && `  ocorrências equivalentes: ${group.count} (primeira ${formatClock(group.firstTime)}, última ${formatClock(group.lastTime)})`,
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
  const lines = [
    `- ${q.method} ${safeUrl(q.url)} → ${statusLabel(q)} (${q.type}${q.mimeType ? `, ${q.mimeType.split(';')[0]}` : ''})`,
    `  horário: ${formatClock(q.startTime)} · duração total ${formatMs(q.duration)}${
      t ? ` · TTFB ${formatMs(t.waiting)} · download ${formatMs(t.download)} · fila/conexão ${formatMs(t.stalled + t.dns + t.connect)}` : ' · sem fases de timing'
    }`,
    `  transferido ${formatBytes(q.transferSize)} · corpo ${formatBytes(q.resourceSize)}${q.fromCache ? ' · servido do cache' : ''}`,
    q.error && `  erro na página: ${r(q.error)}`,
    q.web && `  visto pela extensão (webRequest): ${q.web.status ? `servidor respondeu HTTP ${q.web.status}` : 'sem resposta'}${q.web.error ? ` · ${q.web.error}` : ''}`,
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
      params.length ? `  parâmetros de query (só nomes): ${params.join(', ')}` : '',
      reqHeaders && `  headers de requisição (seleção sem credenciais): ${reqHeaders}`,
      resHeaders && `  headers de resposta (seleção sem credenciais): ${r(resHeaders)}`,
      q.initiator ? `  iniciador:\n${r(q.initiator.split('\n').slice(0, 6).map((l) => `    ${l}`).join('\n'))}` : '',
      q.requestBody ? `  payload:\n    ${clip(r(q.requestBody), REQUEST_BODY)}` : '',
      q.responseBody !== undefined ? `  resposta:\n    ${q.responseBody ? clip(r(q.responseBody.trim()), RESPONSE_BODY) : '(vazia)'}` : q.responseBodyNote ? `  resposta: ${q.responseBodyNote}` : '',
    );
  }
  return lines.filter(Boolean).join('\n');
}

function correlationLines(items: Correlation[], describe: (ref: EventRef) => string | undefined): string {
  const out = items
    .slice(0, MAX_RELATED)
    .map((c) => {
      const d = describe(c.ref);
      return d && `${d}\n  relação: confiança ${CONFIDENCE_LABEL[c.confidence].toLowerCase()} — ${c.reason}`;
    })
    .filter(Boolean);
  return out.length ? out.join('\n') : 'nenhuma relação encontrada nos dados capturados';
}

function diagnosticBlock(d: Diagnostic, r: Redact): string {
  const list = (items: string[]) => items.map((t) => `  - ${r(t)}`).join('\n');
  return [
    `- ${d.title} (${CATEGORY_LABEL[d.category]}, severidade ${SEVERITY_LABEL[d.severity].toLowerCase()}, ${d.count} ocorrência(s), primeira ${formatClock(d.firstTime)}, última ${formatClock(d.lastTime)})`,
    `  ${r(d.description)}`,
    `  evidências (fatos observados):\n${list(d.evidence)}`,
    d.causes.length ? `  hipóteses locais (não confirmadas):\n${list(d.causes)}` : '',
    `  impacto potencial: ${r(d.impact)}`,
    d.recommendations.length ? `  recomendações locais:\n${list(d.recommendations)}` : '',
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

  if (target.kind === 'log') {
    const l = logs.get(target.id);
    if (!l) return null;
    title = clip(messageOf(l), 80);
    sections = [
      '### Mensagem do console',
      logDetail(l, snap, r),
      '### Requisições possivelmente relacionadas',
      correlationLines(relatedRequests(l, snap.requests, pageOrigin), describeRequest),
      ...diagnosticsOf(snap, target).slice(0, 2).flatMap((d) => ['### Diagnóstico local que inclui esta mensagem', diagnosticBlock(d, r)]),
    ];
  } else if (target.kind === 'request') {
    const q = requests.get(target.id);
    if (!q) return null;
    title = `${q.method} ${shortName(q.url)} → ${statusLabel(q)}`;
    sections = [
      '### Requisição',
      requestDetail(q, r, true),
      '### Logs possivelmente relacionados',
      correlationLines(relatedLogs(q, snap.logs, pageOrigin), describeLog),
      ...diagnosticsOf(snap, target).slice(0, 3).flatMap((d) => ['### Diagnóstico local que inclui esta requisição', diagnosticBlock(d, r)]),
    ];
  } else {
    const d = snap.diagnostics.find((x) => x.id === target.id);
    if (!d) return null;
    title = d.title;
    const latest = d.related[0];
    sections = ['### Diagnóstico', diagnosticBlock(d, r)];
    if (latest?.kind === 'log' && logs.has(latest.id)) {
      const l = logs.get(latest.id)!;
      sections.push(
        '### Ocorrência mais recente',
        logDetail(l, snap, r),
        '### Requisições possivelmente relacionadas',
        correlationLines(relatedRequests(l, snap.requests, pageOrigin), describeRequest),
      );
    } else if (latest?.kind === 'request' && requests.has(latest.id)) {
      const q = requests.get(latest.id)!;
      sections.push('### Ocorrência mais recente', requestDetail(q, r, true), '### Logs possivelmente relacionados', correlationLines(relatedLogs(q, snap.logs, pageOrigin), describeLog));
    }
    const others = d.related.slice(1, 1 + MAX_RELATED).map((ref) => (ref.kind === 'request' ? describeRequest(ref) : describeLog(ref))).filter(Boolean);
    if (others.length) sections.push(`### Outras ocorrências (${others.length} de ${d.related.length - 1})`, ...(others as string[]));
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
  const q = (label: string, question = label) => ({ label, question });
  if (!focus) {
    const list = [q('Resuma os problemas da sessão', 'Resuma os problemas desta sessão, do mais grave ao menos grave, separando o que é da aplicação do que é ruído de terceiros.')];
    if (snap.errors) list.push(q('Quais erros devo resolver primeiro?'), q('Explique o último erro do console'));
    if (snap.requests.some((r) => r.state === 'failed' || r.status >= 400)) list.push(q('Por que essas requisições estão falhando?'));
    list.push(q('Existe algum problema de performance?'), q('Recomende melhorias'));
    return list.slice(0, 5);
  }
  if (focus.target.kind === 'log') {
    return [
      q('Explique este erro', 'Explique este erro: o que aconteceu e onde, com base no stack e nos dados.'),
      q('Qual pode ser a causa?', 'Quais são as causas possíveis deste erro? Diga quais os dados sustentam e quais são só hipóteses.'),
      q('Como corrigir?', 'Como corrigir este erro? Mostre um exemplo de código se ajudar.'),
      q('Analise as requisições relacionadas', 'As requisições relacionadas explicam este erro? Avalie a confiança de cada relação.'),
      q('Como evitar que se repita?'),
    ];
  }
  if (focus.target.kind === 'request') {
    return [
      q('Analise esta requisição', 'Analise esta requisição: status, timing, headers e resposta. Há algo errado?'),
      q('Por que ela falhou?', 'Por que esta requisição falhou ou retornou este status? Separe fatos de hipóteses.'),
      q('Existe problema de performance?', 'Esta requisição tem problema de performance? Separe TTFB de download e diga o que melhorar.'),
      q('Como corrigir?', 'Como corrigir o problema desta requisição, no cliente e/ou no servidor? Mostre código se ajudar.'),
    ];
  }
  return [
    q('Explique este diagnóstico', 'Explique este diagnóstico e o impacto dele.'),
    q('Qual pode ser a causa?', 'Quais hipóteses deste diagnóstico os dados sustentam? O que falta para confirmar?'),
    q('Como investigar?', 'Quais os próximos passos para investigar e confirmar a causa?'),
    q('Como corrigir?', 'Como corrigir? Mostre um exemplo de código se ajudar.'),
    q('Como evitar que se repita?'),
  ];
}
