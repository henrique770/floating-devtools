/** Prefix for the DOM events used to talk between the page (MAIN world) and the extension UI. */
export const CHANNEL = '__floating_devtools__';
export const TO_UI = `${CHANNEL}:to-ui`;
export const TO_PAGE = `${CHANNEL}:to-page`;

export type ResourceType =
  | 'fetch'
  | 'xhr'
  | 'document'
  | 'stylesheet'
  | 'script'
  | 'font'
  | 'image'
  | 'media'
  | 'manifest'
  | 'websocket'
  | 'other';

export interface Timing {
  stalled: number;
  dns: number;
  connect: number;
  ssl: number;
  waiting: number;
  download: number;
}

export interface NetworkEntry {
  id: string;
  url: string;
  method: string;
  /** 0 while pending, on failure, or when the browser hides it (opaque cross-origin). */
  status: number;
  statusText: string;
  type: ResourceType;
  mimeType?: string;
  state: 'pending' | 'done' | 'failed';
  error?: string;
  /** Epoch ms. */
  startTime: number;
  duration?: number;
  transferSize?: number;
  resourceSize?: number;
  fromCache?: boolean;
  remoteAddress?: string;
  requestHeaders?: Record<string, string>;
  requestBody?: string;
  responseHeaders?: Record<string, string>;
  responseBody?: string;
  responseBodyNote?: string;
  timing?: Timing;
  /** Set once the background webRequest data has been merged in. */
  webMatched?: boolean;
}

export type NetworkPatch = Partial<NetworkEntry> & { id: string };

export type SerializedValue =
  | { t: 'string'; v: string }
  | { t: 'number' | 'bigint' | 'symbol' | 'date' | 'regexp'; v: string }
  | { t: 'boolean'; v: boolean }
  | { t: 'undefined' }
  | { t: 'null' }
  | { t: 'circular' }
  | { t: 'function'; name: string }
  | { t: 'error'; name: string; message: string; stack?: string }
  | { t: 'node'; tag: string; id?: string; cls?: string }
  | {
      t: 'object';
      kind: 'object' | 'array' | 'map' | 'set';
      cls: string;
      size?: number;
      entries: [string, SerializedValue][];
      /** Children were not serialized (depth or budget limit). */
      deep?: boolean;
      truncated?: boolean;
    };

export type ConsoleLevel = 'log' | 'info' | 'warn' | 'error' | 'debug' | 'command' | 'result';

export interface ConsoleEntry {
  id: string;
  level: ConsoleLevel;
  args: SerializedValue[];
  time: number;
  prefix?: string;
  source?: { label: string; url: string };
  stack?: string;
  count?: number;
}

/** Page (MAIN world) -> UI */
export type PageMessage =
  | { kind: 'hello' }
  | { kind: 'net'; patch: NetworkPatch }
  | { kind: 'console'; entry: ConsoleEntry }
  | { kind: 'console-clear' };

/** UI -> Page (MAIN world) */
export type UIMessage = { kind: 'ready' } | { kind: 'eval'; code: string };

/** Background -> content script */
export interface WebRequestInfo {
  kind: 'webreq';
  url: string;
  method: string;
  type: `${chrome.webRequest.ResourceType}`;
  statusCode: number;
  statusLine?: string;
  fromCache: boolean;
  failed: boolean;
  error?: string;
  ip?: string;
  requestHeaders?: Record<string, string>;
  responseHeaders?: Record<string, string>;
}

export type BackgroundMessage = WebRequestInfo | { kind: 'toggle-panel' };
