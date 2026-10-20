import { defineMessages } from '../i18n';

export interface FontOption {
  id: string;
  name: string;
  /** Folder name in @fontsource / dist/fonts. Undefined = system font, nothing to load. */
  file?: string;
  recommended?: boolean;
}

export const FONT_WEIGHTS = [400, 500, 700] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const FONTS: FontOption[] = [
  { id: 'system', name: 'System' },
  { id: 'atkinson', name: 'Atkinson Hyperlegible Mono', file: 'atkinson-hyperlegible-mono', recommended: true },
  { id: 'intel', name: 'Intel One Mono', file: 'intel-one-mono', recommended: true },
  { id: 'jetbrains', name: 'JetBrains Mono', file: 'jetbrains-mono', recommended: true },
  { id: 'fira', name: 'Fira Code', file: 'fira-code' },
  { id: 'plex', name: 'IBM Plex Mono', file: 'ibm-plex-mono' },
  { id: 'cascadia', name: 'Cascadia Code', file: 'cascadia-code' },
  { id: 'source', name: 'Source Code Pro', file: 'source-code-pro' },
  { id: 'geist', name: 'Geist Mono', file: 'geist-mono' },
  { id: 'commit', name: 'Commit Mono', file: 'commit-mono' },
  { id: 'victor', name: 'Victor Mono', file: 'victor-mono' },
];

const m = defineMessages<{ system: string; notes: Record<string, string> }>({
  pt: {
    system: 'Sistema',
    notes: {
      system: 'SF Mono / Menlo / Consolas — sem download',
      atkinson: 'Feita para baixa visão: 0/O e 1/l/I inconfundíveis',
      intel: 'Alto contraste e legibilidade para baixa visão',
      jetbrains: 'Altura-x alta, ótima em tamanhos pequenos',
      fira: 'Ligaduras de código (=> !== >=)',
      plex: 'Clara, neutra e com negrito marcante',
      cascadia: 'A fonte do Windows Terminal',
      source: 'Clássica da Adobe, traço limpo',
      geist: 'Estilo Vercel / Next.js',
      commit: 'Neutra, feita para não distrair',
      victor: 'Estreita: cabe mais texto por linha',
    },
  },
  en: {
    system: 'System',
    notes: {
      system: 'SF Mono / Menlo / Consolas — no download',
      atkinson: 'Made for low vision: 0/O and 1/l/I unmistakable',
      intel: 'High contrast and legibility for low vision',
      jetbrains: 'Tall x-height, great at small sizes',
      fira: 'Code ligatures (=> !== >=)',
      plex: 'Clear, neutral, with a strong bold',
      cascadia: 'The Windows Terminal font',
      source: "Adobe's classic, clean strokes",
      geist: 'Vercel / Next.js style',
      commit: 'Neutral, made not to distract',
      victor: 'Narrow: fits more text per line',
    },
  },
});

export const fontName = (f: FontOption) => (f.id === 'system' ? m().system : f.name);
export const fontNote = (f: FontOption) => m().notes[f.id] ?? '';

const SYSTEM_MONO = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', monospace";

export const fontById = (id: string) => FONTS.find((f) => f.id === id) ?? FONTS[0];

/** Prefixed family name, so it can never collide with a font the site itself declares. */
export const familyOf = (font: FontOption) => (font.file ? `'FDT ${font.name}', ${SYSTEM_MONO}` : SYSTEM_MONO);

const loading = new Map<string, Promise<void>>();

/**
 * Loads a bundled font into the page's FontFaceSet. The bytes are fetched from the extension
 * and passed as an ArrayBuffer, so the site's CSP (font-src) cannot block it.
 */
export function loadFont(font: FontOption, weights: readonly number[] = FONT_WEIGHTS): Promise<void> {
  if (!font.file) return Promise.resolve();
  return Promise.all(
    weights.map((weight) => {
      const key = `${font.file}-${weight}`;
      const cached = loading.get(key);
      if (cached) return cached;
      const p: Promise<void> = fetch(chrome.runtime.getURL(`fonts/${key}.woff2`))
          .then((r) => r.arrayBuffer())
          .then(async (buf) => {
            const face = new FontFace(`FDT ${font.name}`, buf, { weight: String(weight) });
            await face.load();
            document.fonts.add(face);
          })
        .catch(() => {
          loading.delete(key);
        });
      loading.set(key, p);
      return p;
    }),
  ).then(() => undefined);
}
