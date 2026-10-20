import type { Locale } from '../i18n';

/** AI providers (BYOK). All of them speak the OpenAI-compatible chat completions API. */

export interface ProviderInfo {
  id: string;
  name: string;
  baseUrl: string;
  models: { id: string; label: string }[];
  keyUrl: string;
  keyPlaceholder: string;
}

export const PROVIDERS: ProviderInfo[] = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    models: [
      { id: 'deepseek-chat', label: 'Chat' },
      { id: 'deepseek-reasoner', label: 'Reasoner' },
    ],
    keyUrl: 'https://platform.deepseek.com/api_keys',
    keyPlaceholder: 'sk-…',
  },
];

export const providerById = (id: string | undefined) => PROVIDERS.find((p) => p.id === id);

export interface ProviderConfig {
  apiKey: string;
  model: string;
}

export interface AiConfig {
  /** Provider used by the assistant. */
  active?: string;
  providers: Record<string, ProviderConfig>;
}

/** chrome.storage.local key. Read by the background directly, so the key never passes through the page. */
export const AI_CONFIG_KEY = 'ai.config';
export const EMPTY_AI_CONFIG: AiConfig = { providers: {} };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

/** Port name for chat streaming between the content script and the background. */
export const AI_PORT = 'ai-chat';

/** Content script -> background (over the AI_PORT port). */
/** `locale` words the background's error messages in the interface language. */
export type AiRequest =
  | { kind: 'chat'; messages: ChatMessage[]; locale?: Locale }
  | { kind: 'test'; providerId: string; apiKey: string; locale?: Locale };

/** Background -> content script (over the AI_PORT port). */
export type AiResponse =
  | { kind: 'delta'; text: string }
  | { kind: 'thinking' }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
