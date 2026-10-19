import { useEffect, useRef } from 'react';
import { familyOf, FONTS, loadFont, type FontWeight } from './fonts';
import { ProviderSettings } from './ProviderSettings';
import { THEMES } from './themes';

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
  { label: 'Escuros', light: false },
  { label: 'Claros', light: true },
];

const WEIGHTS: { value: FontWeight; label: string }[] = [
  { value: 400, label: 'Regular' },
  { value: 500, label: 'Médio' },
  { value: 700, label: 'Negrito' },
];

export type SettingsSection = 'appearance' | 'assistant';

interface Props {
  value: Appearance;
  onChange: (next: Appearance) => void;
  onClose: () => void;
  section: SettingsSection;
  onSection: (s: SettingsSection) => void;
}

export function Settings({ value, onChange, onClose, section, onSection }: Props) {
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

  return (
    <div className="settings" ref={ref} role="dialog" aria-label="Configurações">
      <div className="segmented settings-sections" role="tablist" aria-label="Seção">
        <button type="button" role="tab" aria-checked={section === 'appearance'} onClick={() => onSection('appearance')}>
          Aparência
        </button>
        <button type="button" role="tab" aria-checked={section === 'assistant'} onClick={() => onSection('assistant')}>
          Assistente
        </button>
      </div>
      {section === 'assistant' ? <ProviderSettings /> : <AppearanceSettings value={value} set={set} />}
    </div>
  );
}

function AppearanceSettings({ value, set }: { value: Appearance; set: (patch: Partial<Appearance>) => void }) {
  return (
    <>
      <h3>Aparência</h3>
      <div className="settings-row">
        <label htmlFor="fdt-translucent">Translúcido</label>
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
          <label htmlFor="fdt-opacity">Opacidade</label>
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

      <h3>Fonte</h3>
      <div className="settings-row">
        <label htmlFor="fdt-font-size">Tamanho</label>
        <div className="stepper">
          <button type="button" onClick={() => set({ fontSize: Math.max(10, value.fontSize - 1) })} aria-label="Diminuir fonte">
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
          <button type="button" onClick={() => set({ fontSize: Math.min(18, value.fontSize + 1) })} aria-label="Aumentar fonte">
            A+
          </button>
          <span className="settings-hint">{value.fontSize}px</span>
        </div>
      </div>
      <div className="settings-row">
        <span>Peso</span>
        <div className="segmented" role="radiogroup" aria-label="Peso da fonte">
          {WEIGHTS.map((w) => (
            <button
              key={w.value}
              type="button"
              role="radio"
              aria-checked={value.fontWeight === w.value}
              style={{ fontWeight: w.value }}
              onClick={() => set({ fontWeight: w.value })}
            >
              {w.label}
            </button>
          ))}
        </div>
      </div>
      <div className="settings-row">
        <label htmlFor="fdt-bold-errors">Erros e avisos em negrito</label>
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
        <label htmlFor="fdt-font-ui">Usar também nas abas e menus</label>
        <button
          id="fdt-font-ui"
          type="button"
          role="switch"
          aria-checked={value.fontInUi}
          className="switch"
          onClick={() => set({ fontInUi: !value.fontInUi })}
        />
      </div>
      <div className="font-list" role="radiogroup" aria-label="Fonte">
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
              <span className="font-card-name">{f.name}</span>
              {f.recommended && <span className="font-badge">contraste</span>}
            </span>
            <span className="font-sample" style={{ fontFamily: familyOf(f), fontWeight: value.fontWeight }}>
              0O 1lI {'{}'} =&gt; <span className="font-sample-err">404 TypeError</span>
            </span>
            <span className="settings-hint">{f.note}</span>
          </button>
        ))}
      </div>

      <h3>Tema</h3>
      {THEME_GROUPS.map((g) => (
        <div key={g.label} className="theme-group">
          <span className="settings-hint">{g.label}</span>
          <div className="theme-grid" role="radiogroup" aria-label={`Temas ${g.label.toLowerCase()}`}>
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
