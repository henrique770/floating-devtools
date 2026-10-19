import type { CSSProperties } from 'react';
import { familyOf, fontById } from './fonts';

export interface ThemePalette {
  bg: string;
  bgElev: string;
  bgHover: string;
  bgActive: string;
  border: string;
  borderStrong: string;
  text: string;
  textDim: string;
  textFaint: string;
  accent: string;
  red: string;
  yellow: string;
  green: string;
  string: string;
  number: string;
  key: string;
  nil: string;
  fn: string;
  node: string;
  /** Floating button glyph color (defaults to accent). */
  fab?: string;
  /** Corner radius of the panel, in px. */
  radius?: number;
  /** Light background: softer shadows, light scrollbars and native controls. */
  light?: boolean;
}

export interface Theme {
  id: string;
  name: string;
  palette: ThemePalette;
}

export const THEMES: Theme[] = [
  {
    id: 'default',
    name: 'Default',
    palette: {
      bg: '#0a0a0a', bgElev: '#111111', bgHover: '#1a1a1a', bgActive: '#222222',
      border: '#262626', borderStrong: '#333333',
      text: '#ededed', textDim: '#a1a1a1', textFaint: '#6e6e6e',
      accent: '#3b82f6', red: '#ff6b6b', yellow: '#f5c84b', green: '#4ade80',
      string: '#f29766', number: '#9a8cff', key: '#7cacf8', nil: '#8b8b8b', fn: '#c49cff', node: '#5db0d7',
      fab: '#ffffff',
    },
  },
  {
    id: 'dracula',
    name: 'Dracula',
    palette: {
      bg: '#282a36', bgElev: '#21222c', bgHover: '#343746', bgActive: '#44475a',
      border: '#343746', borderStrong: '#44475a',
      text: '#f8f8f2', textDim: '#c2c5d6', textFaint: '#6272a4',
      accent: '#bd93f9', red: '#ff5555', yellow: '#f1fa8c', green: '#50fa7b',
      string: '#f1fa8c', number: '#bd93f9', key: '#8be9fd', nil: '#6272a4', fn: '#50fa7b', node: '#ff79c6',
    },
  },
  {
    id: 'tokyo-night',
    name: 'Tokyo Night',
    palette: {
      bg: '#1a1b26', bgElev: '#16161e', bgHover: '#232433', bgActive: '#2f3549',
      border: '#262838', borderStrong: '#3b4261',
      text: '#c0caf5', textDim: '#a9b1d6', textFaint: '#565f89',
      accent: '#7aa2f7', red: '#f7768e', yellow: '#e0af68', green: '#9ece6a',
      string: '#9ece6a', number: '#ff9e64', key: '#7dcfff', nil: '#565f89', fn: '#bb9af7', node: '#2ac3de',
    },
  },
  {
    id: 'catppuccin',
    name: 'Catppuccin',
    palette: {
      bg: '#1e1e2e', bgElev: '#181825', bgHover: '#2a2b3c', bgActive: '#313244',
      border: '#313244', borderStrong: '#45475a',
      text: '#cdd6f4', textDim: '#bac2de', textFaint: '#6c7086',
      accent: '#cba6f7', red: '#f38ba8', yellow: '#f9e2af', green: '#a6e3a1',
      string: '#a6e3a1', number: '#fab387', key: '#89b4fa', nil: '#7f849c', fn: '#f5c2e7', node: '#94e2d5',
    },
  },
  {
    id: 'gruvbox',
    name: 'Gruvbox',
    palette: {
      bg: '#282828', bgElev: '#1d2021', bgHover: '#32302f', bgActive: '#3c3836',
      border: '#3c3836', borderStrong: '#504945',
      text: '#ebdbb2', textDim: '#d5c4a1', textFaint: '#928374',
      accent: '#fe8019', red: '#fb4934', yellow: '#fabd2f', green: '#b8bb26',
      string: '#b8bb26', number: '#d3869b', key: '#83a598', nil: '#928374', fn: '#8ec07c', node: '#fabd2f',
      radius: 6,
    },
  },
  {
    id: 'nord',
    name: 'Nord',
    palette: {
      bg: '#2e3440', bgElev: '#272c36', bgHover: '#3b4252', bgActive: '#434c5e',
      border: '#3b4252', borderStrong: '#4c566a',
      text: '#eceff4', textDim: '#d8dee9', textFaint: '#7b88a1',
      accent: '#88c0d0', red: '#bf616a', yellow: '#ebcb8b', green: '#a3be8c',
      string: '#a3be8c', number: '#b48ead', key: '#81a1c1', nil: '#7b88a1', fn: '#8fbcbb', node: '#5e81ac',
    },
  },
  {
    id: 'cyberpunk',
    name: 'Cyberpunk 2077',
    palette: {
      bg: '#0b0b12', bgElev: '#12121c', bgHover: '#1b1b28', bgActive: '#26261a',
      border: '#24243a', borderStrong: '#5a5612',
      text: '#ecead8', textDim: '#b9b69c', textFaint: '#6d6b58',
      accent: '#fcee0a', red: '#ff003c', yellow: '#fcee0a', green: '#00ff9f',
      string: '#00ff9f', number: '#fcee0a', key: '#00f0ff', nil: '#6d6b58', fn: '#ff2a6d', node: '#00f0ff',
      radius: 2,
    },
  },
  {
    id: 'evangelion',
    name: 'Evangelion',
    palette: {
      bg: '#1a1024', bgElev: '#140c1c', bgHover: '#24183a', bgActive: '#30204c',
      border: '#2c1d42', borderStrong: '#4a3370',
      text: '#ece4f4', textDim: '#bcaccf', textFaint: '#7a6890',
      accent: '#8fe03f', red: '#ff3b3b', yellow: '#ff9a1f', green: '#8fe03f',
      string: '#8fe03f', number: '#ff9a1f', key: '#b48cff', nil: '#7a6890', fn: '#ff9a1f', node: '#c3a6ff',
      radius: 4,
    },
  },
  {
    id: 'synthwave',
    name: "SynthWave '84",
    palette: {
      bg: '#262335', bgElev: '#211c2f', bgHover: '#322b4a', bgActive: '#3d3460',
      border: '#34294f', borderStrong: '#495495',
      text: '#f4eeff', textDim: '#b6b1d1', textFaint: '#848bbd',
      accent: '#ff7edb', red: '#fe4450', yellow: '#fede5d', green: '#72f1b8',
      string: '#ff8b39', number: '#f97e72', key: '#36f9f6', nil: '#848bbd', fn: '#fede5d', node: '#ff7edb',
    },
  },

  // ------------------------------------------------------------ light
  // In the syntax colors, `node` is used for keywords and `key` for properties (see .hl-* in styles.css).
  {
    id: 'one-light',
    name: 'Atom One Light',
    palette: {
      bg: '#fafafa', bgElev: '#f0f0f1', bgHover: '#eaeaeb', bgActive: '#dfe0e2',
      border: '#e5e5e6', borderStrong: '#d0d1d6',
      text: '#383a42', textDim: '#5c5f69', textFaint: '#a0a1a7',
      accent: '#4078f2', red: '#e45649', yellow: '#c18401', green: '#50a14f',
      string: '#50a14f', number: '#986801', key: '#e45649', nil: '#a0a1a7', fn: '#4078f2', node: '#a626a4',
      light: true,
    },
  },
  {
    id: 'ayu-light',
    name: 'Ayu Light',
    palette: {
      bg: '#fcfcfc', bgElev: '#f3f4f5', bgHover: '#eff0f1', bgActive: '#e4e6e8',
      border: '#e7e8e9', borderStrong: '#d6d8db',
      text: '#5c6166', textDim: '#787b80', textFaint: '#a0a6ad',
      accent: '#ff9940', red: '#e65050', yellow: '#e59d00', green: '#86b300',
      string: '#86b300', number: '#a37acc', key: '#399ee6', nil: '#adb1b8', fn: '#eba400', node: '#fa8d3e',
      light: true,
    },
  },
  {
    id: 'white-black',
    name: 'White & Black',
    palette: {
      bg: '#ffffff', bgElev: '#f5f5f5', bgHover: '#efefef', bgActive: '#e2e2e2',
      border: '#e4e4e4', borderStrong: '#111111',
      text: '#000000', textDim: '#333333', textFaint: '#767676',
      accent: '#000000', red: '#c40000', yellow: '#8a6100', green: '#1a7f37',
      string: '#444444', number: '#000000', key: '#000000', nil: '#808080', fn: '#000000', node: '#000000',
      fab: '#000000', radius: 4, light: true,
    },
  },
  {
    id: 'github-light',
    name: 'GitHub Light',
    palette: {
      bg: '#ffffff', bgElev: '#f6f8fa', bgHover: '#f3f4f6', bgActive: '#e7ebef',
      border: '#d8dee4', borderStrong: '#c1c8cf',
      text: '#1f2328', textDim: '#59636e', textFaint: '#818b98',
      accent: '#0969da', red: '#cf222e', yellow: '#9a6700', green: '#1a7f37',
      string: '#0a3069', number: '#0550ae', key: '#953800', nil: '#6e7781', fn: '#8250df', node: '#cf222e',
      light: true,
    },
  },
  {
    id: 'solarized-light',
    name: 'Solarized Light',
    palette: {
      bg: '#fdf6e3', bgElev: '#eee8d5', bgHover: '#f3ecd7', bgActive: '#e6dfc6',
      border: '#e8e1cb', borderStrong: '#d3cbb2',
      text: '#586e75', textDim: '#657b83', textFaint: '#93a1a1',
      accent: '#268bd2', red: '#dc322f', yellow: '#b58900', green: '#859900',
      string: '#2aa198', number: '#d33682', key: '#268bd2', nil: '#93a1a1', fn: '#b58900', node: '#859900',
      light: true,
    },
  },
  {
    id: 'gruvbox-light',
    name: 'Gruvbox Light',
    palette: {
      bg: '#fbf1c7', bgElev: '#f2e5bc', bgHover: '#f2e5bc', bgActive: '#e6d6a8',
      border: '#ebdbb2', borderStrong: '#d5c4a1',
      text: '#3c3836', textDim: '#504945', textFaint: '#928374',
      accent: '#076678', red: '#9d0006', yellow: '#b57614', green: '#79740e',
      string: '#79740e', number: '#8f3f71', key: '#076678', nil: '#928374', fn: '#427b58', node: '#9d0006',
      radius: 6, light: true,
    },
  },
  {
    id: 'rose-pine-dawn',
    name: 'Rosé Pine Dawn',
    palette: {
      bg: '#faf4ed', bgElev: '#fffaf3', bgHover: '#f4ede8', bgActive: '#e9e2dd',
      border: '#ece5df', borderStrong: '#cecacd',
      text: '#575279', textDim: '#797593', textFaint: '#9893a5',
      accent: '#907aa9', red: '#b4637a', yellow: '#ea9d34', green: '#56949f',
      string: '#ea9d34', number: '#b4637a', key: '#907aa9', nil: '#9893a5', fn: '#d7827e', node: '#286983',
      light: true,
    },
  },
  {
    id: 'catppuccin-latte',
    name: 'Catppuccin Latte',
    palette: {
      bg: '#eff1f5', bgElev: '#e6e9ef', bgHover: '#e4e7ed', bgActive: '#d6dae3',
      border: '#dce0e8', borderStrong: '#bcc0cc',
      text: '#4c4f69', textDim: '#5c5f77', textFaint: '#8c8fa1',
      accent: '#8839ef', red: '#d20f39', yellow: '#df8e1d', green: '#40a02b',
      string: '#40a02b', number: '#fe640b', key: '#7287fd', nil: '#8c8fa1', fn: '#1e66f5', node: '#8839ef',
      light: true,
    },
  },
];

export const themeById = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0];

function rgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const n = parseInt(full, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * CSS custom properties for a theme. Applied through React's style prop (CSSOM),
 * so they work even on sites whose CSP forbids inline styles.
 */
export function themeVars(theme: Theme, translucent: boolean, opacity: number): CSSProperties {
  const p = theme.palette;
  const a = translucent ? opacity : 1;
  const surface = (hex: string, factor = 1) => (translucent ? rgba(hex, Math.min(1, a * factor)) : hex);
  return {
    '--bg': surface(p.bg),
    '--bg-elev': surface(p.bgElev, 0.85),
    '--bg-hover': translucent ? rgba(p.bgHover, 0.7) : p.bgHover,
    '--bg-active': translucent ? rgba(p.bgActive, 0.8) : p.bgActive,
    '--bg-selected': rgba(p.accent, 0.18),
    '--bg-input': translucent ? rgba(p.bg, 0.45) : p.bg,
    '--row-border': rgba(p.border, translucent ? 0.55 : 0.6),
    '--border': translucent ? rgba(p.border, 0.8) : p.border,
    '--border-strong': p.borderStrong,
    '--text': p.text,
    '--text-dim': p.textDim,
    '--text-faint': p.textFaint,
    '--accent': p.accent,
    '--red': p.red,
    '--red-bg': rgba(p.red, 0.09),
    '--red-border': rgba(p.red, 0.22),
    '--red-solid': p.red,
    '--yellow': p.yellow,
    '--yellow-bg': rgba(p.yellow, 0.07),
    '--yellow-border': rgba(p.yellow, 0.2),
    '--green': p.green,
    '--green-bg': rgba(p.green, 0.1),
    '--v-string': p.string,
    '--v-number': p.number,
    '--v-key': p.key,
    '--v-null': p.nil,
    '--v-fn': p.fn,
    '--v-node': p.node,
    '--fab-bg': translucent ? rgba(p.bg, Math.max(0.55, a)) : p.bg,
    '--fab-fg': p.fab ?? p.accent,
    '--radius': `${p.radius ?? 12}px`,
    '--blur': translucent ? 'blur(18px) saturate(160%)' : 'none',
    '--scheme': p.light ? 'light' : 'dark',
    '--ring': p.light ? 'rgba(15, 23, 42, 0.1)' : 'rgba(0, 0, 0, 0.8)',
    '--ring-strong': p.light ? 'rgba(15, 23, 42, 0.14)' : 'rgba(0, 0, 0, 0.9)',
    '--shadow': p.light ? 'rgba(15, 23, 42, 0.16)' : 'rgba(0, 0, 0, 0.55)',
    '--shadow-soft': p.light ? 'rgba(15, 23, 42, 0.12)' : 'rgba(0, 0, 0, 0.45)',
    '--on-yellow': p.light ? '#fff' : '#000',
  } as CSSProperties;
}

export function typographyVars(a: { font: string; fontSize: number; fontWeight: number; fontInUi: boolean }): CSSProperties {
  const family = familyOf(fontById(a.font));
  const vars: Record<string, string> = { '--fs': `${a.fontSize}px`, '--fw': String(a.fontWeight), '--mono': family };
  if (a.fontInUi) vars['--sans'] = family;
  return vars as CSSProperties;
}
