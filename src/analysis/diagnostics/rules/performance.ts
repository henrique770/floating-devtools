import type { NetworkEntry } from '../../../shared/types';
import { normalizeUrl } from '../../fingerprint';
import { originOfUrl } from '../../url';
import { downgrade, type EventRef, type Finding, type RequestRule, type Severity } from '../types';
import { defineMessages } from '../../../i18n';
import { compact, describe, formatBytes, formatMs, isApi, isThirdParty } from './util';

const m = defineMessages({
  pt: {
    slowTotal: (req: string, total: string, limit: string) => `${req} → duração total ${total} (limite configurado: ${limit})`,
    slowPhases: (ttfb: string, download: string, connection: string) => `Espera pelo servidor (TTFB): ${ttfb} · download: ${download} · fila/conexão: ${connection}`,
    noPhases: 'Sem detalhamento de fases (recurso de outra origem sem Timing-Allow-Origin, ou dado indisponível): não é possível separar o TTFB do download.',
    transferred: (size: string) => `Transferido: ${size}`,
    waitingCause: 'A maior parte do tempo foi esperando o servidor (TTFB): processamento lento, consulta pesada ou servidor distante.',
    downloadCause: 'A maior parte do tempo foi baixando o conteúdo: resposta grande ou banda limitada.',
    connectionCause: 'Tempo alto em fila/conexão: muitas requisições simultâneas ao mesmo host ou conexão nova (DNS/TLS) a cada chamada.',
    unknownCause: 'Servidor lento, resposta grande ou rede limitada — sem dados de fases para distinguir.',
    slowDocument: 'Documento principal lento',
    slowRequest: 'Requisição lenta',
    slowDescription: (total: string, limit: string) => `Levou ${total}, acima do limite de ${limit}.`,
    documentImpact: 'Atrasa a exibição de toda a página.',
    apiImpact: 'A interface espera por esses dados (carregamento visível para o usuário).',
    resourceImpact: 'Atrasa a exibição ou o funcionamento do que depende deste recurso.',
    serverRec: 'Meça a rota no servidor (consultas, chamadas externas) e considere cache.',
    sizeRec: 'Reduza o tamanho da resposta (paginação, campos necessários, compressão).',
    compareRec: 'Compare com outras execuções da mesma chamada antes de concluir: uma medição isolada pode ser ruído de rede.',

    heavyImage: 'Imagem pesada',
    heavyScript: 'Script pesado',
    heavyResource: 'Recurso pesado',
    largeDescription: (size: string, limit: string) => `${size}, acima do limite de ${limit}.`,
    fromCache: 'Servido do cache',
    decoded: (size: string) => `Tamanho descomprimido: ${size}`,
    missing: '(ausente)',
    uncompressedCause: 'Resposta textual sem compressão (gzip/brotli) informada nos headers.',
    imageCause: 'Imagem em resolução maior que a exibida ou formato pouco eficiente (prefira WebP/AVIF).',
    scriptCause: 'Bundle sem code splitting ou com dependências grandes.',
    apiCause: 'Resposta com mais dados do que a tela usa (sem paginação/seleção de campos).',
    largeImpact: 'Mais tempo de download e memória, principalmente em redes móveis.',
    compressRec: 'Ative compressão no servidor/CDN.',
    imageRec: 'Redimensione e sirva formatos modernos (srcset, WebP/AVIF).',
    scriptRec: 'Divida o bundle (import() sob demanda) e analise as dependências.',
    apiRec: 'Pagine ou reduza os campos retornados.',

    duplicateTitle: 'Requisições potencialmente duplicadas',
    duplicateDescription: (n: number, span: string) => `${n} chamadas idênticas (método, URL e corpo) em ${span}.`,
    duplicateEvidence: (req: string, n: number, span: string, windowMs: string) => `${req} repetida ${n}× em ${span} (janela configurada: ${windowMs})`,
    duplicateCauses: [
      'Efeito disparado mais de uma vez (React StrictMode em desenvolvimento executa efeitos 2×).',
      'Vários componentes buscando o mesmo dado sem cache/deduplicação compartilhada.',
      'Re-renderizações que refazem a busca.',
    ],
    duplicateImpact: 'Carga extra no servidor e na rede. Pode ser intencional (polling, nova tentativa): não é possível afirmar que são desnecessárias só com estes dados.',
    duplicateRecs: ['Verifique quem dispara a chamada (Initiator no DevTools nativo).', 'Centralize a busca em uma camada com cache/deduplicação.'],
  },
  en: {
    slowTotal: (req, total, limit) => `${req} → total duration ${total} (configured limit: ${limit})`,
    slowPhases: (ttfb, download, connection) => `Waiting for the server (TTFB): ${ttfb} · download: ${download} · queue/connection: ${connection}`,
    noPhases: 'No phase breakdown (cross-origin resource without Timing-Allow-Origin, or data unavailable): the TTFB cannot be separated from the download.',
    transferred: (size) => `Transferred: ${size}`,
    waitingCause: 'Most of the time was spent waiting for the server (TTFB): slow processing, a heavy query or a distant server.',
    downloadCause: 'Most of the time was spent downloading the content: large response or limited bandwidth.',
    connectionCause: 'High queue/connection time: many simultaneous requests to the same host, or a new connection (DNS/TLS) on every call.',
    unknownCause: 'Slow server, large response or limited network — no phase data to tell them apart.',
    slowDocument: 'Slow main document',
    slowRequest: 'Slow request',
    slowDescription: (total, limit) => `Took ${total}, above the ${limit} limit.`,
    documentImpact: 'Delays the display of the whole page.',
    apiImpact: 'The UI waits for this data (loading visible to the user).',
    resourceImpact: 'Delays the display or behavior of whatever depends on this resource.',
    serverRec: 'Measure the route on the server (queries, external calls) and consider caching.',
    sizeRec: 'Reduce the response size (pagination, only the needed fields, compression).',
    compareRec: 'Compare with other runs of the same call before concluding: a single measurement may be network noise.',

    heavyImage: 'Heavy image',
    heavyScript: 'Heavy script',
    heavyResource: 'Heavy resource',
    largeDescription: (size, limit) => `${size}, above the ${limit} limit.`,
    fromCache: 'Served from cache',
    decoded: (size) => `Decoded size: ${size}`,
    missing: '(missing)',
    uncompressedCause: 'Textual response without compression (gzip/brotli) according to the headers.',
    imageCause: 'Image at a higher resolution than displayed, or an inefficient format (prefer WebP/AVIF).',
    scriptCause: 'Bundle without code splitting or with large dependencies.',
    apiCause: 'Response with more data than the screen uses (no pagination/field selection).',
    largeImpact: 'More download time and memory, especially on mobile networks.',
    compressRec: 'Enable compression on the server/CDN.',
    imageRec: 'Resize and serve modern formats (srcset, WebP/AVIF).',
    scriptRec: 'Split the bundle (on-demand import()) and review the dependencies.',
    apiRec: 'Paginate or reduce the returned fields.',

    duplicateTitle: 'Potentially duplicated requests',
    duplicateDescription: (n, span) => `${n} identical calls (method, URL and body) in ${span}.`,
    duplicateEvidence: (req, n, span, windowMs) => `${req} repeated ${n}× in ${span} (configured window: ${windowMs})`,
    duplicateCauses: [
      'Effect triggered more than once (React StrictMode runs effects twice in development).',
      'Several components fetching the same data without a shared cache/deduplication.',
      'Re-renders that redo the fetch.',
    ],
    duplicateImpact: 'Extra load on the server and network. It may be intentional (polling, retry): these data alone cannot tell whether they are unnecessary.',
    duplicateRecs: ['Check what triggers the call (Initiator in the native DevTools).', 'Centralize the fetch in a layer with caching/deduplication.'],
  },
});

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
    const tx = m();
    const evidence = compact([
      tx.slowTotal(describe(r), formatMs(total), formatMs(limit)),
      t && tx.slowPhases(formatMs(t.waiting), formatMs(t.download), formatMs(connection)),
      !t && tx.noPhases,
      r.transferSize ? tx.transferred(formatBytes(r.transferSize)) : undefined,
    ]);
    const causes: string[] = [];
    if (t) {
      if (t.waiting >= total * 0.6) causes.push(tx.waitingCause);
      if (t.download >= total * 0.5) causes.push(tx.downloadCause);
      if (connection >= total * 0.4) causes.push(tx.connectionCause);
    }
    if (!causes.length) causes.push(tx.unknownCause);

    let severity: Severity = total >= limit * 5 ? 'high' : total >= limit * 2 ? 'medium' : 'low';
    if (!isApi(r) && r.type !== 'document') severity = downgrade(severity);
    if (isThirdParty(originOfUrl(r.url), ctx.pageOrigin)) severity = downgrade(severity);

    return {
      ruleId: 'perf.slow',
      subject: `${r.method} ${normalizeUrl(r.url)}`,
      category: 'performance',
      severity,
      title: r.type === 'document' ? tx.slowDocument : tx.slowRequest,
      description: tx.slowDescription(formatMs(total), formatMs(limit)),
      evidence,
      causes,
      impact: r.type === 'document' ? tx.documentImpact : isApi(r) ? tx.apiImpact : tx.resourceImpact,
      recommendations: compact([
        t && t.waiting >= total * 0.6 && tx.serverRec,
        t && t.download >= total * 0.5 && tx.sizeRec,
        tx.compareRec,
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
    const t = m();
    return {
      ruleId: 'perf.large',
      subject: normalizeUrl(r.url),
      category: 'performance',
      severity: isThirdParty(originOfUrl(r.url), ctx.pageOrigin) ? downgrade(severity) : severity,
      title: r.type === 'image' ? t.heavyImage : r.type === 'script' ? t.heavyScript : t.heavyResource,
      description: t.largeDescription(formatBytes(size), formatBytes(limit)),
      evidence: compact([
        `${describe(r)} (${r.type})`,
        transferred ? t.transferred(formatBytes(transferred)) : r.fromCache ? t.fromCache : undefined,
        decoded ? t.decoded(formatBytes(decoded)) : undefined,
        r.responseHeaders && `content-encoding: ${encoding ?? t.missing}`,
      ]),
      causes: compact([
        uncompressed && t.uncompressedCause,
        r.type === 'image' && t.imageCause,
        r.type === 'script' && t.scriptCause,
        isApi(r) && t.apiCause,
      ]),
      impact: t.largeImpact,
      recommendations: compact([
        uncompressed && t.compressRec,
        r.type === 'image' && t.imageRec,
        r.type === 'script' && t.scriptRec,
        isApi(r) && t.apiRec,
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
      const t = m();
      return {
        ruleId: 'perf.duplicate',
        subject: key.slice(0, 300),
        category: 'performance',
        severity: 'low',
        title: t.duplicateTitle,
        description: t.duplicateDescription(inWindow.length, formatMs(span)),
        evidence: [t.duplicateEvidence(describe(r), inWindow.length, formatMs(span), formatMs(windowMs))],
        causes: [...t.duplicateCauses],
        impact: t.duplicateImpact,
        recommendations: [...t.duplicateRecs],
        event: { kind: 'request', id: r.id },
        time: r.startTime,
        related,
      };
    },
  };
}
