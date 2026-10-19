import type { ConsoleEntry } from '../../../shared/types';
import { downgrade, type Finding, type LogRule, type RuleContext } from '../types';
import { compact, errorOf, isThirdParty, logOrigin, quote, sourceLine, textOf } from './util';

const QUOTA = /QuotaExceededError|exceeded the quota|quota (?:has been )?exceeded|NS_ERROR_DOM_QUOTA_REACHED/i;
const STORAGE_API = /localStorage|sessionStorage|indexedDB|IDB\w+|cookie|caches?\b|CacheStorage|storage/i;
const ACCESS = /SecurityError|Access is denied|The operation is insecure|Failed to read the '(?:localStorage|sessionStorage|indexedDB)'/i;
const IDB_ERRORS = /InvalidStateError|VersionError|UnknownError|DataCloneError|ConstraintError|TransactionInactiveError|ReadOnlyError|DataError/;

function base(entry: ConsoleEntry, ctx: RuleContext, subject: string) {
  const thirdParty = isThirdParty(logOrigin(entry), ctx.pageOrigin);
  return {
    subject,
    category: 'storage' as const,
    event: { kind: 'log' as const, id: entry.id },
    time: entry.time,
    thirdParty,
    evidence: compact([`Mensagem: ${quote(entry)}`, sourceLine(entry), thirdParty && 'O código que registrou o erro é de outra origem (terceiros).']),
  };
}

/** Quota, access and persistence failures of the browser storage APIs. Runs before the JavaScript rule. */
export const storageRule: LogRule = {
  id: 'storage',
  evaluate(entry, ctx): Finding | null {
    if (entry.level !== 'error' && entry.level !== 'warn') return null;
    const text = textOf(entry);
    const err = errorOf(entry);
    const subject = entry.group ?? text.slice(0, 200);

    if (err?.name === 'QuotaExceededError' || QUOTA.test(text)) {
      const b = base(entry, ctx, subject);
      return {
        ...b,
        ruleId: 'storage.quota',
        severity: b.thirdParty ? downgrade('high') : 'high',
        title: 'Cota de armazenamento excedida',
        description: 'Uma gravação em armazenamento local foi recusada porque o espaço disponível acabou.',
        causes: [
          'localStorage/sessionStorage cheio (o limite costuma ser ~5 MB por origem).',
          'Gravações repetidas de dados grandes (estado serializado, cache de respostas) sem limpeza.',
          'Cota do IndexedDB/Cache Storage reduzida (modo anônimo, pouco espaço em disco).',
        ],
        impact: 'Os dados não são persistidos; se a exceção não for tratada, o fluxo que fazia a gravação é interrompido.',
        recommendations: [
          'Envolva setItem/put em try/catch e trate a falha (avisar, descartar cache antigo).',
          'Remova chaves antigas ou aplique limite/expiração ao que é guardado.',
          'Use IndexedDB para volumes maiores e evite serializar o estado inteiro a cada mudança.',
        ],
      };
    }

    if (ACCESS.test(text) && STORAGE_API.test(text)) {
      const b = base(entry, ctx, subject);
      return {
        ...b,
        ruleId: 'storage.access',
        severity: b.thirdParty ? 'low' : 'medium',
        title: 'Acesso ao armazenamento negado',
        description: 'O navegador recusou o acesso a uma API de armazenamento.',
        causes: [
          'Cookies/armazenamento de terceiros bloqueados (iframe ou script de outro domínio).',
          'Página em iframe com sandbox sem allow-same-origin, ou origem opaca (data:, file:).',
          'Política do navegador ou modo de navegação privada.',
        ],
        impact: 'Funcionalidades que dependem de dados salvos (sessão, preferências, cache) podem falhar.',
        recommendations: [
          'Verifique a disponibilidade da API antes de usar (try/catch no primeiro acesso) e tenha um fallback em memória.',
          'Se for um iframe, revise os atributos sandbox e a política de cookies de terceiros.',
        ],
      };
    }

    if ((err && IDB_ERRORS.test(err.name) && /IDB|indexedDB|transaction|object ?store|database/i.test(text)) || /\bIDB(?:Database|Transaction|ObjectStore|Request)\b/.test(text)) {
      const b = base(entry, ctx, subject);
      return {
        ...b,
        ruleId: 'storage.persistence',
        severity: b.thirdParty ? 'low' : 'medium',
        title: 'Falha de persistência no IndexedDB',
        description: 'Uma operação do IndexedDB falhou.',
        causes: [
          'Transação usada depois de concluída (await entre operações da mesma transação).',
          'Conflito de versão do banco (outra aba com versão antiga aberta).',
          'Valor não clonável (funções, nós do DOM) ou violação de índice único.',
        ],
        impact: 'Os dados podem não ter sido gravados ou lidos; o estado local pode ficar inconsistente.',
        recommendations: [
          'Trate onerror/onblocked/onversionchange e feche conexões antigas.',
          'Não use await de operações externas no meio de uma transação.',
          'Garanta que os valores gravados são serializáveis.',
        ],
      };
    }
    return null;
  },
};
