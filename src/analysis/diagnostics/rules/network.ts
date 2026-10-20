import type { NetworkEntry } from '../../../shared/types';
import { normalizeUrl } from '../../fingerprint';
import { originOfUrl } from '../../url';
import { downgrade, type EventRef, type Finding, type RequestRule, type Severity } from '../types';
import { defineMessages } from '../../../i18n';
import { common, compact, describe, hostOf, isApi, isThirdParty } from './util';

const subjectOf = (r: NetworkEntry, extra: string | number) => `${r.method} ${normalizeUrl(r.url)} ${extra}`;

const MAX_JSON_CHECK = 200_000;

const m = defineMessages({
  pt: {
    type: (t: string) => `Tipo: ${t}`,
    response: (body: string) => `Resposta: ${body}`,
    serverTitle: (s: number) => `Erro do servidor (HTTP ${s})`,
    gatewayCauses: ['Servidor de origem indisponível, sobrecarregado ou lento demais para o proxy/gateway.', 'Deploy em andamento ou serviço dependente fora do ar.'],
    serverCauses: ['Exceção não tratada no servidor.', 'Payload enviado em formato que o servidor não esperava.'],
    serverRecs: ['Consulte os logs do servidor para esta rota e horário.', 'Garanta que a interface trate a falha (mensagem, nova tentativa).'],
    serverImpact: 'A operação não foi concluída no servidor; a interface pode exibir dados incompletos ou ficar sem resposta.',
    unauthTitle: 'Não autenticado (HTTP 401)',
    forbiddenTitle: 'Acesso negado (HTTP 403)',
    unauthCauses: ['Token/sessão expirado ou ausente.', 'Header de autenticação não enviado nesta chamada.'],
    forbiddenCauses: ['Usuário sem permissão para o recurso.', 'Proteção CSRF/origem recusou a chamada.'],
    authRecs: ['Confira se a chamada envia a credencial esperada e se ela está válida.', 'Trate a renovação de sessão ou redirecione para login.'],
    authImpact: 'O usuário não recebe os dados ou a ação é recusada.',
    notFoundTitle: 'Recurso não encontrado (HTTP 404)',
    notFoundCauses: ['URL incorreta (caminho, id ou base URL).', 'Recurso removido ou ainda não publicado.'],
    notFoundRecs: ['Confira a URL gerada e a rota no servidor.'],
    notFoundApiImpact: 'Os dados esperados não chegam à interface.',
    notFoundImpact: 'O recurso não é exibido ou aplicado.',
    rateTitle: 'Limite de requisições (HTTP 429)',
    rateCauses: ['Excesso de chamadas em pouco tempo (polling agressivo, laço de re-render, requisições duplicadas).'],
    rateRecs: ['Reduza a frequência, aplique debounce/cache e respeite o header Retry-After.'],
    rateImpact: 'Chamadas são recusadas até o limite ser liberado.',
    refusedTitle: (s: number) => `Requisição recusada (HTTP ${s})`,
    refusedCauses: ['Parâmetros ou corpo inválidos para o servidor.', 'Estado do recurso incompatível com a operação.'],
    refusedRecs: ['Leia a resposta do servidor (aba Network → Response) para o detalhe da validação.'],
    refusedImpact: 'A operação foi recusada pelo servidor.',
    httpDescription: (method: string, host: string, s: number) => `${method} ${host} respondeu com status ${s}.`,

    failed: (req: string, error: string) => `${req} → falhou: ${error}`,
    webError: (error: string) => `Erro visto pela extensão (webRequest): ${error}`,
    notDelivered: (status: string) => `O servidor respondeu HTTP ${status}, mas a página não recebeu a resposta.`,
    abortedTitle: 'Requisição cancelada',
    abortedDescription: 'A requisição foi abortada antes de terminar.',
    abortedCauses: ['AbortController acionado (componente desmontado, nova busca substituindo a anterior).', 'Navegação para outra página durante a requisição.'],
    abortedImpact: 'Normalmente nenhum, quando o cancelamento é intencional.',
    abortedRecs: ['Se o cancelamento não for esperado, verifique quem chama abort() e se o erro AbortError é tratado.'],
    timeoutTitle: 'Timeout de requisição',
    timeoutDescription: 'A requisição excedeu o tempo limite.',
    timeoutCauses: ['Servidor lento ou travado nesta rota.', 'Rede instável ou limite de timeout curto demais para a operação.'],
    timeoutImpact: 'A operação não é concluída e o usuário espera sem resposta.',
    timeoutRecs: ['Meça o tempo da rota no servidor.', 'Ajuste o timeout ao tipo de operação e mostre feedback/nova tentativa.'],
    blockedTitle: 'Bloqueada pelo navegador do usuário',
    blockedDescription: 'A requisição foi bloqueada antes de sair do navegador (net::ERR_BLOCKED_BY_CLIENT).',
    blockedCauses: ['Extensão de bloqueio de anúncios/rastreadores.'],
    blockedImpact: 'Usuários com bloqueadores não carregam este recurso; se ele for essencial, a página quebra para eles.',
    blockedRecs: ['Garanta que a aplicação funcione sem este recurso, ou evite nomes de URL comuns em listas de bloqueio (ads, track, analytics).'],
    connectionTitle: 'Falha de conexão',
    connectionDescription: 'Não foi possível estabelecer conexão com o servidor.',
    connectionCauses: ['DNS não resolve o host, servidor fora do ar ou recusando conexões.', 'Certificado TLS inválido.', 'Usuário sem internet.'],
    connectionImpact: 'Nenhum dado chega deste host.',
    connectionRecs: ['Confira o host/porta configurados para este ambiente e se o serviço está no ar.'],
    corsTitle: 'Possível bloqueio de CORS',
    corsAnswered: 'O servidor respondeu, mas o navegador não entregou a resposta à página — o padrão de um bloqueio de CORS. O navegador não informa o motivo à página, então isto não é confirmado.',
    corsGeneric: 'Chamada para outra origem falhou com erro de rede genérico. CORS é uma causa comum, mas não é possível confirmá-la com os dados capturados.',
    corsCauses: [
      'O servidor não envia Access-Control-Allow-Origin para esta origem (ou envia * com credenciais).',
      'O preflight (OPTIONS) foi recusado ou não permite o método/header usado.',
    ],
    corsNetworkCause: 'Falha de rede ou servidor indisponível (também produz o mesmo erro).',
    corsImpact: 'A página não consegue ler a resposta; a funcionalidade que depende dela falha.',
    corsRecs: [
      'Veja a mensagem de CORS no console nativo do navegador (o motivo exato aparece só lá).',
      'Configure no servidor Access-Control-Allow-Origin/Methods/Headers para esta origem.',
    ],
    failureTitle: 'Falha de rede',
    failureDescription: 'A requisição falhou sem resposta do servidor.',
    failureCauses: ['Conexão interrompida, servidor indisponível ou bloqueio por política (CSP, mixed content).'],
    failureImpact: 'Os dados desta chamada não chegaram.',
    failureRecs: ['Repita a ação e compare o erro; verifique o console nativo para mensagens de CSP ou mixed content.'],

    htmlTitle: 'HTML recebido em chamada de API',
    htmlDescription: (s: number) => `A chamada respondeu ${s} com content-type HTML, mas parece esperar JSON.`,
    acceptSent: (accept: string) => `Accept enviado: ${accept}`,
    responseStart: (body: string) => `Início da resposta: ${body}`,
    htmlCauses: ['URL errada caindo no fallback do SPA (index.html).', 'Redirecionamento para página de login.', 'Proxy/servidor devolvendo página de erro com status 200.'],
    htmlImpact: 'O parse como JSON falha (SyntaxError) ou a interface recebe dados inválidos.',
    htmlRecs: ['Confira a URL/base URL da API neste ambiente.', 'Valide o content-type antes de interpretar a resposta.'],
    jsonTitle: 'JSON inválido na resposta',
    jsonDescription: 'O servidor declarou JSON, mas o corpo não é um JSON válido.',
    parseError: (err: string) => `Erro de parse: ${err}`,
    jsonCauses: ['Resposta truncada.', 'Saída extra no servidor (avisos, BOM, logs) antes do JSON.', 'Serialização incorreta no servidor.'],
    jsonImpact: 'O cliente não consegue interpretar a resposta.',
    jsonRecs: ['Inspecione o corpo na aba Network → Response e corrija a serialização no servidor.'],

    burstTitle: (host: string) => `Falhas em série em ${host}`,
    burstDescription: (n: number, s: number) => `${n} requisições para o mesmo host falharam em até ${s} s.`,
    burstEvidence: (n: number, host: string, s: number, req: string) => `${n} falhas (erro de rede ou HTTP 5xx) para ${host} dentro de ${s} s; a mais recente: ${req}.`,
    burstCauses: [
      'Uma causa comum às chamadas: serviço fora do ar ou sobrecarregado, sessão expirada, ou problema de rede/DNS para este host.',
      'Também pode ser coincidência de falhas independentes: confira se as rotas e os erros são os mesmos.',
    ],
    burstImpact: 'Tudo o que depende deste host tende a falhar ao mesmo tempo.',
    burstRecs: ['Comece pela falha mais antiga da série.', 'Verifique o status do serviço e se a interface degrada bem (retry com backoff, mensagens de indisponibilidade).'],
  },
  en: {
    type: (t) => `Type: ${t}`,
    response: (body) => `Response: ${body}`,
    serverTitle: (s) => `Server error (HTTP ${s})`,
    gatewayCauses: ['Origin server unavailable, overloaded or too slow for the proxy/gateway.', 'Deploy in progress or a dependent service is down.'],
    serverCauses: ['Unhandled exception on the server.', 'Payload sent in a format the server did not expect.'],
    serverRecs: ['Check the server logs for this route and time.', 'Make sure the UI handles the failure (message, retry).'],
    serverImpact: 'The operation did not complete on the server; the UI may show incomplete data or stop responding.',
    unauthTitle: 'Not authenticated (HTTP 401)',
    forbiddenTitle: 'Access denied (HTTP 403)',
    unauthCauses: ['Expired or missing token/session.', 'Authentication header not sent on this call.'],
    forbiddenCauses: ['User lacks permission for the resource.', 'CSRF/origin protection rejected the call.'],
    authRecs: ['Check that the call sends the expected credential and that it is valid.', 'Handle session renewal or redirect to login.'],
    authImpact: 'The user does not get the data, or the action is refused.',
    notFoundTitle: 'Resource not found (HTTP 404)',
    notFoundCauses: ['Wrong URL (path, id or base URL).', 'Resource removed or not published yet.'],
    notFoundRecs: ['Check the generated URL and the route on the server.'],
    notFoundApiImpact: 'The expected data never reaches the UI.',
    notFoundImpact: 'The resource is not displayed or applied.',
    rateTitle: 'Rate limited (HTTP 429)',
    rateCauses: ['Too many calls in a short time (aggressive polling, re-render loop, duplicated requests).'],
    rateRecs: ['Reduce the frequency, apply debounce/caching and honor the Retry-After header.'],
    rateImpact: 'Calls are refused until the limit resets.',
    refusedTitle: (s) => `Request refused (HTTP ${s})`,
    refusedCauses: ['Parameters or body invalid for the server.', 'Resource state incompatible with the operation.'],
    refusedRecs: ['Read the server response (Network tab → Response) for the validation details.'],
    refusedImpact: 'The server refused the operation.',
    httpDescription: (method, host, s) => `${method} ${host} responded with status ${s}.`,

    failed: (req, error) => `${req} → failed: ${error}`,
    webError: (error) => `Error seen by the extension (webRequest): ${error}`,
    notDelivered: (status) => `The server responded HTTP ${status}, but the page did not receive the response.`,
    abortedTitle: 'Request cancelled',
    abortedDescription: 'The request was aborted before it finished.',
    abortedCauses: ['AbortController triggered (component unmounted, a new search replacing the previous one).', 'Navigation to another page during the request.'],
    abortedImpact: 'Usually none, when the cancellation is intentional.',
    abortedRecs: ['If the cancellation is unexpected, check who calls abort() and whether AbortError is handled.'],
    timeoutTitle: 'Request timeout',
    timeoutDescription: 'The request exceeded the time limit.',
    timeoutCauses: ['Slow or stuck server on this route.', 'Unstable network or a timeout too short for the operation.'],
    timeoutImpact: 'The operation does not complete and the user waits with no response.',
    timeoutRecs: ['Measure the route time on the server.', 'Fit the timeout to the kind of operation and show feedback/retry.'],
    blockedTitle: "Blocked by the user's browser",
    blockedDescription: 'The request was blocked before leaving the browser (net::ERR_BLOCKED_BY_CLIENT).',
    blockedCauses: ['Ad/tracker blocking extension.'],
    blockedImpact: 'Users with blockers do not load this resource; if it is essential, the page breaks for them.',
    blockedRecs: ['Make sure the app works without this resource, or avoid URL names common in block lists (ads, track, analytics).'],
    connectionTitle: 'Connection failure',
    connectionDescription: 'Could not establish a connection to the server.',
    connectionCauses: ['DNS does not resolve the host, the server is down or refusing connections.', 'Invalid TLS certificate.', 'User is offline.'],
    connectionImpact: 'No data arrives from this host.',
    connectionRecs: ['Check the host/port configured for this environment and whether the service is up.'],
    corsTitle: 'Possible CORS block',
    corsAnswered: 'The server responded, but the browser did not hand the response to the page — the pattern of a CORS block. The browser does not tell the page why, so this is not confirmed.',
    corsGeneric: 'A call to another origin failed with a generic network error. CORS is a common cause, but it cannot be confirmed from the captured data.',
    corsCauses: [
      'The server does not send Access-Control-Allow-Origin for this origin (or sends * with credentials).',
      'The preflight (OPTIONS) was refused or does not allow the method/header used.',
    ],
    corsNetworkCause: 'Network failure or unavailable server (produces the same error).',
    corsImpact: 'The page cannot read the response; the feature that depends on it fails.',
    corsRecs: [
      "See the CORS message in the browser's native console (the exact reason only appears there).",
      'Configure Access-Control-Allow-Origin/Methods/Headers for this origin on the server.',
    ],
    failureTitle: 'Network failure',
    failureDescription: 'The request failed with no response from the server.',
    failureCauses: ['Interrupted connection, unavailable server or a policy block (CSP, mixed content).'],
    failureImpact: 'The data from this call never arrived.',
    failureRecs: ['Repeat the action and compare the error; check the native console for CSP or mixed content messages.'],

    htmlTitle: 'HTML received in an API call',
    htmlDescription: (s) => `The call responded ${s} with an HTML content-type, but seems to expect JSON.`,
    acceptSent: (accept) => `Accept sent: ${accept}`,
    responseStart: (body) => `Response starts with: ${body}`,
    htmlCauses: ['Wrong URL hitting the SPA fallback (index.html).', 'Redirect to a login page.', 'Proxy/server returning an error page with status 200.'],
    htmlImpact: 'Parsing as JSON fails (SyntaxError) or the UI receives invalid data.',
    htmlRecs: ['Check the API URL/base URL in this environment.', 'Validate the content-type before interpreting the response.'],
    jsonTitle: 'Invalid JSON in response',
    jsonDescription: 'The server declared JSON, but the body is not valid JSON.',
    parseError: (err) => `Parse error: ${err}`,
    jsonCauses: ['Truncated response.', 'Extra output on the server (warnings, BOM, logs) before the JSON.', 'Wrong serialization on the server.'],
    jsonImpact: 'The client cannot interpret the response.',
    jsonRecs: ['Inspect the body in the Network tab → Response and fix the serialization on the server.'],

    burstTitle: (host) => `Repeated failures on ${host}`,
    burstDescription: (n, s) => `${n} requests to the same host failed within ${s} s.`,
    burstEvidence: (n, host, s, req) => `${n} failures (network error or HTTP 5xx) to ${host} within ${s} s; the latest: ${req}.`,
    burstCauses: [
      'A cause shared by the calls: service down or overloaded, expired session, or a network/DNS problem for this host.',
      'It may also be a coincidence of independent failures: check whether the routes and errors are the same.',
    ],
    burstImpact: 'Everything that depends on this host tends to fail at the same time.',
    burstRecs: ['Start with the oldest failure in the series.', 'Check the service status and whether the UI degrades gracefully (retry with backoff, unavailability messages).'],
  },
});

function httpError(r: NetworkEntry, thirdParty: boolean): Omit<Finding, 'ruleId' | 'subject' | 'event' | 'time' | 'category'> {
  const t = m();
  const s = r.status;
  const evidence = compact([
    `${describe(r)} → HTTP ${s}${r.statusText ? ` ${r.statusText}` : ''}`,
    r.type !== 'fetch' && r.type !== 'xhr' && t.type(r.type),
    thirdParty && common().thirdPartyHost(hostOf(r.url)),
    r.responseBody && isApi(r) && t.response(r.responseBody.replace(/\s+/g, ' ').slice(0, 160)),
  ]);
  let severity: Severity;
  let title: string;
  let causes: string[];
  let recommendations: string[];
  let impact: string;
  if (s >= 500) {
    severity = 'high';
    title = t.serverTitle(s);
    causes = s === 502 || s === 503 || s === 504 ? t.gatewayCauses : t.serverCauses;
    recommendations = t.serverRecs;
    impact = t.serverImpact;
  } else if (s === 401 || s === 403) {
    severity = 'medium';
    title = s === 401 ? t.unauthTitle : t.forbiddenTitle;
    causes = s === 401 ? t.unauthCauses : t.forbiddenCauses;
    recommendations = t.authRecs;
    impact = t.authImpact;
  } else if (s === 404) {
    severity = isApi(r) || r.type === 'document' ? 'medium' : 'low';
    title = t.notFoundTitle;
    causes = t.notFoundCauses;
    recommendations = t.notFoundRecs;
    impact = isApi(r) ? t.notFoundApiImpact : t.notFoundImpact;
  } else if (s === 429) {
    severity = 'medium';
    title = t.rateTitle;
    causes = t.rateCauses;
    recommendations = t.rateRecs;
    impact = t.rateImpact;
  } else {
    severity = s === 400 || s === 422 || s === 409 ? 'medium' : 'low';
    title = t.refusedTitle(s);
    causes = t.refusedCauses;
    recommendations = t.refusedRecs;
    impact = t.refusedImpact;
  }
  if (/\/favicon\.ico$/.test(r.url.split(/[?#]/)[0])) severity = 'info';
  else if (thirdParty) severity = downgrade(severity);
  return { severity, title, description: t.httpDescription(r.method, hostOf(r.url), s), evidence, causes: [...causes], impact, recommendations: [...recommendations] };
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
    const t = m();
    const kind = classifyFailure(r, ctx.pageOrigin);
    const thirdParty = isThirdParty(originOfUrl(r.url), ctx.pageOrigin);
    const errorText = r.error ?? common().networkError;
    const evidence = compact([
      t.failed(describe(r), errorText),
      r.web?.error && r.web.error !== r.error && t.webError(r.web.error),
      !!r.web?.status && t.notDelivered(`${r.web.status}${r.web.method !== r.method ? ` (${r.web.method})` : ''}`),
      thirdParty && common().thirdPartyHost(hostOf(r.url)),
    ]);
    const base = { subject: subjectOf(r, kind), category: 'network' as const, evidence, event: { kind: 'request' as const, id: r.id }, time: r.startTime };

    switch (kind) {
      case 'aborted':
        return {
          ...base,
          ruleId: 'net.cancelled',
          severity: 'info',
          title: t.abortedTitle,
          description: t.abortedDescription,
          causes: [...t.abortedCauses],
          impact: t.abortedImpact,
          recommendations: [...t.abortedRecs],
        };
      case 'timeout':
        return {
          ...base,
          ruleId: 'net.timeout',
          severity: thirdParty ? 'medium' : 'high',
          title: t.timeoutTitle,
          description: t.timeoutDescription,
          causes: [...t.timeoutCauses],
          impact: t.timeoutImpact,
          recommendations: [...t.timeoutRecs],
        };
      case 'blocked':
        return {
          ...base,
          ruleId: 'net.blocked-by-client',
          severity: 'info',
          title: t.blockedTitle,
          description: t.blockedDescription,
          causes: [...t.blockedCauses],
          impact: t.blockedImpact,
          recommendations: [...t.blockedRecs],
        };
      case 'connection':
        return {
          ...base,
          ruleId: 'net.connection',
          severity: thirdParty ? 'medium' : 'high',
          title: t.connectionTitle,
          description: t.connectionDescription,
          causes: [...t.connectionCauses],
          impact: t.connectionImpact,
          recommendations: [...t.connectionRecs],
        };
      case 'cors':
        return {
          ...base,
          ruleId: 'net.possible-cors',
          severity: thirdParty ? 'medium' : 'high',
          title: t.corsTitle,
          description: r.web?.status ? t.corsAnswered : t.corsGeneric,
          causes: [...t.corsCauses, ...(r.web?.status ? [] : [t.corsNetworkCause])],
          impact: t.corsImpact,
          recommendations: [...t.corsRecs],
        };
      default:
        return {
          ...base,
          ruleId: 'net.failure',
          severity: thirdParty ? 'low' : 'medium',
          title: t.failureTitle,
          description: t.failureDescription,
          causes: [...t.failureCauses],
          impact: t.failureImpact,
          recommendations: [...t.failureRecs],
        };
    }
  },
};

/** API calls that succeeded but returned something the caller most likely can't use. */
export const unexpectedResponseRule: RequestRule = {
  id: 'net.unexpected-response',
  evaluate(r, ctx): Finding | null {
    if (!isApi(r) || r.state !== 'done' || r.status < 200 || r.status >= 300) return null;
    const t = m();
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
        title: t.htmlTitle,
        description: t.htmlDescription(r.status),
        evidence: compact([
          `${describe(r)} → HTTP ${r.status}, content-type: ${r.mimeType}`,
          accept && t.acceptSent(accept),
          r.responseBody && t.responseStart(r.responseBody.trim().slice(0, 100).replace(/\s+/g, ' ')),
        ]),
        causes: [...t.htmlCauses],
        impact: t.htmlImpact,
        recommendations: [...t.htmlRecs],
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
          title: t.jsonTitle,
          description: t.jsonDescription,
          evidence: [`${describe(r)} → HTTP ${r.status}, content-type: ${r.mimeType}`, t.parseError(String(err).slice(0, 120))],
          causes: [...t.jsonCauses],
          impact: t.jsonImpact,
          recommendations: [...t.jsonRecs],
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
      const t = m();
      const secs = BURST_WINDOW_MS / 1000;
      return {
        ruleId: 'net.failure-burst',
        subject: host,
        category: 'network',
        severity: thirdParty ? 'medium' : 'high',
        title: t.burstTitle(host),
        description: t.burstDescription(burst.length, secs),
        evidence: [t.burstEvidence(burst.length, host, secs, describe(r))],
        causes: [...t.burstCauses],
        impact: t.burstImpact,
        recommendations: [...t.burstRecs],
        event: { kind: 'request', id: r.id },
        time: r.startTime,
        related,
      };
    },
  };
}
