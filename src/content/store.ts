import { fromWebRequestType } from '../shared/resource-type';
import type { ConsoleEntry, NetworkEntry, NetworkPatch, PageMessage, WebRequestInfo } from '../shared/types';

const MAX_REQUESTS = 3000;
const MAX_LOGS = 5000;
const FLUSH_MS = 60;

export interface Snapshot {
  requests: NetworkEntry[];
  logs: ConsoleEntry[];
  errors: number;
  warnings: number;
  recording: boolean;
}

/**
 * Holds everything captured on this page. Mutations are batched and published as an
 * immutable snapshot (for useSyncExternalStore) at most every FLUSH_MS.
 */
export class DevtoolsStore {
  private entries = new Map<string, NetworkEntry>();
  private order: string[] = [];
  private logs: ConsoleEntry[] = [];
  private lastLogKey = '';
  private recording = true;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unmatchedWeb = new Map<string, WebRequestInfo[]>();
  private snapshot: Snapshot = { requests: [], logs: [], errors: 0, warnings: 0, recording: true };

  constructor(private evalInPage: (code: string) => void) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = () => this.snapshot;

  handlePageMessage(msg: PageMessage) {
    if (msg.kind === 'net') this.upsert(msg.patch);
    else if (msg.kind === 'console') this.addLog(msg.entry);
    else if (msg.kind === 'console-clear') this.clearConsole();
  }

  // ---------------------------------------------------------------- network

  private upsert(patch: NetworkPatch) {
    const prev = this.entries.get(patch.id);
    if (prev) {
      this.entries.set(patch.id, { ...prev, ...patch });
    } else {
      if (!this.recording || !patch.url) return;
      const entry: NetworkEntry = { method: 'GET', status: 0, statusText: '', type: 'other', state: 'pending', startTime: Date.now(), url: '', ...patch };
      this.entries.set(entry.id, entry);
      this.order.push(entry.id);
      if (this.order.length > MAX_REQUESTS) this.entries.delete(this.order.shift()!);
      this.applyUnmatchedWeb(entry);
    }
    this.schedule();
  }

  /** Merge background webRequest data (status, headers, cache) into resource entries. */
  handleWebRequest(info: WebRequestInfo) {
    // fetch/XHR are already fully described by the page hooks.
    if (info.type === 'xmlhttprequest' || info.type === 'ping' || info.type === 'csp_report') return;
    const target = this.findUnmatched(info.url);
    if (target) {
      this.mergeWeb(target, info);
      return;
    }
    const queue = this.unmatchedWeb.get(info.url) ?? [];
    queue.push(info);
    this.unmatchedWeb.set(info.url, queue);
    if (this.unmatchedWeb.size > 500) this.unmatchedWeb.delete(this.unmatchedWeb.keys().next().value!);

    // Failed loads (blocked by an ad blocker, DNS errors...) may never produce a timing entry.
    if (info.failed) {
      setTimeout(() => {
        const q = this.unmatchedWeb.get(info.url);
        const i = q?.indexOf(info) ?? -1;
        if (!q || i < 0) return;
        q.splice(i, 1);
        if (!q.length) this.unmatchedWeb.delete(info.url);
        this.upsert({
          id: `w${Math.random().toString(36).slice(2)}`,
          url: info.url,
          method: info.method,
          type: fromWebRequestType(info.type) ?? 'other',
          state: 'failed',
          error: info.error,
          startTime: Date.now(),
          requestHeaders: info.requestHeaders,
          webMatched: true,
        });
      }, 1500);
    }
  }

  private findUnmatched(url: string) {
    for (const id of this.order) {
      const e = this.entries.get(id)!;
      if (!e.webMatched && e.url === url && e.type !== 'fetch' && e.type !== 'xhr') return e;
    }
    return undefined;
  }

  private applyUnmatchedWeb(entry: NetworkEntry) {
    if (entry.type === 'fetch' || entry.type === 'xhr') return;
    const queue = this.unmatchedWeb.get(entry.url);
    const info = queue?.shift();
    if (!info) return;
    if (!queue!.length) this.unmatchedWeb.delete(entry.url);
    this.mergeWeb(entry, info);
  }

  private mergeWeb(entry: NetworkEntry, info: WebRequestInfo) {
    const statusText = info.statusLine?.replace(/^HTTP\/[\d.]+\s+\d+\s*/, '') ?? '';
    this.entries.set(entry.id, {
      ...entry,
      webMatched: true,
      status: entry.status || info.statusCode,
      statusText: entry.statusText || statusText,
      type: fromWebRequestType(info.type) ?? entry.type,
      fromCache: info.fromCache || entry.fromCache,
      remoteAddress: info.ip,
      requestHeaders: info.requestHeaders ?? entry.requestHeaders,
      responseHeaders: info.responseHeaders ?? entry.responseHeaders,
      mimeType: entry.mimeType ?? info.responseHeaders?.['content-type'],
      state: info.failed ? 'failed' : entry.state,
      error: info.error ?? entry.error,
    });
    this.schedule();
  }

  clearNetwork() {
    this.entries.clear();
    this.order = [];
    this.unmatchedWeb.clear();
    this.schedule();
  }

  toggleRecording() {
    this.recording = !this.recording;
    this.schedule();
  }

  // ---------------------------------------------------------------- console

  private addLog(entry: ConsoleEntry) {
    // Collapse identical consecutive messages, like DevTools.
    const key = JSON.stringify([entry.level, entry.prefix, entry.args, entry.source?.url]);
    const last = this.logs[this.logs.length - 1];
    if (last && key === this.lastLogKey && entry.level !== 'command' && entry.level !== 'result') {
      this.logs[this.logs.length - 1] = { ...last, count: (last.count ?? 1) + 1, time: entry.time };
    } else {
      this.logs.push(entry);
      if (this.logs.length > MAX_LOGS) this.logs.shift();
    }
    this.lastLogKey = key;
    this.schedule();
  }

  clearConsole() {
    this.logs = [];
    this.lastLogKey = '';
    this.schedule();
  }

  evaluate(code: string) {
    this.addLog({ id: `cmd${Date.now()}${Math.random()}`, level: 'command', args: [{ t: 'string', v: code }], time: Date.now() });
    this.evalInPage(code);
  }

  // ---------------------------------------------------------------- publish

  private schedule() {
    if (this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, FLUSH_MS);
  }

  private flush() {
    let errors = 0;
    let warnings = 0;
    for (const l of this.logs) {
      if (l.level === 'error') errors += l.count ?? 1;
      else if (l.level === 'warn') warnings += l.count ?? 1;
    }
    this.snapshot = {
      requests: this.order.map((id) => this.entries.get(id)!),
      logs: this.logs.slice(),
      errors,
      warnings,
      recording: this.recording,
    };
    this.listeners.forEach((l) => l());
  }
}
