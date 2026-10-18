import { useState } from 'react';
import type { SerializedValue } from '../shared/types';
import { IconChevron } from './Icons';

type ObjectValue = Extract<SerializedValue, { t: 'object' }>;

/** One-line preview, e.g. `{id: 1, name: "a", …}` or `(3) [1, 2, 3]`. */
export function preview(v: SerializedValue, nested = false): string {
  switch (v.t) {
    case 'string':
      return nested ? JSON.stringify(v.v.length > 60 ? `${v.v.slice(0, 60)}…` : v.v) : v.v;
    case 'boolean':
      return String(v.v);
    case 'undefined':
    case 'null':
      return v.t;
    case 'circular':
      return '[Circular]';
    case 'function':
      return `ƒ ${v.name}()`;
    case 'error':
      return `${v.name}: ${v.message}`;
    case 'node':
      return `<${v.tag}${v.id ? `#${v.id}` : ''}${v.cls ? `.${v.cls.trim().split(/\s+/).join('.')}` : ''}>`;
    case 'object':
      return objectPreview(v, nested);
    default:
      return v.v;
  }
}

function objectHeader(v: ObjectValue): string {
  if (v.kind === 'array') return v.cls === 'Array' ? `(${v.size})` : `${v.cls}(${v.size})`;
  if (v.kind === 'map' || v.kind === 'set') return `${v.cls}(${v.size})`;
  return v.cls === 'Object' ? '' : v.cls;
}

function objectPreview(v: ObjectValue, nested: boolean): string {
  const header = objectHeader(v);
  if (nested || v.deep) {
    if (v.kind === 'array') return v.cls === 'Array' ? `Array(${v.size})` : header;
    if (v.kind === 'object') return header ? header : '{…}';
    return header;
  }
  const shown = v.entries.slice(0, 5);
  const more = v.entries.length > 5 || v.truncated;
  const items =
    v.kind === 'array' || v.kind === 'set'
      ? shown.map(([, child]) => preview(child, true))
      : shown.map(([k, child]) => `${v.kind === 'map' ? `${k} => ` : `${k}: `}${preview(child, true)}`);
  if (more) items.push('…');
  const body = v.kind === 'array' ? `[${items.join(', ')}]` : `{${items.join(', ')}}`;
  return header ? `${header} ${body}` : body;
}

export function ValueView({ value, top = false }: { value: SerializedValue; top?: boolean }) {
  switch (value.t) {
    case 'string':
      return top ? <span className="v-text">{value.v}</span> : <span className="v-string">{JSON.stringify(value.v)}</span>;
    case 'number':
    case 'bigint':
      return <span className="v-number">{value.v}</span>;
    case 'boolean':
      return <span className="v-number">{String(value.v)}</span>;
    case 'undefined':
    case 'null':
    case 'circular':
      return <span className="v-null">{preview(value)}</span>;
    case 'symbol':
    case 'regexp':
      return <span className="v-string">{value.v}</span>;
    case 'date':
      return <span className="v-text">{value.v}</span>;
    case 'function':
      return (
        <span className="v-fn">
          <i>ƒ</i> {value.name}()
        </span>
      );
    case 'node':
      return <span className="v-node">{preview(value)}</span>;
    case 'error':
      return <ErrorView value={value} />;
    case 'object':
      return <ObjectView value={value} />;
  }
}

function ErrorView({ value }: { value: Extract<SerializedValue, { t: 'error' }> }) {
  const [open, setOpen] = useState(false);
  const frames = value.stack?.split('\n').slice(1).join('\n');
  return (
    <span className="v-error">
      {frames ? (
        <button type="button" className="v-toggle" onClick={() => setOpen(!open)}>
          <IconChevron open={open} /> {value.name}: {value.message}
        </button>
      ) : (
        `${value.name}: ${value.message}`
      )}
      {open && frames && <pre className="v-stack">{frames}</pre>}
    </span>
  );
}

function ObjectView({ value }: { value: ObjectValue }) {
  const [open, setOpen] = useState(false);
  const expandable = !value.deep && value.entries.length > 0;
  if (!expandable) return <span className="v-object">{preview(value)}</span>;
  return (
    <span className="v-object">
      <button type="button" className="v-toggle" onClick={() => setOpen(!open)}>
        <IconChevron open={open} /> <span className="v-italic">{preview(value)}</span>
      </button>
      {open && (
        <span className="v-children">
          {value.entries.map(([k, child]) => (
            <span className="v-row" key={k}>
              <span className="v-key">{k}</span>
              <span className="v-colon">{value.kind === 'map' ? ' => ' : ': '}</span>
              <ValueView value={child} />
            </span>
          ))}
          {value.truncated && <span className="v-row v-null">… mais itens não exibidos</span>}
        </span>
      )}
    </span>
  );
}

/** JSON value (already parsed) rendered as an expandable tree. */
export function JsonTree({ data }: { data: unknown }) {
  return <ValueView value={fromJson(data, 0)} />;
}

function fromJson(data: unknown, depth: number): SerializedValue {
  if (data === null) return { t: 'null' };
  if (typeof data === 'string') return { t: 'string', v: data };
  if (typeof data === 'number') return { t: 'number', v: String(data) };
  if (typeof data === 'boolean') return { t: 'boolean', v: data };
  const isArray = Array.isArray(data);
  const pairs = isArray ? (data as unknown[]).map((v, i) => [String(i), v] as const) : Object.entries(data as object);
  return {
    t: 'object',
    kind: isArray ? 'array' : 'object',
    cls: isArray ? 'Array' : 'Object',
    size: isArray ? pairs.length : undefined,
    entries: depth > 50 ? [] : pairs.map(([k, v]) => [k, fromJson(v, depth + 1)]),
  };
}
