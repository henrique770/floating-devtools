import type { ConsoleEntry } from '../shared/types';

export type LogOrigin = 'page' | 'third-party' | 'unknown';

/** Whether an entry was logged by code served from the page's own origin or from elsewhere (CDNs, widgets, analytics). */
export function originOf(entry: ConsoleEntry, pageOrigin: string): LogOrigin {
  const url = entry.source?.url.replace(/:\d+$/, '');
  if (!url) return 'unknown';
  try {
    const { origin } = new URL(url);
    // webpack://, data: and friends have no meaningful origin.
    if (origin === 'null') return 'unknown';
    return origin === pageOrigin ? 'page' : 'third-party';
  } catch {
    return 'unknown';
  }
}
