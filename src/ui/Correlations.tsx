import { confidenceLabel, type Correlation } from '../analysis/correlate';
import type { EventRef } from '../analysis/diagnostics/types';
import type { ConsoleEntry, NetworkEntry } from '../shared/types';
import { formatClock, formatMs, isErrorEntry, shortName, statusLabel } from './format';
import { defineMessages } from '../i18n';
import { preview } from './ValueView';

const m = defineMessages({
  pt: {
    requestGone: 'Requisição fora do buffer',
    logGone: 'Mensagem fora do buffer',
    empty: 'Nenhuma relação encontrada nos dados capturados.',
    confidence: 'Grau de confiança da associação',
    openIn: (tab: string) => `Abrir na aba ${tab}`,
    gone: 'O evento não está mais retido',
  },
  en: {
    requestGone: 'Request no longer in the buffer',
    logGone: 'Message no longer in the buffer',
    empty: 'No relation found in the captured data.',
    confidence: 'Confidence level of the link',
    openIn: (tab) => `Open in the ${tab} tab`,
    gone: 'The event is no longer retained',
  },
});

export interface EventLabel {
  text: string;
  error?: boolean;
  /** False once the event left the capture buffer. */
  available: boolean;
}

export function requestLabel(r: NetworkEntry | undefined): EventLabel {
  if (!r) return { text: m().requestGone, available: false };
  return {
    text: `${r.method} ${shortName(r.url)} → ${statusLabel(r)}${r.duration !== undefined && r.state !== 'pending' ? ` · ${formatMs(r.duration)}` : ''}`,
    error: isErrorEntry(r),
    available: true,
  };
}

export function logLabel(l: ConsoleEntry | undefined): EventLabel {
  if (!l) return { text: m().logGone, available: false };
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
export function CorrelationList({ items, label, onOpen, empty }: Props) {
  const t = m();
  if (!items.length) return <div className="muted corr-empty">{empty ?? t.empty}</div>;
  return (
    <ul className="corr-list">
      {items.map((c) => {
        const l = label(c.ref);
        return (
          <li key={`${c.ref.kind}:${c.ref.id}`} className="corr-item">
            <span className={`corr-conf conf-${c.confidence}`} title={t.confidence}>
              {confidenceLabel(c.confidence)}
            </span>
            <span className="corr-main">
              <button
                type="button"
                className={`corr-target${l.error ? ' is-error' : ''}`}
                disabled={!l.available}
                onClick={() => onOpen(c.ref)}
                title={l.available ? t.openIn(c.ref.kind === 'request' ? 'Network' : 'Console') : t.gone}
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
