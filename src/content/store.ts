import { DiagnosticsEngine } from '../analysis/diagnostics/engine';
import { DEFAULT_INSIGHTS_CONFIG, type Diagnostic, type InsightsConfig } from '../analysis/diagnostics/types';
import { LogGroupIndex, type LogGroup } from '../analysis/groups';
import { fromWebRequestType } from '../shared/resource-type';
import type { ConsoleEntry, NetworkEntry, NetworkPatch, PageMessage, WebRequestInfo } from '../shared/types';

const MAX_REQUESTS = 3000;
const MAX_LOGS = 5000;
const FLUSH_MS = 60;
/** How long a failed fetch/XHR waits for its webRequest data before being diagnosed without it. */
const WEB_WAIT_MS = 1500;

const isApi = (e: NetworkEntry) => e.type === 'fetch' || e.type === 'xhr';

export interface Snapshot {
  requests: NetworkEntry[];
  logs: ConsoleEntry[];
  /** Console entries grouped by fingerprint, in last-activity order. */
  groups: LogGroup[];
  /** Problems found by the local diagnostics engine (including dismissed ones). */
  diagnostics: Diagnostic[];
  dismissed: ReadonlySet<string>;
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
  private groups = new LogGroupIndex();
  private diagnostics: DiagnosticsEngine;
  /** Requests that changed since the last flush and need (re)evaluation. */
  private dirty = new Set<string>();
  private awaitingWeb = new Set<string>();
  private dismissed: ReadonlySet<string> = new Set();
  private recording = true;
  private listeners = new Set<() => void>();
  private timer: ReturnType<typeof setTimeout> | undefined;
  private unmatchedWeb = new Map<string, WebRequestInfo[]>();
  private snapshot: Snapshot = { requests: [], logs: [], groups: [], diagnostics: [], dismissed: new Set(), errors: 0, warnings: 0, recording: true };

  constructor(
    private evalInPage: (code: string) => void,
    pageOrigin = typeof location !== 'undefined' ? location.origin : '',
  ) {
    this.diagnostics = new DiagnosticsEngine(DEFAULT_INSIGHTS_CONFIG, pageOrigin);
  }

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
      this.dirty.add(patch.id);
    } else {
      if (!this.recording || !patch.url) return;
      const entry: NetworkEntry = { method: 'GET', status: 0, statusText: '', type: 'other', state: 'pending', startTime: Date.now(), url: '', ...patch };
      this.entries.set(entry.id, entry);
      this.order.push(entry.id);
      if (this.order.length > MAX_REQUESTS) this.entries.delete(this.order.shift()!);
      this.applyUnmatchedWeb(entry);
      this.dirty.add(entry.id);
    }
    this.schedule();
  }

  /** Merge background webRequest data (status, headers, cache) into resource entries. */
  handleWebRequest(info: WebRequestInfo) {
    if (info.type === 'ping' || info.type === 'csp_report') return;
    // fetch/XHR are described by the page hooks; only keep what the page can't see (why it failed).
    if (info.type === 'xmlhttprequest') {
      this.attachApiWeb(info);
      return;
    }
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

  private attachApiWeb(info: WebRequestInfo) {
    for (let i = this.order.length - 1, n = 0; i >= 0 && n < 300; i--, n++) {
      const e = this.entries.get(this.order[i])!;
      if (!isApi(e) || e.url !== info.url) continue;
      // A preflight (OPTIONS) is replaced by the actual request's data when that arrives.
      if (e.web && !(e.web.method === 'OPTIONS' && info.method !== 'OPTIONS')) continue;
      this.entries.set(e.id, {
        ...e,
        web: { method: info.method, status: info.statusCode, error: info.error, responseHeaders: info.responseHeaders },
      });
      this.dirty.add(e.id);
      this.schedule();
      return;
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
    this.dirty.add(entry.id);
    this.schedule();
  }

  clearNetwork() {
    this.entries.clear();
    this.order = [];
    this.unmatchedWeb.clear();
    this.rebuildDiagnostics();
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
      const merged = { ...last, count: (last.count ?? 1) + 1, time: entry.time };
      this.logs[this.logs.length - 1] = merged;
      this.groups.add(merged);
      this.diagnostics.onLog(merged);
    } else {
      entry.group = this.groups.add(entry);
      this.diagnostics.onLog(entry);
      this.logs.push(entry);
      if (this.logs.length > MAX_LOGS) this.logs.shift();
    }
    this.lastLogKey = key;
    this.schedule();
  }

  clearConsole() {
    this.logs = [];
    this.lastLogKey = '';
    this.groups.clear();
    this.rebuildDiagnostics();
    this.schedule();
  }

  evaluate(code: string) {
    this.addLog({ id: `cmd${Date.now()}${Math.random()}`, level: 'command', args: [{ t: 'string', v: code }], time: Date.now() });
    this.evalInPage(code);
  }

  // ------------------------------------------------------------ diagnostics

  setInsightsConfig(config: InsightsConfig) {
    const current = this.diagnostics.config;
    if ((Object.keys(config) as (keyof InsightsConfig)[]).every((k) => config[k] === current[k])) return;
    this.rebuildDiagnostics(config);
    this.schedule();
  }

  /** Hides (or shows again) a diagnostic. Kept by id, so it stays hidden while the problem repeats. */
  setDismissed(id: string, dismissed: boolean) {
    const next = new Set(this.dismissed);
    if (dismissed) next.add(id);
    else next.delete(id);
    this.dismissed = next;
    this.schedule();
  }

  clearDismissed() {
    this.dismissed = new Set();
    this.schedule();
  }

  /** Re-derives diagnostics from what is still captured (after a clear or a config change). */
  private rebuildDiagnostics(config?: InsightsConfig) {
    this.diagnostics.reset(config);
    this.dirty.clear();
    for (const l of this.logs) this.diagnostics.onLog(l, l.count ?? 1, l.count ?? 1);
    for (const id of this.order) this.diagnostics.onRequest(this.entries.get(id)!);
  }

  private evaluateDirty() {
    const now = Date.now();
    for (const id of this.dirty) {
      const e = this.entries.get(id);
      if (!e || e.state === 'pending') continue;
      // The page only sees "Failed to fetch": give webRequest a moment to say why before diagnosing.
      if (e.state === 'failed' && isApi(e) && !e.web && now - (e.startTime + (e.duration ?? 0)) < WEB_WAIT_MS) {
        if (!this.awaitingWeb.has(id)) {
          this.awaitingWeb.add(id);
          setTimeout(() => {
            this.awaitingWeb.delete(id);
            this.dirty.add(id);
            this.schedule();
          }, WEB_WAIT_MS);
        }
        continue;
      }
      this.diagnostics.onRequest(e);
    }
    this.dirty.clear();
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
    this.evaluateDirty();
    let errors = 0;
    let warnings = 0;
    for (const l of this.logs) {
      if (l.level === 'error') errors += l.count ?? 1;
      else if (l.level === 'warn') warnings += l.count ?? 1;
    }
    this.snapshot = {
      requests: this.order.map((id) => this.entries.get(id)!),
      logs: this.logs.slice(),
      groups: this.groups.list(),
      diagnostics: this.diagnostics.list(),
      dismissed: this.dismissed,
      errors,
      warnings,
      recording: this.recording,
    };
    this.listeners.forEach((l) => l());
  }
}
