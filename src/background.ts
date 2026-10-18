/**
 * Service worker. Observes the tab's requests with chrome.webRequest to fill in what the
 * page itself cannot see for static resources (status code, headers, cache, failures),
 * handles the toolbar icon / keyboard shortcut, and calls the AI provider for the assistant.
 */
import { AI_CONFIG_KEY, AI_PORT, EMPTY_AI_CONFIG, providerById, type AiConfig, type AiRequest, type AiResponse } from './shared/ai';
import type { BackgroundMessage, WebRequestInfo } from './shared/types';

const ALL = { urls: ['<all_urls>'] };
const requestHeaders = new Map<string, Record<string, string>>();

const toObject = (headers?: chrome.webRequest.HttpHeader[]) => {
  if (!headers) return undefined;
  const out: Record<string, string> = {};
  for (const h of headers) out[h.name.toLowerCase()] = h.value ?? '';
  return out;
};

const send = (tabId: number, message: BackgroundMessage) =>
  chrome.tabs.sendMessage(tabId, message, { frameId: 0 }).catch(() => {
    /* tab has no content script (chrome:// pages, still loading, etc.) */
  });

chrome.webRequest.onSendHeaders.addListener(
  (d) => {
    if (d.tabId >= 0 && d.frameId === 0) requestHeaders.set(d.requestId, toObject(d.requestHeaders) ?? {});
  },
  ALL,
  ['requestHeaders'],
);

function forward(
  d: chrome.webRequest.OnCompletedDetails | chrome.webRequest.OnErrorOccurredDetails,
  failed: boolean,
) {
  const reqHeaders = requestHeaders.get(d.requestId);
  requestHeaders.delete(d.requestId);
  if (d.tabId < 0 || d.frameId !== 0) return;
  const completed = failed ? undefined : (d as chrome.webRequest.OnCompletedDetails);
  const info: WebRequestInfo = {
    kind: 'webreq',
    url: d.url,
    method: d.method,
    type: d.type,
    statusCode: completed?.statusCode ?? 0,
    statusLine: completed?.statusLine,
    fromCache: d.fromCache,
    failed,
    error: failed ? (d as chrome.webRequest.OnErrorOccurredDetails).error : undefined,
    ip: d.ip,
    requestHeaders: reqHeaders,
    responseHeaders: toObject(completed?.responseHeaders),
  };
  send(d.tabId, info);
}

chrome.webRequest.onCompleted.addListener((d) => forward(d, false), ALL, ['responseHeaders']);
chrome.webRequest.onErrorOccurred.addListener((d) => forward(d, true), ALL);

// Toolbar icon toggles the floating button on every site.
chrome.action.onClicked.addListener(async () => {
  const { enabled = true } = await chrome.storage.local.get('enabled');
  await chrome.storage.local.set({ enabled: !enabled });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command !== 'toggle-panel') return;
  const tabId = tab?.id ?? (await chrome.tabs.query({ active: true, currentWindow: true }))[0]?.id;
  if (tabId !== undefined) send(tabId, { kind: 'toggle-panel' });
});

// ---------------------------------------------------------------- AI assistant

// Provider calls run here: the background is not bound by the page's CORS/CSP and reads the
// API key from storage itself, so the key is never exposed to the page.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== AI_PORT) return;
  const abort = new AbortController();
  port.onDisconnect.addListener(() => abort.abort());
  const post = (msg: AiResponse) => {
    try {
      port.postMessage(msg);
    } catch {
      /* port closed */
    }
  };

  port.onMessage.addListener(async (req: AiRequest) => {
    try {
      if (req.kind === 'test') {
        const provider = providerById(req.providerId);
        if (!provider) throw new Error('Provider desconhecido.');
        const res = await fetch(`${provider.baseUrl}/models`, {
          headers: { Authorization: `Bearer ${req.apiKey}` },
          signal: abort.signal,
        });
        if (!res.ok) throw new Error(await errorMessage(res));
        post({ kind: 'done' });
        return;
      }

      const { [AI_CONFIG_KEY]: stored } = await chrome.storage.local.get(AI_CONFIG_KEY);
      const config = (stored as AiConfig | undefined) ?? EMPTY_AI_CONFIG;
      const provider = providerById(config.active);
      const settings = provider && config.providers[provider.id];
      if (!provider || !settings?.apiKey) throw new Error('Nenhum provider configurado. Adicione uma API key nas configurações.');

      const res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
        body: JSON.stringify({ model: settings.model || provider.models[0].id, messages: req.messages, stream: true }),
        signal: abort.signal,
      });
      if (!res.ok || !res.body) throw new Error(await errorMessage(res));
      await readStream(res.body, post);
      post({ kind: 'done' });
    } catch (err) {
      if (abort.signal.aborted) return;
      post({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  });
});

/** Parses an OpenAI-style SSE stream into delta messages. */
async function readStream(body: ReadableStream<Uint8Array>, post: (msg: AiResponse) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let thinking = false;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      const data = line.trim();
      if (!data.startsWith('data:')) continue;
      const payload = data.slice(5).trim();
      if (payload === '[DONE]') return;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta;
        if (delta?.content) post({ kind: 'delta', text: delta.content });
        else if (delta?.reasoning_content && !thinking) {
          thinking = true;
          post({ kind: 'thinking' });
        }
      } catch {
        /* keep-alive or partial line */
      }
    }
  }
}

async function errorMessage(res: Response) {
  const text = await res.text().catch(() => '');
  let detail = text;
  try {
    detail = JSON.parse(text).error?.message ?? text;
  } catch {
    /* not JSON */
  }
  if (res.status === 401) return 'API key inválida (401).';
  if (res.status === 402) return 'Saldo insuficiente na conta do provider (402).';
  if (res.status === 429) return 'Limite de requisições atingido (429). Tente novamente em instantes.';
  return `Erro ${res.status}${detail ? `: ${detail.slice(0, 300)}` : ''}`;
}
