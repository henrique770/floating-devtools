export interface FontOption {
  id: string;
  name: string;
  note: string;
  /** Folder name in @fontsource / dist/fonts. Undefined = system font, nothing to load. */
  file?: string;
  recommended?: boolean;
}

export const FONT_WEIGHTS = [400, 500, 700] as const;
export type FontWeight = (typeof FONT_WEIGHTS)[number];

export const FONTS: FontOption[] = [
  { id: 'system', name: 'Sistema', note: 'SF Mono / Menlo / Consolas — sem download' },
  { id: 'atkinson', name: 'Atkinson Hyperlegible Mono', file: 'atkinson-hyperlegible-mono', note: 'Feita para baixa visão: 0/O e 1/l/I inconfundíveis', recommended: true },
  { id: 'intel', name: 'Intel One Mono', file: 'intel-one-mono', note: 'Alto contraste e legibilidade para baixa visão', recommended: true },
  { id: 'jetbrains', name: 'JetBrains Mono', file: 'jetbrains-mono', note: 'Altura-x alta, ótima em tamanhos pequenos', recommended: true },
  { id: 'fira', name: 'Fira Code', file: 'fira-code', note: 'Ligaduras de código (=> !== >=)' },
  { id: 'plex', name: 'IBM Plex Mono', file: 'ibm-plex-mono', note: 'Clara, neutra e com negrito marcante' },
  { id: 'cascadia', name: 'Cascadia Code', file: 'cascadia-code', note: 'A fonte do Windows Terminal' },
  { id: 'source', name: 'Source Code Pro', file: 'source-code-pro', note: 'Clássica da Adobe, traço limpo' },
  { id: 'geist', name: 'Geist Mono', file: 'geist-mono', note: 'Estilo Vercel / Next.js' },
  { id: 'commit', name: 'Commit Mono', file: 'commit-mono', note: 'Neutra, feita para não distrair' },
  { id: 'victor', name: 'Victor Mono', file: 'victor-mono', note: 'Estreita: cabe mais texto por linha' },
];

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
