import { useCallback, useEffect, useState } from 'react';
import { AI_CONFIG_KEY, EMPTY_AI_CONFIG, providerById, type AiConfig } from '../shared/ai';

/** AI provider settings in chrome.storage.local, kept in sync between Settings and the Assistant tab. */
export function useAiConfig(): [AiConfig, (next: AiConfig) => void] {
  const [config, setConfig] = useState<AiConfig>(EMPTY_AI_CONFIG);

  useEffect(() => {
    chrome.storage.local
      .get(AI_CONFIG_KEY)
      .then((r) => r[AI_CONFIG_KEY] && setConfig(r[AI_CONFIG_KEY] as AiConfig))
      .catch(() => {});
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && AI_CONFIG_KEY in changes) setConfig((changes[AI_CONFIG_KEY].newValue as AiConfig) ?? EMPTY_AI_CONFIG);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);

  const save = useCallback((next: AiConfig) => {
    setConfig(next);
    chrome.storage.local.set({ [AI_CONFIG_KEY]: next }).catch(() => {});
  }, []);

  return [config, save];
}

/** The provider the assistant will use, if it has a key. */
export function activeProvider(config: AiConfig) {
  const provider = providerById(config.active);
  const settings = provider && config.providers[provider.id];
  return provider && settings?.apiKey ? { provider, settings } : undefined;
}
