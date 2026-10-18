import { useCallback, useEffect, useState } from 'react';

/** useState backed by chrome.storage.local, shared across all sites. */
export function usePersistentState<T>(key: string, initial: T): [T, (value: T) => void, boolean] {
  const storageKey = `ui.${key}`;
  const [value, setValue] = useState<T>(initial);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let alive = true;
    chrome.storage.local
      .get(storageKey)
      .then((res) => {
        if (alive && res[storageKey] !== undefined) setValue(res[storageKey] as T);
      })
      .catch(() => {})
      .finally(() => alive && setLoaded(true));
    return () => {
      alive = false;
    };
  }, [storageKey]);

  const set = useCallback(
    (next: T) => {
      setValue(next);
      chrome.storage.local.set({ [storageKey]: next }).catch(() => {});
    },
    [storageKey],
  );

  return [value, set, loaded];
}
