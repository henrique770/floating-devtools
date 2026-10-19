/**
 * Fingerprints console entries so equivalent messages can be grouped.
 *
 * Two entries share a fingerprint when they have the same level and prefix, the same message
 * once volatile parts (ids, long numbers, query strings) are normalized, and the same origin
 * and top stack frames. The call site is part of the key on purpose: two errors with the same
 * text thrown from different places are different problems and stay in separate groups.
 */
import type { ConsoleEntry, SerializedValue } from '../shared/types';

const MAX_TEXT = 500;
const MAX_FRAMES = 3;
const SEP = '\u0001';

const UUID = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const LONG_HEX = /\b(?:0x[0-9a-f]+|[0-9a-f]{12,})\b/gi;
// Short integers (HTTP statuses, indexes, small counts) are kept: "Error 404" and "Error 500"
// are different problems. Decimals (timings) and 4+ digit numbers (ids, timestamps) vary per call.
const VOLATILE_NUMBER = /\d+\.\d+|\d{4,}/g;
const URL_IN_TEXT = /\b[a-z][\w+.-]*:\/\/[^\s'"`)<>]+/gi;
const ID_SEGMENT = /^(?:\d+|[0-9a-f]{12,}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;
// Content hashes in bundle file names: index-B3x9kQ12.js, main.3f2a9c1b.chunk.js
const BUNDLE_HASH = /([.-])[A-Za-z0-9_]{8,}(?=\.(?:chunk\.)?m?js\b)/g;

/** Drops query/hash and replaces id-like path segments, keeping the endpoint recognizable. */
export function normalizeUrl(url: string): string {
  const [base] = url.split(/[?#]/);
  const m = base.match(/^([a-z][\w+.-]*:\/\/[^/]*)(.*)$/i);
  if (!m) return base;
  const path = m[2]
    .split('/')
    .map((seg) => (ID_SEGMENT.test(seg) ? '<id>' : seg))
    .join('/');
  return m[1] + path;
}

export function normalizeMessage(text: string): string {
  return text
    .replace(URL_IN_TEXT, (u) => normalizeUrl(u))
    .replace(UUID, '<uuid>')
    .replace(LONG_HEX, '<hex>')
    .replace(VOLATILE_NUMBER, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_TEXT);
}

/** `at fn (https://x/a.js?v=3:10:5)` -> `fn (https://x/a.js:10:5)`. Line and column are kept. */
export function normalizeFrame(frame: string): string {
  return frame
    .trim()
    .replace(/^at\s+/, '')
    .replace(/\?[^\s:)#]*/g, '')
    .replace(/#[^\s:)]*/g, '')
    .replace(UUID, '<uuid>')
    .replace(BUNDLE_HASH, '$1<hash>');
}

const isFrame = (line: string) => {
  const l = line.trim();
  return l.startsWith('at ') || /@\S+:\d+:\d+$/.test(l);
};

/** Top frames of a stack trace, normalized. */
export function topFrames(stack: string | undefined, max = MAX_FRAMES): string[] {
  if (!stack) return [];
  const out: string[] = [];
  for (const line of stack.split('\n')) {
    if (!isFrame(line)) continue;
    out.push(normalizeFrame(line));
    if (out.length >= max) break;
  }
  return out;
}

/** Shape of a value for grouping: strings are normalized, objects contribute only their keys. */
function textOf(v: SerializedValue): string {
  switch (v.t) {
    case 'string':
      return normalizeMessage(v.v);
    case 'error':
      return `${v.name}: ${normalizeMessage(v.message)}`;
    case 'boolean':
      return String(v.v);
    case 'number':
    case 'bigint':
      return normalizeMessage(v.v);
    case 'undefined':
    case 'null':
    case 'circular':
      return v.t;
    case 'function':
      return `ƒ ${v.name}`;
    case 'node':
      return `<${v.tag}>`;
    case 'object':
      return `${v.cls}{${v.entries
        .slice(0, 10)
        .map(([k]) => k)
        .join(',')}}`;
    default:
      return v.t;
  }
}

/** Grouping key of an entry. Commands typed in the prompt and their results are never grouped. */
export function fingerprint(entry: ConsoleEntry): string {
  if (entry.level === 'command' || entry.level === 'result') return `${entry.level}${SEP}${entry.id}`;
  const error = entry.args.find((a): a is Extract<SerializedValue, { t: 'error' }> => a.t === 'error');
  const errorFrames = topFrames(error?.stack);
  const frames = errorFrames.length ? errorFrames : topFrames(entry.stack);
  const text = entry.args.map(textOf).join(' ').slice(0, MAX_TEXT);
  const source = entry.source ? normalizeFrame(entry.source.url) : '';
  return [entry.level, entry.prefix ?? '', text, source, frames.join('|')].join(SEP);
}
