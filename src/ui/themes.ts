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
  } as CSSProperties;
}

export function typographyVars(a: { font: string; fontSize: number; fontWeight: number; fontInUi: boolean }): CSSProperties {
  const family = familyOf(fontById(a.font));
  const vars: Record<string, string> = { '--fs': `${a.fontSize}px`, '--fw': String(a.fontWeight), '--mono': family };
  if (a.fontInUi) vars['--sans'] = family;
  return vars as CSSProperties;
}
