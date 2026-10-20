import { afterEach, describe, expect, it, vi } from 'vitest';
import { httpErrorRule } from '../analysis/diagnostics/rules/network';
import { DEFAULT_INSIGHTS_CONFIG } from '../analysis/diagnostics/types';
import { DevtoolsStore } from '../content/store';
import type { NetworkEntry } from '../shared/types';
import { buildPayload } from '../ui/assistantContext';
import { buildReport, toMarkdown } from '../ui/bugReport';
import { bodyNoteText } from '../ui/format';
import { getLocale, onLocaleChange, resolveLocale, setLocale, systemLocale } from '.';

const ctx = { config: DEFAULT_INSIGHTS_CONFIG, pageOrigin: 'https://app.test' };
const req = (extra: Partial<NetworkEntry> = {}): NetworkEntry => ({
  id: 'r1',
  url: 'https://app.test/api/users',
  method: 'GET',
  status: 500,
  statusText: '',
  type: 'fetch',
  state: 'done',
  startTime: 1000,
  duration: 120,
  ...extra,
});

afterEach(() => setLocale('pt'));

describe('locale resolution', () => {
  it('takes the first supported language of the preference list', () => {
    expect(systemLocale(['pt-BR', 'en-US'])).toBe('pt');
    expect(systemLocale(['pt-PT'])).toBe('pt');
    expect(systemLocale(['fr-FR', 'en-GB', 'pt-BR'])).toBe('en');
    expect(systemLocale(['de_DE', 'pt'])).toBe('pt');
  });

  it('falls back to English when no language is supported', () => {
    expect(systemLocale(['ja-JP', 'de'])).toBe('en');
    expect(systemLocale([])).toBe('en');
  });

  it('uses an explicit choice and follows the system otherwise', () => {
    expect(resolveLocale('en')).toBe('en');
    expect(resolveLocale('pt')).toBe('pt');
    expect(resolveLocale('system')).toBe(systemLocale());
    expect(resolveLocale('klingon')).toBe(systemLocale());
  });

  it('notifies listeners only on an actual change', () => {
    const fn = vi.fn();
    const off = onLocaleChange(fn);
    setLocale('pt');
    expect(fn).not.toHaveBeenCalled();
    setLocale('en');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(getLocale()).toBe('en');
    off();
    setLocale('pt');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe('localized output', () => {
  it('writes diagnostics in the current language', () => {
    expect(httpErrorRule.evaluate(req(), ctx)!.title).toBe('Erro do servidor (HTTP 500)');
    setLocale('en');
    const f = httpErrorRule.evaluate(req(), ctx)!;
    expect(f.title).toBe('Server error (HTTP 500)');
    expect(f.description).toBe('GET app.test responded with status 500.');
  });

  it('rewrites the captured diagnostics when the language changes, keeping their ids', () => {
    vi.useFakeTimers();
    try {
      const store = new DevtoolsStore(() => {}, 'https://app.test');
      store.handlePageMessage({ kind: 'net', patch: req() });
      vi.advanceTimersByTime(100);
      const before = store.getSnapshot().diagnostics;
      expect(before[0].title).toBe('Erro do servidor (HTTP 500)');
      store.setDismissed(before[0].id, true);
      setLocale('en');
      vi.advanceTimersByTime(100);
      const after = store.getSnapshot();
      expect(after.diagnostics.map((d) => d.id)).toEqual(before.map((d) => d.id));
      expect(after.diagnostics[0].title).toBe('Server error (HTTP 500)');
      expect(after.dismissed.has(before[0].id)).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders the bug report and the assistant instructions in the current language', () => {
    setLocale('en');
    const snap = { requests: [], logs: [], groups: [], diagnostics: [], dismissed: new Set<string>(), errors: 0, warnings: 0, recording: true };
    const env = { userAgent: 'UA', viewport: '1×1 @1x', language: 'en-US', timeZone: 'UTC' };
    const md = toMarkdown(buildReport(snap, { pageUrl: 'https://app.test/', pageOrigin: 'https://app.test', environment: env }));
    expect(md).toContain('## Steps to reproduce');
    expect(md).toContain('# Problems found on app.test');
    expect(md).not.toContain('Passos');
    const [system, user] = buildPayload([{ role: 'user', content: 'why?' }], 'data', { title: 'GET x', text: 'details' });
    expect(system.content).toContain('Answer in English');
    expect(user.content).toContain('## Item in focus: GET x');
  });

  it('words body notes from the page hook in the current language', () => {
    expect(bodyNoteText({ kind: 'binary', detail: 'image/png' })).toBe('Conteúdo binário (image/png).');
    setLocale('en');
    expect(bodyNoteText({ kind: 'binary', detail: 'image/png' })).toBe('Binary content (image/png).');
    expect(bodyNoteText(undefined)).toBeUndefined();
  });
});
