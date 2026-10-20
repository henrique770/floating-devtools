/**
 * Interface language. Messages live next to the code that uses them (`defineMessages`), with one
 * dictionary per locale: TypeScript requires every locale to have the same keys and signatures,
 * so a missing translation is a type error. Parametrized messages are plain functions.
 *
 * The current locale is module state (not React context) because the diagnostics rules, the
 * report and the assistant context also produce text outside React.
 */

export const LOCALES = ['pt', 'en'] as const;
export type Locale = (typeof LOCALES)[number];
/** What the user picked in Settings; `system` follows the browser/OS language. */
export type LanguageSetting = 'system' | Locale;

/** Each language is shown in its own name, so it is recognizable whatever the current one is. */
export const LOCALE_NAMES: Record<Locale, string> = { pt: 'Português', en: 'English' };
/** BCP 47 tag for Intl/toLocale* formatting. */
const INTL_TAG: Record<Locale, string> = { pt: 'pt-BR', en: 'en-US' };
const FALLBACK: Locale = 'en';

const isLocale = (v: unknown): v is Locale => (LOCALES as readonly unknown[]).includes(v);

function preferredLanguages(): readonly string[] {
  try {
    const nav = globalThis.navigator;
    if (nav?.languages?.length) return nav.languages;
    if (nav?.language) return [nav.language];
  } catch {
    /* no navigator */
  }
  return [];
}

/** First supported language in the user's preference list (e.g. `pt-PT` -> `pt`); English otherwise. */
export function systemLocale(languages: readonly string[] = preferredLanguages()): Locale {
  for (const tag of languages) {
    const base = tag.toLowerCase().split(/[-_]/)[0];
    if (isLocale(base)) return base;
  }
  return FALLBACK;
}

export function resolveLocale(setting: unknown): Locale {
  return isLocale(setting) ? setting : systemLocale();
}

let current: Locale = systemLocale();
const listeners = new Set<() => void>();

export const getLocale = (): Locale => current;
export const intlTag = (): string => INTL_TAG[current];

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  listeners.forEach((fn) => fn());
}

export function onLocaleChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Returns a getter for the current locale's dictionary. Call it where the text is produced, not at module load. */
export function defineMessages<T>(dict: { pt: T } & { [L in Exclude<Locale, 'pt'>]: NoInfer<T> }): () => T {
  return () => dict[current];
}

/** `n` with the right plural form of a noun: `plural(3, 'erro', 'erros')`. */
export const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
