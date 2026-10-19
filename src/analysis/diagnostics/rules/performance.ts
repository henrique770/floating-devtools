import type { NetworkEntry } from '../../../shared/types';
import { normalizeUrl } from '../../fingerprint';
import { originOfUrl } from '../../url';
import { downgrade, type EventRef, type Finding, type RequestRule, type Severity } from '../types';
import { compact, describe, formatBytes, formatMs, isApi, isThirdParty } from './util';

const TEXTUAL = /json|text|javascript|ecmascript|css|xml|svg|html/i;

/** Requests whose total duration exceeds the configured limit. Separates server wait (TTFB) from download. */
export const slowRequestRule: RequestRule = {
  id: 'perf.slow',
  evaluate(r, ctx): Finding | null {
    const limit = ctx.config.slowMs;
    if (r.state !== 'done' || r.duration === undefined || r.duration < limit || r.fromCache) return null;
    if (r.type === 'media' || r.type === 'websocket' || /event-stream/.test(r.mimeType ?? '')) return null;
    const t = r.timing;
    const total = r.duration;
    const connection = t ? t.stalled + t.dns + t.connect : 0;
    const evidence = compact([
      `${describe(r)} → duração total ${formatMs(total)} (limite configurado: ${formatMs(limit)})`,
      t && `Espera pelo servidor (TTFB): ${formatMs(t.waiting)} · download: ${formatMs(t.download)} · fila/conexão: ${formatMs(connection)}`,
      !t && 'Sem detalhamento de fases (recurso de outra origem sem Timing-Allow-Origin, ou dado indisponível): não é possível separar o TTFB do download.',
      r.transferSize ? `Transferido: ${formatBytes(r.transferSize)}` : undefined,
    ]);
    const causes: string[] = [];
    if (t) {
      if (t.waiting >= total * 0.6) causes.push('A maior parte do tempo foi esperando o servidor (TTFB): processamento lento, consulta pesada ou servidor distante.');
      if (t.download >= total * 0.5) causes.push('A maior parte do tempo foi baixando o conteúdo: resposta grande ou banda limitada.');
      if (connection >= total * 0.4) causes.push('Tempo alto em fila/conexão: muitas requisições simultâneas ao mesmo host ou conexão nova (DNS/TLS) a cada chamada.');
    }
    if (!causes.length) causes.push('Servidor lento, resposta grande ou rede limitada — sem dados de fases para distinguir.');

    let severity: Severity = total >= limit * 5 ? 'high' : total >= limit * 2 ? 'medium' : 'low';
    if (!isApi(r) && r.type !== 'document') severity = downgrade(severity);
    if (isThirdParty(originOfUrl(r.url), ctx.pageOrigin)) severity = downgrade(severity);

    return {
      ruleId: 'perf.slow',
      subject: `${r.method} ${normalizeUrl(r.url)}`,
      category: 'performance',
      severity,
      title: r.type === 'document' ? 'Documento principal lento' : 'Requisição lenta',
      description: `Levou ${formatMs(total)}, acima do limite de ${formatMs(limit)}.`,
      evidence,
      causes,
      impact: r.type === 'document' ? 'Atrasa a exibição de toda a página.' : isApi(r) ? 'A interface espera por esses dados (carregamento visível para o usuário).' : 'Atrasa a exibição ou o funcionamento do que depende deste recurso.',
      recommendations: compact([
        t && t.waiting >= total * 0.6 && 'Meça a rota no servidor (consultas, chamadas externas) e considere cache.',
        t && t.download >= total * 0.5 && 'Reduza o tamanho da resposta (paginação, campos necessários, compressão).',
        'Compare com outras execuções da mesma chamada antes de concluir: uma medição isolada pode ser ruído de rede.',
      ]),
      event: { kind: 'request', id: r.id },
      time: r.startTime,
    };
  },
};

/** Resources larger than the configured limit. */
export const largeResourceRule: RequestRule = {
  id: 'perf.large',
  evaluate(r, ctx): Finding | null {
    if (r.state !== 'done') return null;
    const limit = ctx.config.largeBytes;
    const transferred = r.transferSize ?? 0;
    const decoded = r.resourceSize ?? 0;
    const size = transferred || decoded;
    if (size < limit || r.type === 'media') return null;
    const encoding = r.responseHeaders?.['content-encoding'];
    const textual = TEXTUAL.test(r.mimeType ?? '') || r.type === 'script' || r.type === 'stylesheet' || isApi(r);
    // Only claim "uncompressed" when the response headers are known.
    const uncompressed = textual && !!r.responseHeaders && !encoding && size > 50_000;
    const severity: Severity = size >= limit * 4 ? 'medium' : 'low';
    return {
      ruleId: 'perf.large',
      subject: normalizeUrl(r.url),
      category: 'performance',
      severity: isThirdParty(originOfUrl(r.url), ctx.pageOrigin) ? downgrade(severity) : severity,
      title: r.type === 'image' ? 'Imagem pesada' : r.type === 'script' ? 'Script pesado' : 'Recurso pesado',
      description: `${formatBytes(size)}, acima do limite de ${formatBytes(limit)}.`,
      evidence: compact([
        `${describe(r)} (${r.type})`,
        transferred ? `Transferido: ${formatBytes(transferred)}` : r.fromCache ? 'Servido do cache' : undefined,
        decoded ? `Tamanho descomprimido: ${formatBytes(decoded)}` : undefined,
        r.responseHeaders && `content-encoding: ${encoding ?? '(ausente)'}`,
      ]),
      causes: compact([
        uncompressed && 'Resposta textual sem compressão (gzip/brotli) informada nos headers.',
        r.type === 'image' && 'Imagem em resolução maior que a exibida ou formato pouco eficiente (prefira WebP/AVIF).',
        r.type === 'script' && 'Bundle sem code splitting ou com dependências grandes.',
        isApi(r) && 'Resposta com mais dados do que a tela usa (sem paginação/seleção de campos).',
      ]),
      impact: 'Mais tempo de download e memória, principalmente em redes móveis.',
      recommendations: compact([
        uncompressed && 'Ative compressão no servidor/CDN.',
        r.type === 'image' && 'Redimensione e sirva formatos modernos (srcset, WebP/AVIF).',
        r.type === 'script' && 'Divida o bundle (import() sob demanda) e analise as dependências.',
        isApi(r) && 'Pagine ou reduza os campos retornados.',
      ]),
      event: { kind: 'request', id: r.id },
      time: r.startTime,
    };
  },
};

/** Identical API calls (method, URL and body) repeated inside a short window. Stateful: build one per reset. */
export function duplicateRequestRule(): RequestRule {
  const recent = new Map<string, { id: string; time: number }[]>();
  const counted = new Set<string>();
  return {
    id: 'perf.duplicate',
    evaluate(r: NetworkEntry, ctx): Finding | null {
      if (!isApi(r)) return null;
      const { duplicateWindowMs: windowMs, duplicateMin: min } = ctx.config;
      const key = `${r.method} ${r.url} ${(r.requestBody ?? '').slice(0, 2000)}`;
      let list = recent.get(key);
      if (!list) {
        list = [];
        recent.set(key, list);
        if (recent.size > 500) recent.delete(recent.keys().next().value!);
      }
      if (!counted.has(r.id)) {
        counted.add(r.id);
        list.push({ id: r.id, time: r.startTime });
        if (list.length > 50) list.shift();
      }
      const inWindow = list.filter((x) => Math.abs(r.startTime - x.time) <= windowMs);
      if (inWindow.length < min) return null;
      const span = Math.max(...inWindow.map((x) => x.time)) - Math.min(...inWindow.map((x) => x.time));
      const related: EventRef[] = inWindow.filter((x) => x.id !== r.id).map((x) => ({ kind: 'request', id: x.id }));
      return {
        ruleId: 'perf.duplicate',
        subject: key.slice(0, 300),
        category: 'performance',
        severity: 'low',
        title: 'Requisições potencialmente duplicadas',
        description: `${inWindow.length} chamadas idênticas (método, URL e corpo) em ${formatMs(span)}.`,
        evidence: [`${describe(r)} repetida ${inWindow.length}× em ${formatMs(span)} (janela configurada: ${formatMs(windowMs)})`],
        causes: [
          'Efeito disparado mais de uma vez (React StrictMode em desenvolvimento executa efeitos 2×).',
          'Vários componentes buscando o mesmo dado sem cache/deduplicação compartilhada.',
          'Re-renderizações que refazem a busca.',
        ],
        impact: 'Carga extra no servidor e na rede. Pode ser intencional (polling, nova tentativa): não é possível afirmar que são desnecessárias só com estes dados.',
        recommendations: ['Verifique quem dispara a chamada (Initiator no DevTools nativo).', 'Centralize a busca em uma camada com cache/deduplicação.'],
        event: { kind: 'request', id: r.id },
        time: r.startTime,
        related,
      };
    },
  };
}
