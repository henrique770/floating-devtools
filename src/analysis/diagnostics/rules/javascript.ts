import type { NetworkEntry } from '../../../shared/types';
import { originOfUrl } from '../../url';
import { downgrade, type Finding, type LogRule, type RequestRule, type Severity } from '../types';
import { defineMessages } from '../../../i18n';
import { common, compact, describe, errorOf, isThirdParty, logOrigin, quote, sourceLine, type ErrorInfo } from './util';

interface Explanation {
  title: string;
  description: string;
  causes: string[];
  recommendations: string[];
}

const m = defineMessages({
  pt: {
    nullAccess: {
      title: 'TypeError: acesso a propriedade de valor nulo/indefinido',
      description: 'O código tentou ler ou escrever uma propriedade de `undefined` ou `null`.',
      causes: [
        'O dado ainda não foi carregado quando o código executou (render antes da resposta chegar).',
        'A resposta da API veio em formato diferente do esperado (campo ausente, lista vazia, erro em vez de dados).',
        'Ordem de inicialização: um módulo usado antes de ser configurado.',
      ],
      recommendations: [
        'Proteja o acesso (optional chaining `?.`, valores padrão) no ponto indicado pelo stack trace.',
        'Valide a resposta antes de usá-la e trate estados de carregamento/erro.',
      ],
    },
    wrongType: {
      title: 'TypeError: valor usado com o tipo errado',
      description: 'Um valor foi chamado como função, construído ou iterado sem ser do tipo esperado.',
      causes: [
        'Import errado (default vs. nomeado) ou versão de biblioteca com API diferente.',
        'Variável sobrescrita, ou dado da API com formato diferente (objeto em vez de lista).',
      ],
      recommendations: ['Confira o import e a versão da dependência no arquivo do stack trace.', 'Valide o tipo do valor antes de usá-lo.'],
    },
    typeError: {
      title: 'TypeError',
      description: 'Uma operação recebeu um valor de tipo inesperado.',
      causes: ['Dado em formato diferente do esperado.', 'Uso incorreto de uma API.'],
      recommendations: ['Inspecione os valores envolvidos no ponto indicado pelo stack trace.'],
    },
    referenceError: {
      title: 'ReferenceError: identificador não definido',
      description: 'O código usou uma variável ou função que não existe no escopo.',
      causes: [
        'Script do qual este depende não carregou (ou carregou depois).',
        'Erro de digitação, ou variável usada antes da declaração (`let`/`const` em TDZ).',
        'Global esperada ausente neste navegador/ambiente.',
      ],
      recommendations: ['Confira a ordem de carregamento dos scripts e se o identificador é exportado/importado.', 'Procure falhas de carregamento de scripts nesta página.'],
    },
    jsonError: {
      title: 'SyntaxError ao interpretar JSON',
      description: 'Um texto que não é JSON válido foi passado para `JSON.parse` / `response.json()`.',
      causes: [
        'A resposta foi HTML (página de erro, login, fallback do SPA) em vez de JSON.',
        'Corpo vazio (204, erro sem corpo) interpretado como JSON.',
        'Valor salvo em storage corrompido ou em outro formato.',
      ],
      recommendations: ['Verifique o status e o `content-type` antes de chamar `.json()`.', 'Procure na aba Network a resposta que antecedeu o erro.'],
    },
    syntaxError: {
      title: 'SyntaxError',
      description: 'Código ou dado com sintaxe inválida.',
      causes: ['Bundle quebrado ou servido truncado.', 'Sintaxe não suportada por este navegador.', 'Script servido como HTML (404 com página de erro).'],
      recommendations: ['Confira se o arquivo indicado carregou com status 200 e o tipo correto.'],
    },
    rangeError: {
      title: 'RangeError',
      description: 'Um valor saiu do intervalo permitido.',
      causes: ['Recursão infinita (Maximum call stack size exceeded).', 'Tamanho de array/data inválido.'],
      recommendations: ['Verifique laços e recursões no ponto do stack trace.'],
    },
    otherError: {
      title: 'Erro',
      description: 'Uma exceção foi lançada.',
      causes: ['Veja a mensagem e o stack trace para identificar a origem.'],
      recommendations: ['Inspecione o ponto indicado pelo stack trace.'],
    },
    rejection: {
      title: 'Promise rejeitada sem tratamento',
      description: 'Uma Promise foi rejeitada e nenhum `catch` tratou a rejeição.',
      causes: ['Falta `try/catch` em um `await` ou `.catch()` na cadeia.', 'Uma requisição falhou e o erro foi propagado sem tratamento.'],
      recommendations: ['Adicione tratamento de erro no ponto que inicia a operação assíncrona.', 'Verifique na aba Network se alguma requisição falhou logo antes.'],
    },
    unhandledSuffix: (title: string) => `${title} (Promise sem tratamento)`,
    handleRejection: 'Trate a rejeição (`try/catch` com `await` ou `.catch()`).',
    stack: (frames: string) => `Stack: ${frames}`,
    uncaught: 'Não foi tratada (chegou ao handler global de erros).',
    logged: 'Registrada pela aplicação com console.error (foi capturada pelo código).',
    uncaughtImpact: 'A execução do código daquele fluxo foi interrompida; a interface pode ficar incompleta ou sem resposta.',
    loggedImpact: 'O erro foi capturado, mas indica que uma operação não concluiu como esperado.',

    scriptTitle: 'Script não carregou',
    scriptDescription: 'Um arquivo JavaScript referenciado pela página não foi carregado.',
    scriptFailed: (error: string) => `falhou (${error})`,
    thirdPartyScript: 'Script de outra origem (terceiros).',
    script404: 'Arquivo inexistente: deploy novo removeu o chunk antigo, ou caminho/base URL errado.',
    scriptBlocked: 'Bloqueado por uma extensão do navegador (bloqueador de anúncios).',
    scriptNetwork: 'Falha de rede, DNS ou CSP bloqueando o domínio.',
    script5xx: 'Erro no servidor/CDN que serve o arquivo.',
    scriptImpact: 'O código desse arquivo não executa; funcionalidades que dependem dele podem quebrar (ReferenceError em seguida é comum).',
    scriptRecs: [
      'Confira se a URL existe e se o deploy publicou todos os chunks.',
      'Para chunks carregados sob demanda, trate a falha de import() (ex.: recarregar a página após deploy).',
    ],
  },
  en: {
    nullAccess: {
      title: 'TypeError: property access on a null/undefined value',
      description: 'The code tried to read or write a property of `undefined` or `null`.',
      causes: [
        'The data was not loaded yet when the code ran (render before the response arrived).',
        'The API response came in an unexpected shape (missing field, empty list, error instead of data).',
        'Initialization order: a module used before it was configured.',
      ],
      recommendations: [
        'Guard the access (optional chaining `?.`, default values) at the point shown by the stack trace.',
        'Validate the response before using it and handle loading/error states.',
      ],
    },
    wrongType: {
      title: 'TypeError: value used with the wrong type',
      description: 'A value was called as a function, constructed or iterated without being of the expected type.',
      causes: [
        'Wrong import (default vs. named) or a library version with a different API.',
        'Overwritten variable, or API data in a different shape (object instead of list).',
      ],
      recommendations: ['Check the import and the dependency version in the file from the stack trace.', 'Validate the value type before using it.'],
    },
    typeError: {
      title: 'TypeError',
      description: 'An operation received a value of an unexpected type.',
      causes: ['Data in an unexpected format.', 'Incorrect use of an API.'],
      recommendations: ['Inspect the values involved at the point shown by the stack trace.'],
    },
    referenceError: {
      title: 'ReferenceError: identifier not defined',
      description: 'The code used a variable or function that does not exist in scope.',
      causes: [
        'A script this one depends on did not load (or loaded later).',
        'Typo, or variable used before its declaration (`let`/`const` in the TDZ).',
        'Expected global missing in this browser/environment.',
      ],
      recommendations: ['Check the script loading order and whether the identifier is exported/imported.', 'Look for script loading failures on this page.'],
    },
    jsonError: {
      title: 'SyntaxError while parsing JSON',
      description: 'Text that is not valid JSON was passed to `JSON.parse` / `response.json()`.',
      causes: [
        'The response was HTML (error page, login, SPA fallback) instead of JSON.',
        'Empty body (204, error without body) parsed as JSON.',
        'Value saved in storage is corrupted or in another format.',
      ],
      recommendations: ['Check the status and `content-type` before calling `.json()`.', 'Look in the Network tab for the response that preceded the error.'],
    },
    syntaxError: {
      title: 'SyntaxError',
      description: 'Code or data with invalid syntax.',
      causes: ['Broken bundle or served truncated.', 'Syntax not supported by this browser.', 'Script served as HTML (404 with an error page).'],
      recommendations: ['Check that the file loaded with status 200 and the right type.'],
    },
    rangeError: {
      title: 'RangeError',
      description: 'A value is outside the allowed range.',
      causes: ['Infinite recursion (Maximum call stack size exceeded).', 'Invalid array length/date.'],
      recommendations: ['Check loops and recursion at the point in the stack trace.'],
    },
    otherError: {
      title: 'Error',
      description: 'An exception was thrown.',
      causes: ['See the message and stack trace to find the origin.'],
      recommendations: ['Inspect the point shown by the stack trace.'],
    },
    rejection: {
      title: 'Unhandled promise rejection',
      description: 'A Promise was rejected and no `catch` handled the rejection.',
      causes: ['Missing `try/catch` around an `await` or `.catch()` in the chain.', 'A request failed and the error propagated unhandled.'],
      recommendations: ['Add error handling where the async operation starts.', 'Check the Network tab for a request that failed right before.'],
    },
    unhandledSuffix: (title) => `${title} (unhandled Promise)`,
    handleRejection: 'Handle the rejection (`try/catch` with `await`, or `.catch()`).',
    stack: (frames) => `Stack: ${frames}`,
    uncaught: 'Not handled (reached the global error handler).',
    logged: 'Logged by the application with console.error (it was caught by the code).',
    uncaughtImpact: 'Execution of that flow was interrupted; the UI may be left incomplete or unresponsive.',
    loggedImpact: 'The error was caught, but it indicates an operation did not complete as expected.',

    scriptTitle: 'Script failed to load',
    scriptDescription: 'A JavaScript file referenced by the page was not loaded.',
    scriptFailed: (error) => `failed (${error})`,
    thirdPartyScript: 'Script from another origin (third party).',
    script404: 'Missing file: a new deploy removed the old chunk, or wrong path/base URL.',
    scriptBlocked: 'Blocked by a browser extension (ad blocker).',
    scriptNetwork: 'Network failure, DNS or CSP blocking the domain.',
    script5xx: 'Error on the server/CDN serving the file.',
    scriptImpact: 'The code in this file does not run; features that depend on it may break (a ReferenceError right after is common).',
    scriptRecs: [
      'Check that the URL exists and that the deploy published every chunk.',
      'For lazily loaded chunks, handle import() failures (e.g. reload the page after a deploy).',
    ],
  },
});

const copy = (ex: Explanation): Explanation => ({ ...ex, causes: [...ex.causes], recommendations: [...ex.recommendations] });

function explain(err: ErrorInfo): Explanation {
  const t = m();
  const msg = err.message;
  switch (err.name) {
    case 'TypeError':
      if (/reading|of undefined|of null|undefined is not an object|null is not an object|Cannot (?:read|set) propert/i.test(msg)) return copy(t.nullAccess);
      if (/is not a function|is not a constructor|is not iterable/i.test(msg)) return copy(t.wrongType);
      return copy(t.typeError);
    case 'ReferenceError':
      return copy(t.referenceError);
    case 'SyntaxError':
      return copy(/JSON|Unexpected token|Unexpected end of (?:JSON )?input|is not valid JSON/i.test(msg) ? t.jsonError : t.syntaxError);
    case 'RangeError':
      return copy(t.rangeError);
    default:
      return { ...copy(t.otherError), title: err.name || t.otherError.title };
  }
}

/** Uncaught exceptions, unhandled rejections and Error objects logged with console.error. */
export const javascriptRule: LogRule = {
  id: 'javascript',
  evaluate(entry, ctx): Finding | null {
    if (entry.level !== 'error') return null;
    const err = errorOf(entry);
    const uncaught = entry.prefix === 'Uncaught';
    const rejection = entry.prefix === 'Uncaught (in promise)';
    // A plain console.error("...") is the app's own logging, not necessarily a problem: leave it alone.
    if (!err && !rejection) return null;
    const thirdParty = isThirdParty(logOrigin(entry), ctx.pageOrigin);
    const subject = entry.group ?? quote(entry, 300);
    const frames = err?.stack
      ?.split('\n')
      .filter((l) => l.trim().startsWith('at '))
      .slice(0, 2)
      .map((l) => l.trim());

    const t = m();
    const evidence = compact([
      common().message(quote(entry)),
      sourceLine(entry),
      !!frames?.length && t.stack(frames.join(' ← ')),
      uncaught && t.uncaught,
      !uncaught && !rejection && t.logged,
      thirdParty && common().thirdPartyCode,
    ]);

    let severity: Severity;
    let ex: Explanation;
    if (rejection && (!err || err.name === 'Error')) {
      severity = 'high';
      ex = copy(t.rejection);
    } else {
      ex = explain(err!);
      if (rejection) {
        ex = { ...ex, title: t.unhandledSuffix(ex.title), recommendations: [...ex.recommendations, t.handleRejection] };
      }
      severity = uncaught || rejection ? 'high' : 'medium';
    }
    if (thirdParty) severity = downgrade(severity);

    return {
      ruleId: rejection ? 'js.unhandled-rejection' : uncaught ? 'js.uncaught' : 'js.logged-error',
      subject,
      category: 'javascript',
      severity,
      ...ex,
      evidence,
      impact: uncaught || rejection ? t.uncaughtImpact : t.loggedImpact,
      event: { kind: 'log', id: entry.id },
      time: entry.time,
    };
  },
};

/** Scripts that failed to load (network failure or HTTP error). */
export const scriptLoadRule: RequestRule = {
  id: 'js.script-load',
  evaluate(r: NetworkEntry, ctx): Finding | null {
    if (r.type !== 'script' || r.state === 'pending') return null;
    const failed = r.state === 'failed';
    if (!failed && r.status < 400) return null;
    const thirdParty = isThirdParty(originOfUrl(r.url), ctx.pageOrigin);
    const t = m();
    return {
      ruleId: 'js.script-load',
      subject: r.url.split(/[?#]/)[0],
      category: 'javascript',
      severity: thirdParty ? 'medium' : 'high',
      title: t.scriptTitle,
      description: t.scriptDescription,
      evidence: compact([`${describe(r)} → ${failed ? t.scriptFailed(r.error ?? common().networkError) : `HTTP ${r.status}`}`, thirdParty && t.thirdPartyScript]),
      causes: compact([
        r.status === 404 && t.script404,
        /BLOCKED_BY_CLIENT/.test(r.error ?? '') && t.scriptBlocked,
        failed && !/BLOCKED_BY_CLIENT/.test(r.error ?? '') && t.scriptNetwork,
        r.status >= 500 && t.script5xx,
      ]),
      impact: t.scriptImpact,
      recommendations: [...t.scriptRecs],
      event: { kind: 'request', id: r.id },
      time: r.startTime,
    };
  },
};
