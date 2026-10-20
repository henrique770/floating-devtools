import { useSyncExternalStore } from 'react';
import { getLocale, onLocaleChange, type Locale } from '../i18n';

/**
 * Subscribes a component to language changes. Needed only by memoized components (and their
 * memoized values): everything else re-renders with its parent.
 */
export function useLocale(): Locale {
  return useSyncExternalStore(onLocaleChange, getLocale);
}
