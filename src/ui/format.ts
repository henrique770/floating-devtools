import type { NetworkEntry, ResourceType } from '../shared/types';

export function formatBytes(n: number | undefined): string {
  if (n === undefined || n < 0) return '—';
  if (n < 1000) return `${n} B`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(n < 10_000 ? 1 : 0)} kB`;
  return `${(n / 1_000_000).toFixed(1)} MB`;
}

export function formatMs(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

export function formatClock(epoch: number): string {
  const d = new Date(epoch);
  const p = (n: number, l = 2) => String(n).padStart(l, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

export function nameOf(url: string): string {
  try {
    const u = new URL(url);
    if (u.protocol === 'data:') return url.slice(0, 40);
    const last = u.pathname.split('/').filter(Boolean).pop();
    return (last ? decodeURIComponent(last) : u.host) + u.search;
  } catch {
    return url;
  }
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

export const TYPE_FILTERS: { key: string; label: string; match: (t: ResourceType) => boolean }[] = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'api', label: 'Fetch/XHR', match: (t) => t === 'fetch' || t === 'xhr' },
  { key: 'doc', label: 'Doc', match: (t) => t === 'document' },
  { key: 'css', label: 'CSS', match: (t) => t === 'stylesheet' },
  { key: 'js', label: 'JS', match: (t) => t === 'script' },
  { key: 'font', label: 'Font', match: (t) => t === 'font' },
  { key: 'img', label: 'Img', match: (t) => t === 'image' },
  { key: 'media', label: 'Media', match: (t) => t === 'media' },
  { key: 'ws', label: 'Socket', match: (t) => t === 'websocket' },
  { key: 'other', label: 'Other', match: (t) => t === 'other' || t === 'manifest' },
];

export function typeLabel(e: NetworkEntry): string {
  if (e.type === 'image' || e.type === 'font') {
    const ext = nameOf(e.url).split('?')[0].split('.');
    if (ext.length > 1 && ext[ext.length - 1].length <= 5) return ext[ext.length - 1].toLowerCase();
    const sub = e.mimeType?.split(';')[0].split('/')[1]?.replace('svg+xml', 'svg');
    if (sub && sub !== 'html') return sub;
  }
  return e.type;
}

export function sizeLabel(e: NetworkEntry): string {
  if (e.state === 'pending') return '';
  if (e.transferSize) return formatBytes(e.transferSize);
  if (e.fromCache) return e.type === 'fetch' || e.type === 'xhr' ? '(cache)' : '(disk cache)';
  if (e.resourceSize) return formatBytes(e.resourceSize);
  const length = Number(e.responseHeaders?.['content-length']);
  return length ? formatBytes(length) : '—';
}

export function statusLabel(e: NetworkEntry): string {
  if (e.state === 'failed') return e.error?.startsWith('net::') ? e.error.replace('net::', '') : '(failed)';
  if (e.state === 'pending' && !e.status) return '(pending)';
  return e.status ? String(e.status) : '—';
}

export function isErrorEntry(e: NetworkEntry): boolean {
  return e.state === 'failed' || e.status >= 400;
}

export function tryParseJson(text: string | undefined): unknown {
  if (!text) return undefined;
  const t = text.trim();
  if (!(t.startsWith('{') || t.startsWith('['))) return undefined;
  try {
    return JSON.parse(t);
  } catch {
    return undefined;
  }
}

const shellQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export function toCurl(e: NetworkEntry): string {
  const parts = [`curl ${shellQuote(e.url)}`];
  if (e.method !== 'GET') parts.push(`-X ${e.method}`);
  for (const [k, v] of Object.entries(e.requestHeaders ?? {})) parts.push(`-H ${shellQuote(`${k}: ${v}`)}`);
  if (e.requestBody && !e.requestBody.startsWith('[')) parts.push(`--data-raw ${shellQuote(e.requestBody)}`);
  return parts.join(' \\\n  ');
}

export async function copyText(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
  }
}
