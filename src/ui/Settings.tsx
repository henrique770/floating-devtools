import { useEffect, useRef, useState } from 'react';
import { DEFAULT_INSIGHTS_CONFIG, type InsightsConfig } from '../analysis/diagnostics/types';
import { defineMessages, LOCALE_NAMES, LOCALES, systemLocale, type LanguageSetting } from '../i18n';
import { familyOf, fontName, fontNote, FONTS, loadFont, type FontWeight } from './fonts';
import { ProviderSettings } from './ProviderSettings';
import { THEMES } from './themes';

const m = defineMessages({
  pt: {
    settings: 'Configurações',
    section: 'Seção',
    appearance: 'Aparência',
    assistant: 'Assistente',
    language: 'Idioma',
    languageLabel: 'Idioma da interface',
    system: (name: string) => `Sistema (${name})`,
    languageNote: 'Também é o idioma dos diagnósticos, do relatório de bug e das respostas do assistente.',
    translucent: 'Translúcido',
    opacity: 'Opacidade',
    font: 'Fonte',
    size: 'Tamanho',
    smaller: 'Diminuir fonte',
    larger: 'Aumentar fonte',
    weight: 'Peso',
    fontWeight: 'Peso da fonte',
    weights: { 400: 'Regular', 500: 'Médio', 700: 'Negrito' } as Record<FontWeight, string>,
    boldErrors: 'Erros e avisos em negrito',
    fontInUi: 'Usar também nas abas e menus',
    contrast: 'contraste',
    theme: 'Tema',
    dark: 'Escuros',
    light: 'Claros',
    themes: (group: string) => `Temas ${group.toLowerCase()}`,
    limits: 'Limites de alerta',
    limitsNote: 'Usados pelos diagnósticos locais da aba Insights. Ao mudar um limite, os diagnósticos são recalculados com o que já foi capturado.',
    durationNote: 'A duração é o tempo total da requisição; o TTFB aparece separado nas evidências quando há dados de timing.',
    restore: 'Restaurar padrões',
    limitLabels: {
      slowMs: 'Requisição lenta acima de',
      largeBytes: 'Recurso pesado acima de',
      duplicateMin: 'Duplicadas a partir de',
      duplicateWindowMs: 'Dentro de uma janela de',
    } as Record<keyof InsightsConfig, string>,
    calls: 'chamadas',
  },
  en: {
    settings: 'Settings',
    section: 'Section',
    appearance: 'Appearance',
    assistant: 'Assistant',
    language: 'Language',
    languageLabel: 'Interface language',
    system: (name) => `System (${name})`,
    languageNote: 'It is also the language of the diagnostics, the bug report and the assistant answers.',
    translucent: 'Translucent',
    opacity: 'Opacity',
    font: 'Font',
    size: 'Size',
    smaller: 'Smaller font',
    larger: 'Larger font',
    weight: 'Weight',
    fontWeight: 'Font weight',
    weights: { 400: 'Regular', 500: 'Medium', 700: 'Bold' },
    boldErrors: 'Errors and warnings in bold',
    fontInUi: 'Also use in tabs and menus',
    contrast: 'contrast',
    theme: 'Theme',
    dark: 'Dark',
    light: 'Light',
    themes: (group) => `${group} themes`,
    limits: 'Alert limits',
    limitsNote: 'Used by the local diagnostics in the Insights tab. When a limit changes, the diagnostics are recomputed with what was already captured.',
    durationNote: 'Duration is the total request time; TTFB is shown separately in the evidence when timing data is available.',
    restore: 'Restore defaults',
    limitLabels: {
      slowMs: 'Slow request above',
      largeBytes: 'Heavy resource above',
      duplicateMin: 'Duplicates from',
      duplicateWindowMs: 'Within a window of',
    },
    calls: 'calls',
  },
});

export interface Appearance {
  theme: string;
  translucent: boolean;
  opacity: number;
  font: string;
  fontSize: number;
  fontWeight: FontWeight;
  boldErrors: boolean;
  fontInUi: boolean;
}

export const DEFAULT_APPEARANCE: Appearance = {
  theme: 'default',
  translucent: false,
  opacity: 0.75,
  font: 'system',
  fontSize: 12,
  fontWeight: 400,
  boldErrors: false,
  fontInUi: false,
};

const THEME_GROUPS = [
  { key: 'dark', light: false },
  { key: 'light', light: true },
] as const;

const WEIGHTS: FontWeight[] = [400, 500, 700];

export type SettingsSection = 'appearance' | 'insights' | 'assistant';

interface Props {
  value: Appearance;
  onChange: (next: Appearance) => void;
  onClose: () => void;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
  insights: InsightsConfig;
  onInsights: (next: InsightsConfig) => void;
  language: LanguageSetting;
  onLanguage: (next: LanguageSetting) => void;
}

export function Settings({ value, onChange, onClose, section, onSection, insights, onInsights, language, onLanguage }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const set = (patch: Partial<Appearance>) => onChange({ ...value, ...patch });

  // Load every font in the chosen weight so the previews render in their real typeface.
  useEffect(() => {
    FONTS.forEach((f) => loadFont(f, [value.fontWeight]));
  }, [value.fontWeight]);

  // Close when clicking anywhere else in the panel (the gear toggles it itself).
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const path = e.composedPath();
      if (ref.current && !path.includes(ref.current) && !path.some((n) => (n as Element).classList?.contains('fdt-gear'))) onClose();
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [onClose]);

  const t = m();
  return (
    <div className="settings" ref={ref} role="dialog" aria-label={t.settings}>
      <div className="segmented settings-sections" role="tablist" aria-label={t.section}>
        <button type="button" role="tab" aria-checked={section === 'appearance'} onClick={() => onSection('appearance')}>
          {t.appearance}
        </button>
        <button type="button" role="tab" aria-checked={section === 'insights'} onClick={() => onSection('insights')}>
          Insights
        </button>
        <button type="button" role="tab" aria-checked={section === 'assistant'} onClick={() => onSection('assistant')}>
          {t.assistant}
        </button>
      </div>
      {section === 'assistant' ? (
        <ProviderSettings />
      ) : section === 'insights' ? (
        <InsightsSettings value={insights} onChange={onInsights} />
      ) : (
        <>
          <LanguageSettings value={language} onChange={onLanguage} />
          <AppearanceSettings value={value} set={set} />
        </>
      )}
    </div>
  );
}

/** "System" follows the browser/OS language; each option is written in its own language so it can be found from any other. */
function LanguageSettings({ value, onChange }: { value: LanguageSetting; onChange: (next: LanguageSetting) => void }) {
  const t = m();
  return (
    <>
      <h3>{t.language}</h3>
      <div className="settings-row">
        <label htmlFor="fdt-language">{t.languageLabel}</label>
        <select id="fdt-language" className="fdt-select" value={value} onChange={(e) => onChange(e.target.value as LanguageSetting)}>
          <option value="system">{t.system(LOCALE_NAMES[systemLocale()])}</option>
          {LOCALES.map((l) => (
            <option key={l} value={l} lang={l}>
              {LOCALE_NAMES[l]}
            </option>
          ))}
        </select>
      </div>
      <p className="settings-hint settings-note">{t.languageNote}</p>
    </>
  );
}

function AppearanceSettings({ value, set }: { value: Appearance; set: (patch: Partial<Appearance>) => void }) {
  const t = m();
  return (
    <>
      <h3>{t.appearance}</h3>
      <div className="settings-row">
        <label htmlFor="fdt-translucent">{t.translucent}</label>
        <button
          id="fdt-translucent"
          type="button"
          role="switch"
          aria-checked={value.translucent}
          className="switch"
          onClick={() => set({ translucent: !value.translucent })}
        />
      </div>
      {value.translucent && (
        <div className="settings-row">
          <label htmlFor="fdt-opacity">{t.opacity}</label>
          <input
            id="fdt-opacity"
            className="range"
            type="range"
            min={0.35}
            max={0.95}
            step={0.05}
            value={value.opacity}
            onChange={(e) => set({ opacity: Number(e.target.value) })}
          />
          <span className="settings-hint">{Math.round(value.opacity * 100)}%</span>
        </div>
      )}

      <h3>{t.font}</h3>
      <div className="settings-row">
        <label htmlFor="fdt-font-size">{t.size}</label>
        <div className="stepper">
          <button type="button" onClick={() => set({ fontSize: Math.max(10, value.fontSize - 1) })} aria-label={t.smaller}>
            A−
          </button>
          <input
            id="fdt-font-size"
            className="range"
            type="range"
            min={10}
            max={18}
            step={1}
            value={value.fontSize}
            onChange={(e) => set({ fontSize: Number(e.target.value) })}
          />
          <button type="button" onClick={() => set({ fontSize: Math.min(18, value.fontSize + 1) })} aria-label={t.larger}>
            A+
          </button>
          <span className="settings-hint">{value.fontSize}px</span>
        </div>
      </div>
      <div className="settings-row">
        <span>{t.weight}</span>
        <div className="segmented" role="radiogroup" aria-label={t.fontWeight}>
          {WEIGHTS.map((w) => (
            <button key={w} type="button" role="radio" aria-checked={value.fontWeight === w} style={{ fontWeight: w }} onClick={() => set({ fontWeight: w })}>
              {t.weights[w]}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="fdt-bold-errors">{t.boldErrors}</label>
        <button
          id="fdt-bold-errors"
          type="button"
          role="switch"
          aria-checked={value.boldErrors}
          className="switch"
          onClick={() => set({ boldErrors: !value.boldErrors })}
        />
      </div>
      <div className="settings-row">
        <label htmlFor="fdt-font-ui">{t.fontInUi}</label>
        <button
          id="fdt-font-ui"
          type="button"
          role="switch"
          aria-checked={value.fontInUi}
          className="switch"
          onClick={() => set({ fontInUi: !value.fontInUi })}
        />
      </div>
      <div className="font-list" role="radiogroup" aria-label={t.font}>
        {FONTS.map((f) => (
          <button
            key={f.id}
            type="button"
            role="radio"
            aria-checked={value.font === f.id}
            className="font-card"
            onClick={() => set({ font: f.id })}
          >
            <span className="font-card-head">
              <span className="font-card-name">{fontName(f)}</span>
              {f.recommended && <span className="font-badge">{t.contrast}</span>}
            </span>
            <span className="font-sample" style={{ fontFamily: familyOf(f), fontWeight: value.fontWeight }}>
              0O 1lI {'{}'} =&gt; <span className="font-sample-err">404 TypeError</span>
            </span>
            <span className="settings-hint">{fontNote(f)}</span>
          </button>
        ))}
      </div>

      <h3>{t.theme}</h3>
      {THEME_GROUPS.map((g) => (
        <div key={g.key} className="theme-group">
          <span className="settings-hint">{t[g.key]}</span>
          <div className="theme-grid" role="radiogroup" aria-label={t.themes(t[g.key])}>
            {THEMES.filter((t) => !!t.palette.light === g.light).map((t) => {
              const p = t.palette;
              return (
                <button
                  key={t.id}
                  type="button"
                  role="radio"
                  aria-checked={value.theme === t.id}
                  className="theme-card"
                  onClick={() => set({ theme: t.id })}
                  title={t.name}
                >
                  <span className="theme-swatch" style={{ background: p.bg, border: `1px solid ${p.borderStrong}` }}>
                    <span className="theme-swatch-line" style={{ background: p.accent, width: '55%' }} />
                    <span className="theme-swatch-dots">
                      {[p.red, p.yellow, p.green, p.key, p.fn].map((c, i) => (
                        <span key={i} style={{ background: c }} />
                      ))}
                    </span>
                  </span>
                  <span className="theme-name">{t.name}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </>
  );
}

/** `unit: null` = a count, labelled in the interface language. */
const LIMITS: { key: keyof InsightsConfig; unit: string | null; min: number; max: number; step: number; scale?: number }[] = [
  { key: 'slowMs', unit: 'ms', min: 100, max: 60_000, step: 100 },
  { key: 'largeBytes', unit: 'kB', min: 10, max: 100_000, step: 10, scale: 1000 },
  { key: 'duplicateMin', unit: null, min: 2, max: 50, step: 1 },
  { key: 'duplicateWindowMs', unit: 'ms', min: 100, max: 60_000, step: 100 },
];

/** Limits of the local diagnostics. Applied on blur/Enter, so typing doesn't re-run the rules on every key. */
function InsightsSettings({ value, onChange }: { value: InsightsConfig; onChange: (next: InsightsConfig) => void }) {
  const t = m();
  return (
    <>
      <h3>{t.limits}</h3>
      <p className="settings-hint settings-note">{t.limitsNote}</p>
      {LIMITS.map((l) => (
        <LimitRow key={l.key} limit={l} value={value[l.key]} onCommit={(n) => onChange({ ...value, [l.key]: n })} />
      ))}
      <div className="settings-row">
        <span className="settings-hint">{t.durationNote}</span>
      </div>
      <button type="button" className="link-btn" onClick={() => onChange(DEFAULT_INSIGHTS_CONFIG)}>
        {t.restore}
      </button>
    </>
  );
}

function LimitRow({ limit: l, value, onCommit }: { limit: (typeof LIMITS)[number]; value: number; onCommit: (n: number) => void }) {
  const scale = l.scale ?? 1;
  const [draft, setDraft] = useState(String(value / scale));
  useEffect(() => setDraft(String(value / scale)), [value, scale]);
  const commit = () => {
    const n = Number(draft);
    if (!Number.isFinite(n) || draft.trim() === '') return setDraft(String(value / scale));
    const clamped = Math.min(l.max, Math.max(l.min, Math.round(n)));
    setDraft(String(clamped));
    if (clamped * scale !== value) onCommit(clamped * scale);
  };
  const id = `fdt-limit-${l.key}`;
  const t = m();
  return (
    <div className="settings-row">
      <label htmlFor={id}>{t.limitLabels[l.key]}</label>
      <span className="settings-number">
        <input
          id={id}
          className="fdt-input"
          type="number"
          inputMode="numeric"
          min={l.min}
          max={l.max}
          step={l.step}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => e.key === 'Enter' && commit()}
        />
        <span className="settings-hint">{l.unit ?? t.calls}</span>
      </span>
    </div>
  );
}
