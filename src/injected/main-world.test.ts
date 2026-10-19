// Runs the page hook against minimal stand-ins for the browser globals it touches.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { TO_PAGE, TO_UI, type ConsoleEntry, type NetworkPatch, type PageMessage } from '../shared/types';

const messages: PageMessage[] = [];
const doc = new EventTarget();

function FakeXHR() {}
FakeXHR.prototype = { open() {}, send() {}, setRequestHeader() {} };

let nextFetch: () => Promise<Response>;

beforeAll(async () => {
  vi.stubGlobal('document', doc);
  const win = new EventTarget();
  vi.stubGlobal('window', globalThis);
  vi.stubGlobal('addEventListener', win.addEventListener.bind(win));
  vi.stubGlobal('location', { href: 'https://app.test/', origin: 'https://app.test' });
  vi.stubGlobal('XMLHttpRequest', FakeXHR);
  vi.stubGlobal('fetch', () => nextFetch());
  doc.addEventListener(TO_UI, (e) => messages.push(JSON.parse((e as CustomEvent<string>).detail)));
  await import('./main-world');
  doc.dispatchEvent(new CustomEvent(TO_PAGE, { detail: JSON.stringify({ kind: 'ready' }) }));
});
afterAll(() => vi.unstubAllGlobals());

const flush = () => new Promise((r) => setTimeout(r, 10));
const consoleEntries = () => messages.filter((m): m is { kind: 'console'; entry: ConsoleEntry } => m.kind === 'console').map((m) => m.entry);
const netPatches = () => messages.filter((m): m is { kind: 'net'; patch: NetworkPatch } => m.kind === 'net').map((m) => m.patch);

describe('page hook', () => {
  it('records where a fetch was started', async () => {
    nextFetch = () => Promise.resolve(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    await fetch('https://app.test/api/ok');
    await flush();
    const start = netPatches().find((p) => p.url === 'https://app.test/api/ok')!;
    expect(start.initiator).toMatch(/at /);
  });

  it('links a logged fetch rejection to its request by object identity', async () => {
    nextFetch = () => Promise.reject(new TypeError('Failed to fetch'));
    try {
      await fetch('https://api.other/x');
    } catch (err) {
      console.error(err);
    }
    await flush();
    const id = netPatches().find((p) => p.url === 'https://api.other/x')!.id;
    expect(consoleEntries().at(-1)!.request).toBe(id);
  });

  it('links a response.json() parse error to its request, also through `cause`', async () => {
    nextFetch = () => Promise.resolve(new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }));
    const res = await fetch('https://app.test/api/html');
    try {
      await res.json();
    } catch (err) {
      console.error(new Error('Falha ao carregar usuário', { cause: err }));
    }
    await flush();
    const id = netPatches().find((p) => p.url === 'https://app.test/api/html')!.id;
    expect(consoleEntries().at(-1)!.request).toBe(id);
  });

  it('does not link unrelated errors', async () => {
    console.error(new Error('nada a ver'));
    await flush();
    expect(consoleEntries().at(-1)!.request).toBeUndefined();
  });
});
