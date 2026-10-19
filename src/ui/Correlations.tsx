import { CONFIDENCE_LABEL, type Correlation } from '../analysis/correlate';
import type { EventRef } from '../analysis/diagnostics/types';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { formatClock, formatMs, isErrorEntry, shortName, statusLabel } from './format';
import { preview } from './ValueView';

export interface EventLabel {
  text: string;
  error?: boolean;
  /** False once the event left the capture buffer. */
  available: boolean;
}

export function requestLabel(r: NetworkEntry | undefined): EventLabel {
  if (!r) return { text: 'Requisição fora do buffer', available: false };
  return {
    text: `${r.method} ${shortName(r.url)} → ${statusLabel(r)}${r.duration !== undefined && r.state !== 'pending' ? ` · ${formatMs(r.duration)}` : ''}`,
    error: isErrorEntry(r),
    available: true,
  };
}

export function logLabel(l: ConsoleEntry | undefined): EventLabel {
  if (!l) return { text: 'Mensagem fora do buffer', available: false };
  const text = `${formatClock(l.time)} ${l.prefix ? `${l.prefix} ` : ''}${l.args.map((a) => preview(a)).join(' ')}`;
  return { text: text.length > 160 ? `${text.slice(0, 160)}…` : text, error: l.level === 'error', available: true };
}

interface Props {
  items: Correlation[];
  label: (ref: EventRef) => EventLabel;
  onOpen: (ref: EventRef) => void;
  empty?: string;
}

/** Related events with the confidence of each link and why it was made. */
export function CorrelationList({ items, label, onOpen, empty = 'Nenhuma relação encontrada nos dados capturados.' }: Props) {
  if (!items.length) return <div className="muted corr-empty">{empty}</div>;
  return (
    <ul className="corr-list">
      {items.map((c) => {
        const l = label(c.ref);
        return (
          <li key={`${c.ref.kind}:${c.ref.id}`} className="corr-item">
            <span className={`corr-conf conf-${c.confidence}`} title="Grau de confiança da associação">
              {CONFIDENCE_LABEL[c.confidence]}
            </span>
            <span className="corr-main">
              <button
                type="button"
                className={`corr-target${l.error ? ' is-error' : ''}`}
                disabled={!l.available}
                onClick={() => onOpen(c.ref)}
                title={l.available ? `Abrir na aba ${c.ref.kind === 'request' ? 'Network' : 'Console'}` : 'O evento não está mais retido'}
              >
                <span className="ins-related-kind">{c.ref.kind === 'request' ? 'NET' : 'LOG'}</span>
                <span className="ellipsis">{l.text}</span>
              </button>
              <span className="corr-reason">{c.reason}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
