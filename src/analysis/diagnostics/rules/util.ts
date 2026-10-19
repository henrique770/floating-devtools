import type { ConsoleEntry, NetworkEntry, SerializedValue } from '../../../shared/types';
import { originOfUrl, safeUrl } from '../../url';

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n)}…` : s);

export interface ErrorInfo {
  name: string;
  message: string;
  stack?: string;
}

const NAMED_ERROR = /^(?:Uncaught\s+(?:\(in promise\)\s+)?)?([A-Z]\w*(?:Error|Exception))\b:?\s*([\s\S]*)$/;

/** The error an entry is about: an Error argument, or a string like "TypeError: ...". */
export function errorOf(entry: ConsoleEntry): ErrorInfo | undefined {
  for (const a of entry.args) if (a.t === 'error') return { name: a.name, message: a.message, stack: a.stack };
  const first = entry.args[0];
  if (first?.t === 'string') {
    const m = first.v.match(NAMED_ERROR);
    if (m) return { name: m[1], message: m[2].trim() };
  }
  return undefined;
}

function plain(v: SerializedValue): string {
  switch (v.t) {
    case 'string':
      return v.v;
    case 'error':
      return `${v.name}: ${v.message}`;
    case 'object':
      return v.cls;
    case 'boolean':
      return String(v.v);
    case 'function':
      return v.name;
    case 'node':
      return `<${v.tag}>`;
    case 'undefined':
    case 'null':
    case 'circular':
      return v.t;
    default:
      return v.v;
  }
}

/** Whole message as text (for pattern matching), without serializing nested objects. */
export const textOf = (entry: ConsoleEntry) => entry.args.map(plain).join(' ');

export const quote = (entry: ConsoleEntry, n = 200) => clip(`${entry.prefix ? `${entry.prefix} ` : ''}${textOf(entry)}`, n).replace(/\s+/g, ' ');

/** `origin` of the script that logged the entry, if known. */
export function logOrigin(entry: ConsoleEntry): string {
  return entry.source ? originOfUrl(entry.source.url.replace(/:\d+$/, '')) : '';
}

export function isThirdParty(origin: string, pageOrigin: string) {
  return !!origin && origin !== 'null' && !!pageOrigin && origin !== pageOrigin;
}

export const hostOf = (url: string) => {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
};

export const isApi = (r: NetworkEntry) => r.type === 'fetch' || r.type === 'xhr';

export const describe = (r: NetworkEntry) => `${r.method} ${safeUrl(r.url, 140)}`;

export function formatMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(2)} s`;
}

export function formatBytes(n: number): string {
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} kB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

export const sourceLine = (entry: ConsoleEntry) => (entry.source ? `Origem: ${entry.source.label} (${safeUrl(entry.source.url.replace(/:\d+$/, ''), 120)})` : undefined);

export const compact = <T,>(list: (T | undefined | false | null)[]) => list.filter(Boolean) as T[];
