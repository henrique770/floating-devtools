/**
 * Runs in the page's own JS world at document_start, before any page script.
 * Hooks console, errors, fetch, XHR and resource timing, and forwards everything
 * to the extension UI (isolated world) through DOM CustomEvents.
 */
import { inferType } from '../shared/resource-type';
import {
  CHANNEL,
  TO_PAGE,
  TO_UI,
  type ConsoleEntry,
  type ConsoleLevel,
  type NetworkPatch,
  type PageMessage,
  type SerializedValue,
  type Timing,
  type UIMessage,
} from '../shared/types';

(() => {
  const g = window as unknown as Record<string, unknown>;
  const FLAG = `${CHANNEL}:installed`;
  if (g[FLAG]) return;
  g[FLAG] = true;

  // ---------------------------------------------------------------- transport

  const MAX_QUEUE = 5000;
  const queue: string[] = [];
  let uiReady = false;

  const dispatch = (data: string) => document.dispatchEvent(new CustomEvent(TO_UI, { detail: data }));

  const emit = (msg: PageMessage) => {
    let data: string;
    try {
      data = JSON.stringify(msg);
    } catch {
      return;
    }
    if (uiReady) dispatch(data);
    else if (queue.length < MAX_QUEUE) queue.push(data);
  };

  document.addEventListener(TO_PAGE, (event) => {
    let msg: UIMessage;
    try {
      msg = JSON.parse((event as CustomEvent<string>).detail);
    } catch {
      return;
    }
    if (msg.kind === 'ready') {
      if (uiReady) return;
      uiReady = true;
      queue.splice(0).forEach(dispatch);
    } else if (msg.kind === 'eval') {
      evaluate(msg.code, msg.blockedLabel);
    }
  });
  dispatch(JSON.stringify({ kind: 'hello' } satisfies PageMessage));

  let seq = 0;
  const nextId = (prefix: string) => `${prefix}${++seq}`;

  // --------------------------------------------------------------- serializer

  const MAX_DEPTH = 3;
  const MAX_KEYS = 100;
  const MAX_STRING = 10_000;

  function serialize(root: unknown): SerializedValue {
    let budget = 1500;
    const ancestors = new Set<object>();

    const walk = (value: unknown, depth: number): SerializedValue => {
      budget--;
      switch (typeof value) {
        case 'string':
          return { t: 'string', v: value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value };
        case 'number':
          return { t: 'number', v: Object.is(value, -0) ? '-0' : String(value) };
        case 'bigint':
          return { t: 'bigint', v: `${value}n` };
        case 'boolean':
          return { t: 'boolean', v: value };
        case 'undefined':
          return { t: 'undefined' };
        case 'symbol':
          return { t: 'symbol', v: value.toString() };
        case 'function':
          return { t: 'function', name: value.name || 'anonymous' };
      }
      if (value === null) return { t: 'null' };
      const obj = value as object;
      if (ancestors.has(obj)) return { t: 'circular' };

      try {
        if (obj instanceof Error) {
          return { t: 'error', name: obj.name, message: obj.message, stack: obj.stack };
        }
        if (typeof Node !== 'undefined' && obj instanceof Node) {
          const el = obj as Element;
          return {
            t: 'node',
            tag: (el.tagName || obj.nodeName).toLowerCase(),
            id: el.id || undefined,
            cls: typeof el.className === 'string' && el.className ? el.className : undefined,
          };
        }
        if (obj instanceof Date) return { t: 'date', v: isNaN(+obj) ? 'Invalid Date' : obj.toString() };
        if (obj instanceof RegExp) return { t: 'regexp', v: obj.toString() };
      } catch {
        /* cross-realm or exotic object, fall through */
      }

      let cls = 'Object';
      try {
        cls = (obj.constructor && obj.constructor.name) || (Object.getPrototypeOf(obj) ? 'Object' : 'Object');
      } catch {
        /* ignore */
      }

      const kind: 'object' | 'array' | 'map' | 'set' = Array.isArray(obj)
        ? 'array'
        : obj instanceof Map
          ? 'map'
          : obj instanceof Set
            ? 'set'
            : 'object';
      const size =
        kind === 'array' ? (obj as unknown[]).length : kind === 'map' || kind === 'set' ? (obj as Map<unknown, unknown>).size : undefined;

      if (depth >= MAX_DEPTH || budget <= 0) return { t: 'object', kind, cls, size, entries: [], deep: true };

      ancestors.add(obj);
      const entries: [string, SerializedValue][] = [];
      let truncated = false;
      try {
        if (kind === 'array') {
          const arr = obj as unknown[];
          for (let i = 0; i < arr.length; i++) {
            if (i >= MAX_KEYS || budget <= 0) {
              truncated = true;
              break;
            }
            entries.push([String(i), walk(arr[i], depth + 1)]);
          }
        } else if (kind === 'map') {
          let i = 0;
          for (const [k, v] of obj as Map<unknown, unknown>) {
            if (i++ >= MAX_KEYS || budget <= 0) {
              truncated = true;
              break;
            }
            entries.push([previewKey(k), walk(v, depth + 1)]);
          }
        } else if (kind === 'set') {
          let i = 0;
          for (const v of obj as Set<unknown>) {
            if (i >= MAX_KEYS || budget <= 0) {
              truncated = true;
              break;
            }
            entries.push([String(i++), walk(v, depth + 1)]);
          }
        } else {
          const keys = Object.keys(obj);
          for (let i = 0; i < keys.length; i++) {
            if (i >= MAX_KEYS || budget <= 0) {
              truncated = true;
              break;
            }
            let child: unknown;
            try {
              child = (obj as Record<string, unknown>)[keys[i]];
            } catch (err) {
              child = `[Exception: ${String(err)}]`;
            }
            entries.push([keys[i], walk(child, depth + 1)]);
          }
        }
      } catch {
        truncated = true;
      }
      ancestors.delete(obj);
      return { t: 'object', kind, cls, size, entries, truncated: truncated || undefined };
    };

    return walk(root, 0);
  }

  function previewKey(key: unknown): string {
    if (typeof key === 'string') return JSON.stringify(key);
    if (key !== null && typeof key === 'object') return `{${(key as object).constructor?.name ?? 'Object'}}`;
    return String(key);
  }

  // ------------------------------------------------------------------ console

  const isOwnFrame = (line: string) => line.includes('chrome-extension://') || line.includes('moz-extension://');

  /** Stack frames of the caller, excluding our own wrapper frames. */
  function callerFrames(): string[] {
    const stack = new Error().stack ?? '';
    return stack
      .split('\n')
      .slice(1)
      .filter((l) => l.trim().startsWith('at ') && !isOwnFrame(l));
  }

  function shortFile(url: string): string {
    try {
      const u = new URL(url);
      return u.pathname.split('/').filter(Boolean).pop() || u.host || url;
    } catch {
      return url.split(/[?#]/)[0].split('/').pop() || url;
    }
  }

  function sourceFromFrame(frame: string | undefined): ConsoleEntry['source'] {
    if (!frame) return undefined;
    const m = frame.match(/\(?((?:https?|file|blob|webpack|data):[^\s)]+?):(\d+):(\d+)\)?\s*$/);
    if (!m) return undefined;
    const [, url, line] = m;
    return { label: `${shortFile(url)}:${line}`, url: `${url}:${line}` };
  }

  /** Error objects created by a request failure (fetch rejection, response.json() parse error) -> request id. */
  const errorRequests = new WeakMap<object, string>();
  const tagError = (err: unknown, id: string) => {
    if (err && typeof err === 'object') errorRequests.set(err, id);
  };

  /** Request behind one of the logged values: the error itself, or its `cause` (errors re-thrown with context). */
  function requestOf(args: unknown[]): string | undefined {
    for (const a of args) {
      if (!a || typeof a !== 'object') continue;
      try {
        const id = errorRequests.get(a) ?? errorRequests.get((a as { cause?: object }).cause ?? {});
        if (id) return id;
      } catch {
        /* exotic object */
      }
    }
    return undefined;
  }

  function emitConsole(level: ConsoleLevel, args: unknown[], opts: { prefix?: string; withStack?: boolean; source?: ConsoleEntry['source'] } = {}) {
    const frames = callerFrames();
    emit({
      kind: 'console',
      entry: {
        id: nextId('c'),
        level,
        args: args.map(serialize),
        time: Date.now(),
        prefix: opts.prefix,
        source: opts.source ?? sourceFromFrame(frames[0]),
        stack: opts.withStack ? frames.map((f) => f.trim()).join('\n') : undefined,
        request: level === 'error' || level === 'warn' ? requestOf(args) : undefined,
      },
    });
  }

  type Transform = (args: unknown[]) => unknown[] | null;

  function hook(method: string, level: ConsoleLevel, transform?: Transform, withStack = false) {
    const c = console as unknown as Record<string, (...a: unknown[]) => unknown>;
    const original = c[method];
    if (typeof original !== 'function') return;
    c[method] = function (this: unknown, ...args: unknown[]) {
      try {
        const out = transform ? transform(args) : args;
        if (out) emitConsole(level, out, { withStack });
      } catch {
        /* never break the page's console */
      }
      return original.apply(this, args);
    };
  }

  const counters = new Map<string, number>();
  const timers = new Map<string, number>();
  const label = (v: unknown) => (v === undefined ? 'default' : String(v));

  hook('log', 'log');
  hook('info', 'info');
  hook('warn', 'warn', undefined, true);
  hook('error', 'error', undefined, true);
  hook('debug', 'debug');
  hook('trace', 'log', (a) => ['console.trace', ...a], true);
  hook('dir', 'log', (a) => a.slice(0, 1));
  hook('dirxml', 'log');
  hook('table', 'log', (a) => a.slice(0, 1));
  hook('assert', 'error', (a) => (a[0] ? null : ['Assertion failed:', ...(a.length > 1 ? a.slice(1) : ['console.assert'])]), true);
  hook('count', 'info', (a) => {
    const l = label(a[0]);
    const n = (counters.get(l) ?? 0) + 1;
    counters.set(l, n);
    return [`${l}: ${n}`];
  });
  hook('countReset', 'info', (a) => (counters.delete(label(a[0])), null));
  hook('time', 'info', (a) => (timers.set(label(a[0]), performance.now()), null));
  const elapsed = (a: unknown[], end: boolean) => {
    const l = label(a[0]);
    const start = timers.get(l);
    if (start === undefined) return [`Timer '${l}' does not exist`];
    if (end) timers.delete(l);
    return [`${l}: ${(performance.now() - start).toFixed(3)} ms`, ...a.slice(1)];
  };
  hook('timeLog', 'info', (a) => elapsed(a, false));
  hook('timeEnd', 'info', (a) => elapsed(a, true));
  hook('clear', 'log', () => (emit({ kind: 'console-clear' }), null));

  window.addEventListener(
    'error',
    (event) => {
      const target = event.target as (Element & { src?: string; href?: string }) | null;
      if (target && target !== (window as unknown) && typeof target.tagName === 'string') {
        const url = target.src || target.href || '';
        emitConsole('error', [`Failed to load resource: <${target.tagName.toLowerCase()}> ${url}`]);
        return;
      }
      const e = event as ErrorEvent;
      const source = e.filename
        ? { label: `${shortFile(e.filename)}:${e.lineno}`, url: `${e.filename}:${e.lineno}` }
        : undefined;
      emitConsole('error', [e.error ?? e.message], { prefix: 'Uncaught', source });
    },
    true,
  );

  window.addEventListener('unhandledrejection', (event) => {
    emitConsole('error', [event.reason], { prefix: 'Uncaught (in promise)' });
  });

  function evaluate(code: string, blockedLabel = 'CSP blocked eval —') {
    const report = (level: ConsoleLevel, value: unknown, prefix?: string) =>
      emit({ kind: 'console', entry: { id: nextId('c'), level, args: [serialize(value)], time: Date.now(), prefix } });
    try {
      // Indirect eval runs in global scope, like the DevTools console.
      const result = (0, eval)(code);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).then(
          (v) => report('result', v, 'Promise ⇒'),
          (err) => report('error', err, 'Uncaught (in promise)'),
        );
      } else {
        report('result', result);
      }
    } catch (err) {
      const blocked = err instanceof EvalError || String(err).includes('Content Security Policy');
      report('error', err, blocked ? blockedLabel : 'Uncaught');
    }
  }

  // ------------------------------------------------------------------ network

  const MAX_BODY = 1_000_000;
  const TEXTUAL = /json|text|xml|javascript|ecmascript|x-www-form-urlencoded|graphql|svg|csv/i;

  const absolute = (url: string) => {
    try {
      return new URL(url, location.href).href;
    } catch {
      return url;
    }
  };

  const clip = (s: string) => (s.length > MAX_BODY ? s.slice(0, MAX_BODY) : s);

  function headersToObject(h: unknown): Record<string, string> | undefined {
    if (!h) return undefined;
    const out: Record<string, string> = {};
    try {
      if (typeof Headers !== 'undefined' && h instanceof Headers) h.forEach((v, k) => (out[k] = v));
      else if (Array.isArray(h)) for (const [k, v] of h) out[String(k).toLowerCase()] = String(v);
      else for (const [k, v] of Object.entries(h as Record<string, string>)) out[k.toLowerCase()] = String(v);
    } catch {
      /* ignore */
    }
    return out;
  }

  function describeBody(body: unknown): string | undefined {
    if (body == null) return undefined;
    try {
      if (typeof body === 'string') return clip(body);
      if (body instanceof URLSearchParams) return body.toString();
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const parts: string[] = [];
        body.forEach((v, k) => parts.push(`${k}=${typeof v === 'string' ? v : `[File ${v.name} · ${v.size} bytes]`}`));
        return parts.join('\n');
      }
      if (body instanceof Blob) return `[Blob ${body.type || 'binary'} · ${body.size} bytes]`;
      if (body instanceof ArrayBuffer) return `[Binary · ${body.byteLength} bytes]`;
      if (ArrayBuffer.isView(body)) return `[Binary · ${body.byteLength} bytes]`;
      if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[ReadableStream]';
      return String(body);
    } catch {
      return undefined;
    }
  }

  const byteLength = (s: string) => {
    try {
      return new TextEncoder().encode(s).length;
    } catch {
      return s.length;
    }
  };

  /** fetch/XHR ids waiting for their PerformanceResourceTiming entry (to get transfer size + timing). */
  const awaitingTiming = new Map<string, string[]>();
  const trackTiming = (url: string, id: string) => {
    const list = awaitingTiming.get(url);
    if (list) list.push(id);
    else awaitingTiming.set(url, [id]);
  };

  /** Where the page started a request (used to relate it to errors thrown from the same code). */
  const initiator = () =>
    callerFrames()
      .slice(0, 6)
      .map((f) => f.trim())
      .join('\n') || undefined;

  // response.json() rejections (body is not JSON) are tagged with the request they came from.
  const responseRequests = new WeakMap<Response, string>();
  if (typeof Response !== 'undefined') {
    const nativeJson = Response.prototype.json;
    Response.prototype.json = function (this: Response) {
      const promise = nativeJson.call(this) as Promise<unknown>;
      const id = responseRequests.get(this);
      // A side branch: the caller still gets (and must handle) the original promise.
      if (id) promise.catch((err) => tagError(err, id));
      return promise;
    };
  }

  // fetch
  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (this: unknown, ...args: Parameters<typeof fetch>) {
      const [input, init] = args;
      const id = nextId('f');
      const started = performance.now();
      try {
        const req = typeof Request !== 'undefined' && input instanceof Request ? input : undefined;
        const url = absolute(req ? req.url : input instanceof URL ? input.href : String(input));
        const requestHeaders = { ...headersToObject(req?.headers), ...headersToObject(init?.headers) };
        emit({
          kind: 'net',
          patch: {
            id,
            url,
            method: (init?.method || req?.method || 'GET').toUpperCase(),
            type: 'fetch',
            state: 'pending',
            startTime: Date.now(),
            requestHeaders,
            requestBody: describeBody(init?.body),
            initiator: initiator(),
          },
        });
        trackTiming(url, id);
        if (req && !init?.body && req.method !== 'GET' && req.method !== 'HEAD') {
          req
            .clone()
            .text()
            .then((t) => t && emit({ kind: 'net', patch: { id, requestBody: clip(t) } }))
            .catch(() => {});
        }
      } catch {
        /* never break fetch */
      }

      const promise = Reflect.apply(nativeFetch, window, args) as Promise<Response>;
      promise.then(
        (res) => {
          responseRequests.set(res, id);
          const mimeType = res.headers.get('content-type') ?? undefined;
          emit({
            kind: 'net',
            patch: {
              id,
              status: res.status,
              statusText: res.statusText,
              mimeType,
              responseHeaders: headersToObject(res.headers),
              duration: performance.now() - started,
            },
          });
          if (mimeType?.includes('event-stream')) {
            emit({ kind: 'net', patch: { id, state: 'done', responseBodyNote: { kind: 'stream' } } });
            return;
          }
          res
            .clone()
            .blob()
            .then(async (blob) => {
              const textual = TEXTUAL.test(mimeType ?? '') || !mimeType;
              const patch: NetworkPatch = { id, state: 'done', resourceSize: blob.size, duration: performance.now() - started };
              if (textual && blob.size <= MAX_BODY) patch.responseBody = await blob.text();
              else patch.responseBodyNote = textual ? { kind: 'too-large' } : { kind: 'binary', detail: mimeType ?? '' };
              emit({ kind: 'net', patch });
            })
            .catch((err) => emit({ kind: 'net', patch: { id, state: 'done', responseBodyNote: { kind: 'unreadable', detail: String(err) } } }));
        },
        (err) => {
          tagError(err, id);
          emit({ kind: 'net', patch: { id, state: 'failed', error: String(err), duration: performance.now() - started } });
        },
      );
      return promise;
    } as typeof fetch;
  }

  // XMLHttpRequest
  type XhrMeta = { id: string; method: string; url: string; headers: Record<string, string>; started: number; error?: string };
  const xhrMeta = new WeakMap<XMLHttpRequest, XhrMeta>();
  const XHR = XMLHttpRequest.prototype;
  const nativeOpen = XHR.open;
  const nativeSend = XHR.send;
  const nativeSetHeader = XHR.setRequestHeader;

  XHR.open = function (this: XMLHttpRequest, method: string, url: string | URL) {
    try {
      xhrMeta.set(this, { id: nextId('x'), method: String(method).toUpperCase(), url: absolute(String(url)), headers: {}, started: 0 });
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line prefer-rest-params
    return nativeOpen.apply(this, arguments as unknown as Parameters<typeof nativeOpen>);
  } as typeof XHR.open;

  XHR.setRequestHeader = function (this: XMLHttpRequest, name: string, value: string) {
    const meta = xhrMeta.get(this);
    if (meta) meta.headers[name.toLowerCase()] = value;
    return nativeSetHeader.call(this, name, value);
  };

  XHR.send = function (this: XMLHttpRequest, body?: Document | XMLHttpRequestBodyInit | null) {
    const meta = xhrMeta.get(this);
    if (meta) {
      try {
        meta.started = performance.now();
        emit({
          kind: 'net',
          patch: {
            id: meta.id,
            url: meta.url,
            method: meta.method,
            type: 'xhr',
            state: 'pending',
            startTime: Date.now(),
            requestHeaders: { ...meta.headers },
            requestBody: describeBody(body),
            initiator: initiator(),
          },
        });
        trackTiming(meta.url, meta.id);
        const xhr = this;
        const fail = (reason: string) => () => (meta.error = reason);
        xhr.addEventListener('error', fail('net::ERR_FAILED'));
        xhr.addEventListener('abort', fail('Cancelado (abort)'));
        xhr.addEventListener('timeout', fail('Timeout'));
        xhr.addEventListener('loadend', () => {
          const patch: NetworkPatch = { id: meta.id, duration: performance.now() - meta.started };
          if (xhr.status === 0) {
            patch.state = 'failed';
            patch.error = meta.error ?? 'Falhou';
            emit({ kind: 'net', patch });
            return;
          }
          patch.state = 'done';
          patch.status = xhr.status;
          patch.statusText = xhr.statusText;
          patch.mimeType = xhr.getResponseHeader('content-type') ?? undefined;
          const headers: Record<string, string> = {};
          for (const line of xhr.getAllResponseHeaders().trim().split(/[\r\n]+/)) {
            const i = line.indexOf(':');
            if (i > 0) headers[line.slice(0, i).trim().toLowerCase()] = line.slice(i + 1).trim();
          }
          patch.responseHeaders = headers;
          try {
            const rt = xhr.responseType;
            if (rt === '' || rt === 'text') {
              patch.responseBody = clip(xhr.responseText);
              patch.resourceSize = byteLength(xhr.responseText);
            } else if (rt === 'json') {
              const text = JSON.stringify(xhr.response);
              patch.responseBody = clip(text ?? 'null');
              patch.resourceSize = byteLength(text ?? '');
            } else if (rt === 'arraybuffer') {
              patch.resourceSize = (xhr.response as ArrayBuffer | null)?.byteLength;
              patch.responseBodyNote = { kind: 'binary', detail: 'arraybuffer' };
            } else if (rt === 'blob') {
              patch.resourceSize = (xhr.response as Blob | null)?.size;
              patch.responseBodyNote = { kind: 'binary', detail: 'blob' };
            } else {
              patch.responseBodyNote = { kind: 'unsupported', detail: `responseType "${rt}"` };
            }
          } catch {
            /* ignore */
          }
          emit({ kind: 'net', patch });
        });
      } catch {
        /* never break XHR */
      }
    }
    return nativeSend.call(this, body);
  };

  // Resource timing: images, CSS, JS, fonts, documents... plus sizes/timing for fetch/XHR.
  const nonNegative = (n: number) => (n > 0 ? n : 0);

  /** Undefined for cross-origin resources without Timing-Allow-Origin (the browser zeroes the phases). */
  function timingOf(e: PerformanceResourceTiming): Timing | undefined {
    if (!e.requestStart || !e.responseStart) return undefined;
    return {
      stalled: nonNegative((e.domainLookupStart || e.fetchStart) - e.startTime),
      dns: nonNegative(e.domainLookupEnd - e.domainLookupStart),
      connect: nonNegative(e.connectEnd - e.connectStart),
      ssl: e.secureConnectionStart > 0 ? nonNegative(e.connectEnd - e.secureConnectionStart) : 0,
      waiting: nonNegative(e.responseStart - e.requestStart),
      download: nonNegative(e.responseEnd - e.responseStart),
    };
  }

  function onTiming(e: PerformanceResourceTiming) {
    const extra = e as PerformanceResourceTiming & { responseStatus?: number; contentType?: string };
    const isApi = e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest';
    if (isApi) {
      const ids = awaitingTiming.get(e.name);
      const id = ids?.shift();
      if (ids && !ids.length) awaitingTiming.delete(e.name);
      if (id) emit({ kind: 'net', patch: { id, transferSize: e.transferSize, timing: timingOf(e) } });
      return;
    }
    const status = extra.responseStatus ?? 0;
    const isNavigation = e.entryType === 'navigation';
    emit({
      kind: 'net',
      patch: {
        // The navigation entry is delivered early (incomplete) and again after load: same id merges them.
        id: isNavigation ? 'nav' : nextId('r'),
        url: e.name,
        method: 'GET',
        type: isNavigation ? 'document' : inferType(e.initiatorType, e.name, extra.contentType),
        mimeType: extra.contentType || undefined,
        status,
        state: 'done',
        startTime: performance.timeOrigin + e.startTime,
        duration: e.duration,
        transferSize: e.transferSize,
        resourceSize: e.decodedBodySize,
        fromCache: e.transferSize === 0 && e.decodedBodySize > 0 ? true : undefined,
        timing: timingOf(e),
      },
    });
  }

  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) onTiming(entry as PerformanceResourceTiming);
    });
    observer.observe({ type: 'resource', buffered: true });
    observer.observe({ type: 'navigation', buffered: true });
  } catch {
    /* PerformanceObserver unavailable */
  }
})();
