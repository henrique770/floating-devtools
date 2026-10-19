import type { NetworkEntry } from '../../../shared/types';
import { normalizeUrl } from '../../fingerprint';
import { originOfUrl } from '../../url';
import { downgrade, type EventRef, type Finding, type RequestRule, type Severity } from '../types';
import { compact, describe, hostOf, isApi, isThirdParty } from './util';

const subjectOf = (r: NetworkEntry, extra: string | number) => `${r.method} ${normalizeUrl(r.url)} ${extra}`;

const MAX_JSON_CHECK = 200_000;

function httpError(r: NetworkEntry, thirdParty: boolean): Omit<Finding, 'ruleId' | 'subject' | 'event' | 'time' | 'category'> {
  const s = r.status;
  const evidence = compact([
    `${describe(r)} → HTTP ${s}${r.statusText ? ` ${r.statusText}` : ''}`,
    r.type !== 'fetch' && r.type !== 'xhr' && `Tipo: ${r.type}`,
    thirdParty && `Host de outra origem: ${hostOf(r.url)}`,
    r.responseBody && isApi(r) && `Resposta: ${r.responseBody.replace(/\s+/g, ' ').slice(0, 160)}`,
  ]);
  let severity: Severity;
  let title: string;
  let causes: string[];
  let recommendations: string[];
  let impact: string;
  if (s >= 500) {
    severity = 'high';
    title = `Erro do servidor (HTTP ${s})`;
    causes =
      s === 502 || s === 503 || s === 504
        ? ['Servidor de origem indisponível, sobrecarregado ou lento demais para o proxy/gateway.', 'Deploy em andamento ou serviço dependente fora do ar.']
        : ['Exceção não tratada no servidor.', 'Payload enviado em formato que o servidor não esperava.'];
    recommendations = ['Consulte os logs do servidor para esta rota e horário.', 'Garanta que a interface trate a falha (mensagem, nova tentativa).'];
    impact = 'A operação não foi concluída no servidor; a interface pode exibir dados incompletos ou ficar sem resposta.';
  } else if (s === 401 || s === 403) {
    severity = 'medium';
    title = s === 401 ? 'Não autenticado (HTTP 401)' : 'Acesso negado (HTTP 403)';
    causes =
      s === 401
        ? ['Token/sessão expirado ou ausente.', 'Header de autenticação não enviado nesta chamada.']
        : ['Usuário sem permissão para o recurso.', 'Proteção CSRF/origem recusou a chamada.'];
    recommendations = ['Confira se a chamada envia a credencial esperada e se ela está válida.', 'Trate a renovação de sessão ou redirecione para login.'];
    impact = 'O usuário não recebe os dados ou a ação é recusada.';
  } else if (s === 404) {
    severity = isApi(r) || r.type === 'document' ? 'medium' : 'low';
    title = 'Recurso não encontrado (HTTP 404)';
    causes = ['URL incorreta (caminho, id ou base URL).', 'Recurso removido ou ainda não publicado.'];
    recommendations = ['Confira a URL gerada e a rota no servidor.'];
    impact = isApi(r) ? 'Os dados esperados não chegam à interface.' : 'O recurso não é exibido ou aplicado.';
  } else if (s === 429) {
    severity = 'medium';
    title = 'Limite de requisições (HTTP 429)';
    causes = ['Excesso de chamadas em pouco tempo (polling agressivo, laço de re-render, requisições duplicadas).'];
    recommendations = ['Reduza a frequência, aplique debounce/cache e respeite o header Retry-After.'];
    impact = 'Chamadas são recusadas até o limite ser liberado.';
  } else {
    severity = s === 400 || s === 422 || s === 409 ? 'medium' : 'low';
    title = `Requisição recusada (HTTP ${s})`;
    causes = ['Parâmetros ou corpo inválidos para o servidor.', 'Estado do recurso incompatível com a operação.'];
    recommendations = ['Leia a resposta do servidor (aba Network → Response) para o detalhe da validação.'];
    impact = 'A operação foi recusada pelo servidor.';
  }
  if (/\/favicon\.ico$/.test(r.url.split(/[?#]/)[0])) severity = 'info';
  else if (thirdParty) severity = downgrade(severity);
  return { severity, title, description: `${r.method} ${hostOf(r.url)} respondeu com status ${s}.`, evidence, causes, impact, recommendations };
}

export const httpErrorRule: RequestRule = {
  id: 'net.http-error',
  evaluate(r, ctx) {
    if (r.state !== 'done' || r.status < 400 || r.type === 'script') return null;
    const thirdParty = isThirdParty(originOfUrl(r.url), ctx.pageOrigin);
    return {
      ruleId: 'net.http-error',
      subject: subjectOf(r, r.status),
      category: 'network',
      ...httpError(r, thirdParty),
      event: { kind: 'request', id: r.id },
      time: r.startTime,
    };
  },
};

type FailureKind = 'aborted' | 'timeout' | 'blocked' | 'connection' | 'cors' | 'unknown';

export function classifyFailure(r: NetworkEntry, pageOrigin: string): FailureKind {
  const error = `${r.error ?? ''} ${r.web?.error ?? ''}`;
  if (/abort|cancel|ERR_ABORTED/i.test(error)) return 'aborted';
  if (/timeout|timed?[ _]?out/i.test(error)) return 'timeout';
  if (/ERR_BLOCKED_BY_CLIENT/.test(error)) return 'blocked';
  if (/ERR_(?:NAME_NOT_RESOLVED|CONNECTION_\w+|INTERNET_DISCONNECTED|ADDRESS_UNREACHABLE|NETWORK_CHANGED|CERT_\w+|SSL_\w+|EMPTY_RESPONSE|PROXY_\w+)/.test(error)) return 'connection';
  // The page only sees a generic network error. A cross-origin call is a CORS candidate; same-origin never is.
  if (isApi(r) && isThirdParty(originOfUrl(r.url), pageOrigin) && (r.web?.status || /Failed to fetch|NetworkError|ERR_FAILED|Load failed/i.test(error))) return 'cors';
  return 'unknown';
}

export const requestFailureRule: RequestRule = {
  id: 'net.failure',
  evaluate(r, ctx): Finding | null {
    if (r.state !== 'failed' || r.type === 'script') return null;
    const kind = classifyFailure(r, ctx.pageOrigin);
    const thirdParty = isThirdParty(originOfUrl(r.url), ctx.pageOrigin);
    const errorText = r.error ?? 'erro de rede';
    const evidence = compact([
      `${describe(r)} → falhou: ${errorText}`,
      r.web?.error && r.web.error !== r.error && `Erro visto pela extensão (webRequest): ${r.web.error}`,
      !!r.web?.status && `O servidor respondeu HTTP ${r.web.status}${r.web.method !== r.method ? ` (${r.web.method})` : ''}, mas a página não recebeu a resposta.`,
      thirdParty && `Host de outra origem: ${hostOf(r.url)}`,
    ]);
    const base = { subject: subjectOf(r, kind), category: 'network' as const, evidence, event: { kind: 'request' as const, id: r.id }, time: r.startTime };

    switch (kind) {
      case 'aborted':
        return {
          ...base,
          ruleId: 'net.cancelled',
          severity: 'info',
          title: 'Requisição cancelada',
          description: 'A requisição foi abortada antes de terminar.',
          causes: ['AbortController acionado (componente desmontado, nova busca substituindo a anterior).', 'Navegação para outra página durante a requisição.'],
          impact: 'Normalmente nenhum, quando o cancelamento é intencional.',
          recommendations: ['Se o cancelamento não for esperado, verifique quem chama abort() e se o erro AbortError é tratado.'],
        };
      case 'timeout':
        return {
          ...base,
          ruleId: 'net.timeout',
          severity: thirdParty ? 'medium' : 'high',
          title: 'Timeout de requisição',
          description: 'A requisição excedeu o tempo limite.',
          causes: ['Servidor lento ou travado nesta rota.', 'Rede instável ou limite de timeout curto demais para a operação.'],
          impact: 'A operação não é concluída e o usuário espera sem resposta.',
          recommendations: ['Meça o tempo da rota no servidor.', 'Ajuste o timeout ao tipo de operação e mostre feedback/nova tentativa.'],
        };
      case 'blocked':
        return {
          ...base,
          ruleId: 'net.blocked-by-client',
          severity: 'info',
          title: 'Bloqueada pelo navegador do usuário',
          description: 'A requisição foi bloqueada antes de sair do navegador (net::ERR_BLOCKED_BY_CLIENT).',
          causes: ['Extensão de bloqueio de anúncios/rastreadores.'],
          impact: 'Usuários com bloqueadores não carregam este recurso; se ele for essencial, a página quebra para eles.',
          recommendations: ['Garanta que a aplicação funcione sem este recurso, ou evite nomes de URL comuns em listas de bloqueio (ads, track, analytics).'],
        };
      case 'connection':
        return {
          ...base,
          ruleId: 'net.connection',
          severity: thirdParty ? 'medium' : 'high',
          title: 'Falha de conexão',
          description: 'Não foi possível estabelecer conexão com o servidor.',
          causes: ['DNS não resolve o host, servidor fora do ar ou recusando conexões.', 'Certificado TLS inválido.', 'Usuário sem internet.'],
          impact: 'Nenhum dado chega deste host.',
          recommendations: ['Confira o host/porta configurados para este ambiente e se o serviço está no ar.'],
        };
      case 'cors':
        return {
          ...base,
          ruleId: 'net.possible-cors',
          severity: thirdParty ? 'medium' : 'high',
          title: 'Possível bloqueio de CORS',
          description: r.web?.status
            ? 'O servidor respondeu, mas o navegador não entregou a resposta à página — o padrão de um bloqueio de CORS. O navegador não informa o motivo à página, então isto não é confirmado.'
            : 'Chamada para outra origem falhou com erro de rede genérico. CORS é uma causa comum, mas não é possível confirmá-la com os dados capturados.',
          causes: [
            'O servidor não envia Access-Control-Allow-Origin para esta origem (ou envia * com credenciais).',
            'O preflight (OPTIONS) foi recusado ou não permite o método/header usado.',
            ...(r.web?.status ? [] : ['Falha de rede ou servidor indisponível (também produz o mesmo erro).']),
          ],
          impact: 'A página não consegue ler a resposta; a funcionalidade que depende dela falha.',
          recommendations: [
            'Veja a mensagem de CORS no console nativo do navegador (o motivo exato aparece só lá).',
            'Configure no servidor Access-Control-Allow-Origin/Methods/Headers para esta origem.',
          ],
        };
      default:
        return {
          ...base,
          ruleId: 'net.failure',
          severity: thirdParty ? 'low' : 'medium',
          title: 'Falha de rede',
          description: 'A requisição falhou sem resposta do servidor.',
          causes: ['Conexão interrompida, servidor indisponível ou bloqueio por política (CSP, mixed content).'],
          impact: 'Os dados desta chamada não chegaram.',
          recommendations: ['Repita a ação e compare o erro; verifique o console nativo para mensagens de CSP ou mixed content.'],
        };
    }
  },
};

/** API calls that succeeded but returned something the caller most likely can't use. */
export const unexpectedResponseRule: RequestRule = {
  id: 'net.unexpected-response',
  evaluate(r, ctx): Finding | null {
    if (!isApi(r) || r.state !== 'done' || r.status < 200 || r.status >= 300) return null;
    const mime = (r.mimeType ?? '').toLowerCase();
    const accept = r.requestHeaders?.accept ?? '';
    const base = {
      ruleId: 'net.unexpected-response',
      category: 'network' as const,
      event: { kind: 'request' as const, id: r.id },
      time: r.startTime,
    };
    const thirdParty = isThirdParty(originOfUrl(r.url), ctx.pageOrigin);

    if (mime.includes('text/html') && (/json/.test(accept) || /\/(?:api|graphql|v\d+)\//i.test(r.url))) {
      return {
        ...base,
        subject: subjectOf(r, 'html'),
        severity: thirdParty ? 'low' : 'medium',
        title: 'HTML recebido em chamada de API',
        description: `A chamada respondeu ${r.status} com content-type HTML, mas parece esperar JSON.`,
        evidence: compact([
          `${describe(r)} → HTTP ${r.status}, content-type: ${r.mimeType}`,
          accept && `Accept enviado: ${accept}`,
          r.responseBody && `Início da resposta: ${r.responseBody.trim().slice(0, 100).replace(/\s+/g, ' ')}`,
        ]),
        causes: ['URL errada caindo no fallback do SPA (index.html).', 'Redirecionamento para página de login.', 'Proxy/servidor devolvendo página de erro com status 200.'],
        impact: 'O parse como JSON falha (SyntaxError) ou a interface recebe dados inválidos.',
        recommendations: ['Confira a URL/base URL da API neste ambiente.', 'Valide o content-type antes de interpretar a resposta.'],
      };
    }

    const body = r.responseBody?.trim();
    if (mime.includes('json') && body && body.length <= MAX_JSON_CHECK) {
      try {
        JSON.parse(body);
      } catch (err) {
        return {
          ...base,
          subject: subjectOf(r, 'invalid-json'),
          severity: thirdParty ? 'low' : 'medium',
          title: 'JSON inválido na resposta',
          description: 'O servidor declarou JSON, mas o corpo não é um JSON válido.',
          evidence: [`${describe(r)} → HTTP ${r.status}, content-type: ${r.mimeType}`, `Erro de parse: ${String(err).slice(0, 120)}`],
          causes: ['Resposta truncada.', 'Saída extra no servidor (avisos, BOM, logs) antes do JSON.', 'Serialização incorreta no servidor.'],
          impact: 'O cliente não consegue interpretar a resposta.',
          recommendations: ['Inspecione o corpo na aba Network → Response e corrija a serialização no servidor.'],
        };
      }
    }
    return null;
  },
};

const BURST_WINDOW_MS = 10_000;
const BURST_MIN = 3;

/**
 * Several failures (network errors or 5xx) to the same host in a short window: usually one
 * shared cause (service down, auth expired) rather than independent bugs. Stateful.
 */
export function failureBurstRule(): RequestRule {
  const failures = new Map<string, { id: string; end: number }[]>();
  const counted = new Set<string>();
  return {
    id: 'net.failure-burst',
    evaluate(r, ctx): Finding | null {
      if (r.state === 'pending' || !(r.state === 'failed' || r.status >= 500) || /abort|cancel|ERR_ABORTED|BLOCKED_BY_CLIENT/i.test(r.error ?? '')) return null;
      const host = hostOf(r.url);
      if (!host) return null;
      const end = r.startTime + (r.duration ?? 0);
      let list = failures.get(host);
      if (!list) {
        list = [];
        failures.set(host, list);
        if (failures.size > 200) failures.delete(failures.keys().next().value!);
      }
      if (!counted.has(r.id)) {
        counted.add(r.id);
        list.push({ id: r.id, end });
        if (list.length > 50) list.shift();
      }
      const burst = list.filter((x) => Math.abs(end - x.end) <= BURST_WINDOW_MS);
      if (burst.length < BURST_MIN) return null;
      const thirdParty = isThirdParty(originOfUrl(r.url), ctx.pageOrigin);
      const related: EventRef[] = burst.filter((x) => x.id !== r.id).map((x) => ({ kind: 'request', id: x.id }));
      return {
        ruleId: 'net.failure-burst',
        subject: host,
        category: 'network',
        severity: thirdParty ? 'medium' : 'high',
        title: `Falhas em série em ${host}`,
        description: `${burst.length} requisições para o mesmo host falharam em até ${BURST_WINDOW_MS / 1000} s.`,
        evidence: [`${burst.length} falhas (erro de rede ou HTTP 5xx) para ${host} dentro de ${BURST_WINDOW_MS / 1000} s; a mais recente: ${describe(r)}.`],
        causes: [
          'Uma causa comum às chamadas: serviço fora do ar ou sobrecarregado, sessão expirada, ou problema de rede/DNS para este host.',
          'Também pode ser coincidência de falhas independentes: confira se as rotas e os erros são os mesmos.',
        ],
        impact: 'Tudo o que depende deste host tende a falhar ao mesmo tempo.',
        recommendations: ['Comece pela falha mais antiga da série.', 'Verifique o status do serviço e se a interface degrada bem (retry com backoff, mensagens de indisponibilidade).'],
        event: { kind: 'request', id: r.id },
        time: r.startTime,
        related,
      };
    },
  };
}
