import type { Snapshot } from '../content/store';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { formatBytes, formatMs, isErrorEntry, statusLabel } from './format';
import { preview } from './ValueView';

const MAX_CONTEXT = 24_000;
const MAX_ERRORS = 40;
const MAX_FAILED = 40;
const MAX_SLOW = 10;
const BODY_SNIPPET = 400;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** Query string values can carry tokens; keep only the parameter names. */
function safeUrl(url: string): string {
  try {
    const u = new URL(url);
    const params = [...u.searchParams.keys()];
    return clip(`${u.origin}${u.pathname}${params.length ? `?${params.map((k) => `${k}=…`).join('&')}` : ''}`, 200);
  } catch {
    return clip(url, 200);
  }
}

function logLine(e: ConsoleEntry): string {
  const text = e.args.map((a) => preview(a)).join(' ');
  const count = e.count && e.count > 1 ? ` (x${e.count})` : '';
  const source = e.source ? ` @ ${e.source.label}` : '';
  const stack = e.stack ? `\n    ${e.stack.split('\n').slice(0, 4).join('\n    ')}` : '';
  return `- [${e.level}]${count} ${clip(text, 600)}${source}${stack}`;
}

function requestLine(e: NetworkEntry): string {
  const parts = [`- ${e.method} ${safeUrl(e.url)} → ${statusLabel(e)}`, e.type, formatMs(e.duration)];
  if (e.error) parts.push(e.error);
  let line = parts.join(' | ');
  const body = e.responseBody?.trim();
  if (body && isErrorEntry(e)) line += `\n    resposta: ${clip(body.replace(/\s+/g, ' '), BODY_SNIPPET)}`;
  return line;
}

/**
 * Text summary of what the DevTools captured on this page, sent as the system context.
 * Headers, cookies and request bodies are left out on purpose.
 */
export function buildContext(snap: Snapshot): string {
  const { requests, logs } = snap;
  const errors = logs.filter((l) => l.level === 'error');
  const warnings = logs.filter((l) => l.level === 'warn');
  const failed = requests.filter(isErrorEntry);
  const slow = requests
    .filter((r) => r.duration !== undefined && r.duration > 1000)
    .sort((a, b) => b.duration! - a.duration!)
    .slice(0, MAX_SLOW);
  const transferred = requests.reduce((n, r) => n + (r.transferSize ?? 0), 0);
  const byType = new Map<string, number>();
  for (const r of requests) byType.set(r.type, (byType.get(r.type) ?? 0) + 1);

  const sections = [
    `Página: ${safeUrl(location.href)}`,
    `Título: ${clip(document.title, 120)}`,
    '',
    '## Resumo',
    `Requisições: ${requests.length} (${[...byType].map(([t, n]) => `${t}: ${n}`).join(', ') || 'nenhuma'})`,
    `Transferido: ${formatBytes(transferred)}`,
    `Requisições com falha ou status >= 400: ${failed.length}`,
    `Console: ${logs.length} mensagens, ${snap.errors} erros, ${snap.warnings} avisos`,
    '',
    `## Erros do console (${errors.length}, mais recentes por último)`,
    ...(errors.slice(-MAX_ERRORS).map(logLine).join('\n') || 'nenhum').split('\n'),
    '',
    `## Avisos do console (${warnings.length})`,
    ...(warnings.slice(-MAX_ERRORS / 2).map(logLine).join('\n') || 'nenhum').split('\n'),
    '',
    `## Requisições com falha (${failed.length})`,
    ...(failed.slice(-MAX_FAILED).map(requestLine).join('\n') || 'nenhuma').split('\n'),
    '',
    `## Requisições lentas (> 1 s)`,
    ...(slow.map(requestLine).join('\n') || 'nenhuma').split('\n'),
    '',
    '## Últimas mensagens do console',
    ...(logs
      .filter((l) => l.level !== 'error' && l.level !== 'warn')
      .slice(-15)
      .map(logLine)
      .join('\n') || 'nenhuma').split('\n'),
  ];

  return clip(sections.join('\n'), MAX_CONTEXT);
}

export const SYSTEM_PROMPT = `Você é um assistente de depuração embutido em uma ferramenta de desenvolvedor (Network + Console) que roda sobre a página atual.
Você recebe abaixo um retrato do que foi capturado: erros e avisos do console, requisições com falha, requisições lentas e totais.
Responda em português do Brasil, de forma direta e técnica, usando Markdown curto (listas, \`código\`, blocos de código quando útil).
Baseie-se nos dados capturados; quando algo não estiver nos dados, diga isso em vez de inventar.
Quando apontar problemas, priorize por impacto e sugira a correção concreta (o que mudar e onde).
Ruído de terceiros (analytics, RUM, extensões, anúncios) deve ser identificado como tal e separado dos problemas da aplicação.`;
