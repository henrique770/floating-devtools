import type { NetworkEntry } from '../../../shared/types';
import { originOfUrl } from '../../url';
import { downgrade, type Finding, type LogRule, type RequestRule, type Severity } from '../types';
import { compact, describe, errorOf, isThirdParty, logOrigin, quote, sourceLine, type ErrorInfo } from './util';

interface Explanation {
  title: string;
  description: string;
  causes: string[];
  recommendations: string[];
}

function explain(err: ErrorInfo): Explanation {
  const m = err.message;
  switch (err.name) {
    case 'TypeError':
      if (/reading|of undefined|of null|undefined is not an object|null is not an object|Cannot (?:read|set) propert/i.test(m)) {
        return {
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
        };
      }
      if (/is not a function|is not a constructor|is not iterable/i.test(m)) {
        return {
          title: 'TypeError: valor usado com o tipo errado',
          description: 'Um valor foi chamado como função, construído ou iterado sem ser do tipo esperado.',
          causes: [
            'Import errado (default vs. nomeado) ou versão de biblioteca com API diferente.',
            'Variável sobrescrita, ou dado da API com formato diferente (objeto em vez de lista).',
          ],
          recommendations: ['Confira o import e a versão da dependência no arquivo do stack trace.', 'Valide o tipo do valor antes de usá-lo.'],
        };
      }
      return {
        title: 'TypeError',
        description: 'Uma operação recebeu um valor de tipo inesperado.',
        causes: ['Dado em formato diferente do esperado.', 'Uso incorreto de uma API.'],
        recommendations: ['Inspecione os valores envolvidos no ponto indicado pelo stack trace.'],
      };
    case 'ReferenceError':
      return {
        title: 'ReferenceError: identificador não definido',
        description: 'O código usou uma variável ou função que não existe no escopo.',
        causes: [
          'Script do qual este depende não carregou (ou carregou depois).',
          'Erro de digitação, ou variável usada antes da declaração (`let`/`const` em TDZ).',
          'Global esperada ausente neste navegador/ambiente.',
        ],
        recommendations: ['Confira a ordem de carregamento dos scripts e se o identificador é exportado/importado.', 'Procure falhas de carregamento de scripts nesta página.'],
      };
    case 'SyntaxError':
      if (/JSON|Unexpected token|Unexpected end of (?:JSON )?input|is not valid JSON/i.test(m)) {
        return {
          title: 'SyntaxError ao interpretar JSON',
          description: 'Um texto que não é JSON válido foi passado para `JSON.parse` / `response.json()`.',
          causes: [
            'A resposta foi HTML (página de erro, login, fallback do SPA) em vez de JSON.',
            'Corpo vazio (204, erro sem corpo) interpretado como JSON.',
            'Valor salvo em storage corrompido ou em outro formato.',
          ],
          recommendations: [
            'Verifique o status e o `content-type` antes de chamar `.json()`.',
            'Procure na aba Network a resposta que antecedeu o erro.',
          ],
        };
      }
      return {
        title: 'SyntaxError',
        description: 'Código ou dado com sintaxe inválida.',
        causes: ['Bundle quebrado ou servido truncado.', 'Sintaxe não suportada por este navegador.', 'Script servido como HTML (404 com página de erro).'],
        recommendations: ['Confira se o arquivo indicado carregou com status 200 e o tipo correto.'],
      };
    case 'RangeError':
      return {
        title: 'RangeError',
        description: 'Um valor saiu do intervalo permitido.',
        causes: ['Recursão infinita (Maximum call stack size exceeded).', 'Tamanho de array/data inválido.'],
        recommendations: ['Verifique laços e recursões no ponto do stack trace.'],
      };
    default:
      return {
        title: err.name || 'Erro',
        description: 'Uma exceção foi lançada.',
        causes: ['Veja a mensagem e o stack trace para identificar a origem.'],
        recommendations: ['Inspecione o ponto indicado pelo stack trace.'],
      };
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

    const evidence = compact([
      `Mensagem: ${quote(entry)}`,
      sourceLine(entry),
      !!frames?.length && `Stack: ${frames.join(' ← ')}`,
      uncaught && 'Não foi tratada (chegou ao handler global de erros).',
      !uncaught && !rejection && 'Registrada pela aplicação com console.error (foi capturada pelo código).',
      thirdParty && 'O código que gerou o erro é de outra origem (terceiros).',
    ]);

    let severity: Severity;
    let ex: Explanation;
    if (rejection && (!err || err.name === 'Error')) {
      severity = 'high';
      ex = {
        title: 'Promise rejeitada sem tratamento',
        description: 'Uma Promise foi rejeitada e nenhum `catch` tratou a rejeição.',
        causes: ['Falta `try/catch` em um `await` ou `.catch()` na cadeia.', 'Uma requisição falhou e o erro foi propagado sem tratamento.'],
        recommendations: [
          'Adicione tratamento de erro no ponto que inicia a operação assíncrona.',
          'Verifique na aba Network se alguma requisição falhou logo antes.',
        ],
      };
    } else {
      ex = explain(err!);
      if (rejection) {
        ex = { ...ex, title: `${ex.title} (Promise sem tratamento)`, recommendations: [...ex.recommendations, 'Trate a rejeição (`try/catch` com `await` ou `.catch()`).'] };
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
      impact: uncaught || rejection
        ? 'A execução do código daquele fluxo foi interrompida; a interface pode ficar incompleta ou sem resposta.'
        : 'O erro foi capturado, mas indica que uma operação não concluiu como esperado.',
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
    return {
      ruleId: 'js.script-load',
      subject: r.url.split(/[?#]/)[0],
      category: 'javascript',
      severity: thirdParty ? 'medium' : 'high',
      title: 'Script não carregou',
      description: 'Um arquivo JavaScript referenciado pela página não foi carregado.',
      evidence: compact([
        `${describe(r)} → ${failed ? `falhou (${r.error ?? 'erro de rede'})` : `HTTP ${r.status}`}`,
        thirdParty && 'Script de outra origem (terceiros).',
      ]),
      causes: compact([
        r.status === 404 && 'Arquivo inexistente: deploy novo removeu o chunk antigo, ou caminho/base URL errado.',
        /BLOCKED_BY_CLIENT/.test(r.error ?? '') && 'Bloqueado por uma extensão do navegador (bloqueador de anúncios).',
        failed && !/BLOCKED_BY_CLIENT/.test(r.error ?? '') && 'Falha de rede, DNS ou CSP bloqueando o domínio.',
        r.status >= 500 && 'Erro no servidor/CDN que serve o arquivo.',
      ]),
      impact: 'O código desse arquivo não executa; funcionalidades que dependem dele podem quebrar (ReferenceError em seguida é comum).',
      recommendations: [
        'Confira se a URL existe e se o deploy publicou todos os chunks.',
        'Para chunks carregados sob demanda, trate a falha de import() (ex.: recarregar a página após deploy).',
      ],
      event: { kind: 'request', id: r.id },
      time: r.startTime,
    };
  },
};
