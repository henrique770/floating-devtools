import type { ConsoleEntry } from '../../../shared/types';
import { downgrade, type Finding, type LogRule, type RuleContext } from '../types';
import { defineMessages } from '../../../i18n';
import { common, compact, errorOf, isThirdParty, logOrigin, quote, sourceLine, textOf } from './util';

const m = defineMessages({
  pt: {
    thirdParty: 'O código que registrou o erro é de outra origem (terceiros).',
    quota: {
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
    },
    access: {
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
    },
    persistence: {
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
    },
  },
  en: {
    thirdParty: 'The code that logged the error comes from another origin (third party).',
    quota: {
      title: 'Storage quota exceeded',
      description: 'A write to local storage was refused because the available space ran out.',
      causes: [
        'localStorage/sessionStorage full (the limit is usually ~5 MB per origin).',
        'Repeated writes of large data (serialized state, response cache) without cleanup.',
        'Reduced IndexedDB/Cache Storage quota (incognito mode, low disk space).',
      ],
      impact: 'The data is not persisted; if the exception is not handled, the flow doing the write is interrupted.',
      recommendations: [
        'Wrap setItem/put in try/catch and handle the failure (warn, drop old cache).',
        'Remove old keys or apply a limit/expiration to what is stored.',
        'Use IndexedDB for larger volumes and avoid serializing the whole state on every change.',
      ],
    },
    access: {
      title: 'Storage access denied',
      description: 'The browser refused access to a storage API.',
      causes: [
        'Third-party cookies/storage blocked (iframe or script from another domain).',
        'Sandboxed iframe without allow-same-origin, or an opaque origin (data:, file:).',
        'Browser policy or private browsing mode.',
      ],
      impact: 'Features that depend on saved data (session, preferences, cache) may fail.',
      recommendations: [
        'Check the API is available before using it (try/catch on first access) and keep an in-memory fallback.',
        'If it is an iframe, review the sandbox attributes and the third-party cookie policy.',
      ],
    },
    persistence: {
      title: 'IndexedDB persistence failure',
      description: 'An IndexedDB operation failed.',
      causes: [
        'Transaction used after it completed (await between operations of the same transaction).',
        'Database version conflict (another tab has an old version open).',
        'Non-cloneable value (functions, DOM nodes) or a unique index violation.',
      ],
      impact: 'The data may not have been written or read; local state may become inconsistent.',
      recommendations: [
        'Handle onerror/onblocked/onversionchange and close old connections.',
        'Do not await external operations in the middle of a transaction.',
        'Make sure the written values are serializable.',
      ],
    },
  },
});

type Texts = ReturnType<typeof m>['quota'];
const texts = (x: Texts) => ({ ...x, causes: [...x.causes], recommendations: [...x.recommendations] });

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
    evidence: compact([common().message(quote(entry)), sourceLine(entry), thirdParty && m().thirdParty]),
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
        ...texts(m().quota),
      };
    }

    if (ACCESS.test(text) && STORAGE_API.test(text)) {
      const b = base(entry, ctx, subject);
      return {
        ...b,
        ruleId: 'storage.access',
        severity: b.thirdParty ? 'low' : 'medium',
        ...texts(m().access),
      };
    }

    if ((err && IDB_ERRORS.test(err.name) && /IDB|indexedDB|transaction|object ?store|database/i.test(text)) || /\bIDB(?:Database|Transaction|ObjectStore|Request)\b/.test(text)) {
      const b = base(entry, ctx, subject);
      return {
        ...b,
        ruleId: 'storage.persistence',
        severity: b.thirdParty ? 'low' : 'medium',
        ...texts(m().persistence),
      };
    }
    return null;
  },
};
