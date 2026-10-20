import { useEffect, useState } from 'react';
import { defineMessages, intlTag } from '../i18n';
import type { FocusTarget } from './focusContext';

const HISTORY_KEY = 'ai.history';
const MAX_CONVERSATIONS = 50;

export type ChatEntry = { role: 'user' | 'assistant'; content: string; error?: boolean };

export interface Conversation {
  id: string;
  title: string;
  /** Host of the page the conversation started on. */
  host: string;
  provider?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatEntry[];
  /** Item the conversation is about (already masked), so follow-ups keep its context after reopening. */
  focus?: SavedFocus;
}

export interface SavedFocus {
  target: FocusTarget;
  title: string;
  text: string;
}

const read = async () => ((await chrome.storage.local.get(HISTORY_KEY))[HISTORY_KEY] as Conversation[] | undefined) ?? [];

/** Saved conversations (most recent first), shared by every tab and kept in sync. */
export function useChatHistory(): Conversation[] {
  const [list, setList] = useState<Conversation[]>([]);
  useEffect(() => {
    read().then(setList).catch(() => {});
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && HISTORY_KEY in changes) setList((changes[HISTORY_KEY].newValue as Conversation[]) ?? []);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return list;
}

// Writes are chained so two quick saves never read the same stale list.
let queue = Promise.resolve();
const update = (fn: (list: Conversation[]) => Conversation[]) =>
  (queue = queue
    .then(async () => chrome.storage.local.set({ [HISTORY_KEY]: fn(await read()) }))
    .catch(() => {}));

export function saveConversation(conv: Conversation) {
  return update((list) => [conv, ...list.filter((c) => c.id !== conv.id)].slice(0, MAX_CONVERSATIONS));
}

export function deleteConversation(id: string) {
  return update((list) => list.filter((c) => c.id !== id));
}

export function clearHistory() {
  return update(() => []);
}

export const newConversationId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

export function titleFrom(question: string) {
  const line = question.trim().split('\n')[0];
  return line.length > 70 ? `${line.slice(0, 70)}…` : line;
}

const m = defineMessages({
  pt: { now: 'agora', ago: (n: number, unit: string) => `há ${n} ${unit}` },
  en: { now: 'just now', ago: (n, unit) => `${n} ${unit} ago` },
});

export function relativeTime(epoch: number) {
  const t = m();
  const diff = Date.now() - epoch;
  const min = Math.round(diff / 60_000);
  if (min < 1) return t.now;
  if (min < 60) return t.ago(min, 'min');
  const h = Math.round(min / 60);
  if (h < 24) return t.ago(h, 'h');
  const d = Math.round(h / 24);
  if (d < 7) return t.ago(d, 'd');
  return new Date(epoch).toLocaleDateString(intlTag(), { day: '2-digit', month: 'short' });
}
