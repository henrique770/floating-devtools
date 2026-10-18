/**
 * Service worker. Observes the tab's requests with chrome.webRequest to fill in what the
 * page itself cannot see for static resources (status code, headers, cache, failures),
 * and handles the toolbar icon / keyboard shortcut.
 */
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
