import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent as ReactPointerEvent } from 'react';
import { DEFAULT_INSIGHTS_CONFIG, type EventRef, type InsightsConfig } from '../analysis/diagnostics/types';
import type { DevtoolsStore } from '../content/store';
import { AssistantTab } from './AssistantTab';
import { ConsoleTab } from './ConsoleTab';
import { IconAssistant, IconClose, IconGear, IconMaximize, IconMinimize, Logo } from './Icons';
import { InsightsTab, notableDiagnostics } from './InsightsTab';
import { NetworkTab } from './NetworkTab';
import { fontById, loadFont } from './fonts';
import { isErrorEntry } from './format';
import { DEFAULT_APPEARANCE, Settings, type Appearance, type SettingsSection } from './Settings';
import { themeById, themeVars, typographyVars } from './themes';
import { usePersistentState } from './usePersistentState';

const BUTTON = 40;
const MARGIN = 12;
const GAP = 10;
const SNAP = 36;
const MIN_W = 320;
const MIN_H = 220;

type Tab = 'network' | 'console' | 'insights' | 'assistant';
type Focus = { id: string; nonce: number };
type Size = { w: number; h: number };
type Viewport = { w: number; h: number };

const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

function useViewport(): Viewport {
  const read = () => {
    const el = document.documentElement;
    return { w: el.clientWidth || window.innerWidth, h: Math.min(window.innerHeight, el.clientHeight || window.innerHeight) };
  };
  const [vp, setVp] = useState(read);
  useEffect(() => {
    const onResize = () => setVp(read());
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  return vp;
}

function useEnabled() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    chrome.storage.local.get('enabled').then((r) => setEnabled(r.enabled !== false));
    const onChange = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
      if (area === 'local' && 'enabled' in changes) setEnabled(changes.enabled.newValue !== false);
    };
    chrome.storage.onChanged.addListener(onChange);
    return () => chrome.storage.onChanged.removeListener(onChange);
  }, []);
  return enabled;
}

interface Props {
  store: DevtoolsStore;
  onTogglePanelRequest: (fn: () => void) => () => void;
}

export function App({ store, onTogglePanelRequest }: Props) {
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const vp = useViewport();
  const enabled = useEnabled();
  // Button position is stored as a 0..1 ratio of the free area, so it survives window resizes.
  const [ratio, setRatio, ratioLoaded] = usePersistentState('button', { x: 1, y: 1 });
  const [tab, setTab] = usePersistentState<Tab>('tab', 'network');
  const [size, setSize] = usePersistentState<Size>('panel', { w: 646, h: 660 });
  const [maximized, setMaximized] = usePersistentState('maximized', false);
  // Free panel position (0..1 ratio) once the user drags it by the header; null = anchored to the button.
  const [panelPos, setPanelPos] = usePersistentState<{ x: number; y: number } | null>('panelPos', null);
  const [storedAppearance, setAppearance] = usePersistentState<Partial<Appearance>>('appearance', DEFAULT_APPEARANCE);
  // Merge with defaults so settings saved by older versions gain the new fields.
  const appearance = useMemo(() => ({ ...DEFAULT_APPEARANCE, ...storedAppearance }), [storedAppearance]);
  const [storedInsights, setInsights, insightsLoaded] = usePersistentState<Partial<InsightsConfig>>('insights', DEFAULT_INSIGHTS_CONFIG);
  const insights = useMemo(() => ({ ...DEFAULT_INSIGHTS_CONFIG, ...storedInsights }), [storedInsights]);
  useEffect(() => {
    if (insightsLoaded) store.setInsightsConfig(insights);
  }, [store, insights, insightsLoaded]);

  useEffect(() => {
    loadFont(fontById(appearance.font));
  }, [appearance.font]);
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => onTogglePanelRequest(() => setOpen((o) => !o)), [onTogglePanelRequest]);
  useEffect(() => {
    if (open) setMounted(true);
  }, [open]);

  // While closed the panel keeps its last snapshot, so it does not re-render on every request.
  const panelSnap = useRef(snap);
  if (open) panelSnap.current = snap;

  const freeW = Math.max(0, vp.w - BUTTON - MARGIN * 2);
  const freeH = Math.max(0, vp.h - BUTTON - MARGIN * 2);
  const button = useMemo(() => ({ left: MARGIN + ratio.x * freeW, top: MARGIN + ratio.y * freeH }), [ratio, freeW, freeH]);
  const onClose = useCallback(() => setOpen(false), []);
  const onToggleMaximized = useCallback(() => setMaximized(!maximized), [maximized, setMaximized]);

  const vars = useMemo(
    () => ({ ...themeVars(themeById(appearance.theme), appearance.translucent, appearance.opacity), ...typographyVars(appearance) }),
    [appearance],
  );

  if (!enabled || !ratioLoaded) return null;

  return (
    <div className={`fdt-theme${appearance.boldErrors ? ' bold-errors' : ''}`} style={vars}>
      {mounted && (
        <Panel
          hidden={!open}
          store={store}
          snap={panelSnap.current}
          vp={vp}
          button={button}
          size={size}
          onResize={setSize}
          maximized={maximized}
          onToggleMaximized={onToggleMaximized}
          tab={tab}
          onTab={setTab}
          onClose={onClose}
          appearance={appearance}
          onAppearance={setAppearance}
          insights={insights}
          onInsights={setInsights}
          panelPos={panelPos}
          onPanelPos={setPanelPos}
        />
      )}
      <FloatingButton
        vp={vp}
        position={button}
        open={open}
        errors={snap.errors}
        onClick={() => setOpen(!open)}
        onDrop={(left, top) => setRatio({ x: freeW ? (left - MARGIN) / freeW : 0, y: freeH ? (top - MARGIN) / freeH : 0 })}
      />
    </div>
  );
}

// ------------------------------------------------------------------ button

interface ButtonProps {
  vp: Viewport;
  position: { left: number; top: number };
  open: boolean;
  errors: number;
  onClick: () => void;
  onDrop: (left: number, top: number) => void;
}

function FloatingButton({ vp, position, open, errors, onClick, onDrop }: ButtonProps) {
  const [drag, setDrag] = useState<{ left: number; top: number } | null>(null);
  const gesture = useRef<{ x: number; y: number; left: number; top: number; moved: boolean; last: { left: number; top: number } } | null>(null);

  const maxLeft = vp.w - BUTTON - MARGIN;
  const maxTop = vp.h - BUTTON - MARGIN;

  const onPointerDown = (e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = { x: e.clientX, y: e.clientY, left: position.left, top: position.top, moved: false, last: position };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = gesture.current;
    if (!g) return;
    const dx = e.clientX - g.x;
    const dy = e.clientY - g.y;
    if (!g.moved && Math.hypot(dx, dy) < 4) return;
    g.moved = true;
    g.last = { left: clamp(g.left + dx, MARGIN, maxLeft), top: clamp(g.top + dy, MARGIN, maxTop) };
    setDrag(g.last);
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    if (!g.moved) {
      onClick();
      return;
    }
    // Magnet: stick flush to an edge when released close to it.
    let { left, top } = g.last;
    if (left - MARGIN < SNAP) left = MARGIN;
    else if (maxLeft - left < SNAP) left = maxLeft;
    if (top - MARGIN < SNAP) top = MARGIN;
    else if (maxTop - top < SNAP) top = maxTop;
    onDrop(left, top);
    setDrag(null);
  };

  const pos = drag ?? position;
  return (
    <button
      type="button"
      className={`fdt-fab${drag ? ' is-dragging' : ''}${open ? ' is-open' : ''}`}
      style={{ left: pos.left, top: pos.top }}
      title="Floating DevTools — clique para abrir, arraste para mover"
      aria-label="Abrir Floating DevTools"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      <Logo />
      {errors > 0 && <span className="fdt-fab-badge">{errors > 99 ? '99+' : errors}</span>}
    </button>
  );
}

// ------------------------------------------------------------------ panel

type Placement = { left: number; top: number; w: number; h: number; gripX: 'left' | 'right'; gripY: 'top' | 'bottom' };

/** Places the panel next to the button on the side with the most room. */
function placePanel(btn: { left: number; top: number }, size: Size, vp: Viewport): Placement {
  const w = clamp(size.w, Math.min(MIN_W, vp.w - MARGIN * 2), vp.w - MARGIN * 2);
  const h = clamp(size.h, Math.min(MIN_H, vp.h - MARGIN * 2), vp.h - MARGIN * 2);
  const space = {
    above: btn.top - GAP - MARGIN,
    below: vp.h - (btn.top + BUTTON + GAP) - MARGIN,
    left: btn.left - GAP - MARGIN,
    right: vp.w - (btn.left + BUTTON + GAP) - MARGIN,
  };
  const onRightHalf = btn.left + BUTTON / 2 > vp.w / 2;
  const onBottomHalf = btn.top + BUTTON / 2 > vp.h / 2;

  let left: number;
  let top: number;
  let gripX: Placement['gripX'];
  let gripY: Placement['gripY'];

  const verticalFits = Math.max(space.above, space.below) >= h;
  const horizontalFits = Math.max(space.left, space.right) >= w;

  if (verticalFits || (!horizontalFits && Math.max(space.above, space.below) * w >= Math.max(space.left, space.right) * h)) {
    const goUp = space.above >= h ? space.below < h || onBottomHalf : space.above > space.below;
    top = goUp ? btn.top - GAP - h : btn.top + BUTTON + GAP;
    left = onRightHalf ? btn.left + BUTTON - w : btn.left;
    gripY = goUp ? 'top' : 'bottom';
    gripX = onRightHalf ? 'left' : 'right';
  } else {
    const goLeft = space.left >= w ? space.right < w || onRightHalf : space.left > space.right;
    left = goLeft ? btn.left - GAP - w : btn.left + BUTTON + GAP;
    top = btn.top + BUTTON / 2 - h / 2;
    gripX = goLeft ? 'left' : 'right';
    gripY = onBottomHalf ? 'top' : 'bottom';
  }

  return {
    left: clamp(left, MARGIN, vp.w - w - MARGIN),
    top: clamp(top, MARGIN, vp.h - h - MARGIN),
    w,
    h,
    gripX,
    gripY,
  };
}

interface PanelProps {
  hidden: boolean;
  store: DevtoolsStore;
  snap: ReturnType<DevtoolsStore['getSnapshot']>;
  vp: Viewport;
  button: { left: number; top: number };
  size: Size;
  onResize: (s: Size) => void;
  maximized: boolean;
  onToggleMaximized: () => void;
  tab: Tab;
  onTab: (t: Tab) => void;
  onClose: () => void;
  appearance: Appearance;
  onAppearance: (a: Appearance) => void;
  insights: InsightsConfig;
  onInsights: (c: InsightsConfig) => void;
  panelPos: { x: number; y: number } | null;
  onPanelPos: (pos: { x: number; y: number } | null) => void;
}

const Panel = memo(function Panel({ hidden, store, snap, vp, button, size, onResize, maximized, onToggleMaximized, tab, onTab, onClose, appearance, onAppearance, insights, onInsights, panelPos, onPanelPos }: PanelProps) {
  const [liveSize, setLiveSize] = useState<Size | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('appearance');
  const closeSettings = useCallback(() => setSettingsOpen(false), []);
  const openProviderSettings = useCallback(() => {
    setSettingsSection('assistant');
    setSettingsOpen(true);
  }, []);
  const resize = useRef<{ x: number; y: number; w: number; h: number; last: Size } | null>(null);

  // Cross-tab navigation: Insights -> the original request/log, or -> the Assistant with a prepared question.
  const [netFocus, setNetFocus] = useState<Focus>();
  const [logFocus, setLogFocus] = useState<Focus>();
  const [aiDraft, setAiDraft] = useState<{ text: string; nonce: number }>();
  const navigate = useCallback(
    (ref: EventRef) => {
      const focus = { id: ref.id, nonce: Date.now() };
      if (ref.kind === 'request') setNetFocus(focus);
      else setLogFocus(focus);
      onTab(ref.kind === 'request' ? 'network' : 'console');
    },
    [onTab],
  );
  const askAi = useCallback(
    (text: string) => {
      setAiDraft({ text, nonce: Date.now() });
      onTab('assistant');
    },
    [onTab],
  );

  const [livePos, setLivePos] = useState<{ left: number; top: number } | null>(null);
  const suppressClick = useRef(false);

  let place: Placement;
  if (maximized) {
    place = { left: MARGIN, top: MARGIN, w: vp.w - MARGIN * 2, h: vp.h - MARGIN * 2, gripX: 'right', gripY: 'bottom' };
  } else if (livePos || panelPos) {
    const cur = liveSize ?? size;
    const w = clamp(cur.w, Math.min(MIN_W, vp.w - MARGIN * 2), vp.w - MARGIN * 2);
    const h = clamp(cur.h, Math.min(MIN_H, vp.h - MARGIN * 2), vp.h - MARGIN * 2);
    const pos = livePos ?? { left: MARGIN + panelPos!.x * (vp.w - w - MARGIN * 2), top: MARGIN + panelPos!.y * (vp.h - h - MARGIN * 2) };
    place = { left: pos.left, top: pos.top, w, h, gripX: 'right', gripY: 'bottom' };
  } else {
    place = placePanel(button, liveSize ?? size, vp);
  }

  // Drag the panel by its header. Small movements still count as clicks (tabs keep working).
  // Move/up are tracked on window so fast drags that leave the header aren't lost.
  const onHeaderDown = (e: ReactPointerEvent<HTMLElement>) => {
    if (e.button !== 0 || maximized || (e.target as Element).closest('.fdt-header-actions')) return;
    const start = { x: e.clientX, y: e.clientY, left: place.left, top: place.top };
    const bounds = { maxLeft: vp.w - place.w - MARGIN, maxTop: vp.h - place.h - MARGIN, w: place.w, h: place.h };
    let moved = false;
    let last = { left: start.left, top: start.top };

    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      if (!moved && Math.hypot(dx, dy) < 4) return;
      moved = true;
      ev.preventDefault();
      window.getSelection()?.removeAllRanges();
      last = { left: clamp(start.left + dx, MARGIN, bounds.maxLeft), top: clamp(start.top + dy, MARGIN, bounds.maxTop) };
      setLivePos(last);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      if (!moved) return;
      suppressClick.current = true;
      setTimeout(() => (suppressClick.current = false), 0);
      const freeW = vp.w - bounds.w - MARGIN * 2;
      const freeH = vp.h - bounds.h - MARGIN * 2;
      onPanelPos({ x: freeW > 0 ? (last.left - MARGIN) / freeW : 0, y: freeH > 0 ? (last.top - MARGIN) / freeH : 0 });
      setLivePos(null);
    };
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
  };

  const onGripDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    resize.current = { x: e.clientX, y: e.clientY, w: place.w, h: place.h, last: { w: place.w, h: place.h } };
  };
  const onGripMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resize.current;
    if (!r) return;
    const dx = (e.clientX - r.x) * (place.gripX === 'left' ? -1 : 1);
    const dy = (e.clientY - r.y) * (place.gripY === 'top' ? -1 : 1);
    r.last = { w: Math.max(MIN_W, r.w + dx), h: Math.max(MIN_H, r.h + dy) };
    setLiveSize(r.last);
  };
  const onGripUp = () => {
    const r = resize.current;
    resize.current = null;
    if (!r) return;
    onResize(r.last);
    setLiveSize(null);
  };

  const requestCount = snap.requests.length;
  const requestErrors = useMemo(() => snap.requests.filter(isErrorEntry).length, [snap.requests]);
  const notable = useMemo(() => notableDiagnostics(snap), [snap]);
  const notableHigh = notable.some((d) => d.severity === 'high');

  return (
    <div
      className={`fdt-panel${hidden ? ' is-hidden' : ''}${livePos ? ' is-moving' : ''}`}
      style={{ left: place.left, top: place.top, width: place.w, height: place.h }}
      onKeyDown={(e) => e.key === 'Escape' && (settingsOpen ? setSettingsOpen(false) : onClose())}
      role="dialog"
      aria-label="Floating DevTools"
    >
      <header
        className={`fdt-header${livePos ? ' is-dragging' : ''}${maximized ? '' : ' is-draggable'}`}
        onPointerDown={onHeaderDown}
        onClickCapture={(e) => {
          if (suppressClick.current) {
            suppressClick.current = false;
            e.stopPropagation();
            e.preventDefault();
          }
        }}
      >
        <div className="fdt-tabs" role="tablist">
          <button type="button" role="tab" aria-selected={tab === 'network'} className="fdt-tab" onClick={() => onTab('network')}>
            Network
            {requestCount > 0 && <span className="fdt-count">{requestCount}</span>}
            {requestErrors > 0 && (
              <span className="fdt-count is-error" title="Requisições com falha ou status >= 400">
                {requestErrors}
              </span>
            )}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'console'} className="fdt-tab" onClick={() => onTab('console')}>
            Console
            {snap.errors > 0 && <span className="fdt-count is-error">{snap.errors}</span>}
            {snap.warnings > 0 && <span className="fdt-count is-warn">{snap.warnings}</span>}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'insights'} className="fdt-tab" onClick={() => onTab('insights')}>
            Insights
            {notable.length > 0 && (
              <span className={`fdt-count${notableHigh ? ' is-error' : ''}`} title="Diagnósticos ativos (exceto informativos)">
                {notable.length}
              </span>
            )}
          </button>
          <button type="button" role="tab" aria-selected={tab === 'assistant'} className="fdt-tab" onClick={() => onTab('assistant')}>
            <IconAssistant size={16} className="fdt-tab-icon" />
            Assistant
          </button>
        </div>
        <div
          className="fdt-drag-zone"
          title={panelPos ? 'Arraste para mover · duplo clique para voltar ao botão' : 'Arraste para mover'}
          onDoubleClick={() => onPanelPos(null)}
        />
        <div className="fdt-header-actions">
          <button
            type="button"
            className={`fdt-icon-btn fdt-gear${settingsOpen ? ' is-active' : ''}`}
            onClick={() => setSettingsOpen(!settingsOpen)}
            title="Configurações"
          >
            <IconGear />
          </button>
          <button type="button" className="fdt-icon-btn" onClick={onToggleMaximized} title={maximized ? 'Restaurar' : 'Maximizar'}>
            {maximized ? <IconMinimize /> : <IconMaximize />}
          </button>
          <button type="button" className="fdt-icon-btn" onClick={onClose} title="Fechar (Esc)">
            <IconClose />
          </button>
        </div>
      </header>
      <div className="fdt-body">
        {settingsOpen && (
          <Settings
            value={appearance}
            onChange={onAppearance}
            onClose={closeSettings}
            section={settingsSection}
            onSection={setSettingsSection}
            insights={insights}
            onInsights={onInsights}
          />
        )}
        <div className="fdt-tab-content" hidden={tab !== 'network'}>
          <NetworkTab store={store} requests={snap.requests} recording={snap.recording} width={place.w} focus={netFocus} logs={snap.logs} onNavigate={navigate} />
        </div>
        <div className="fdt-tab-content" hidden={tab !== 'console'}>
          <ConsoleTab store={store} logs={snap.logs} groups={snap.groups} requests={snap.requests} active={!hidden && tab === 'console'} focus={logFocus} onNavigate={navigate} />
        </div>
        <div className="fdt-tab-content" hidden={tab !== 'insights'}>
          <InsightsTab store={store} snap={snap} slowMs={insights.slowMs} onNavigate={navigate} onAskAi={askAi} />
        </div>
        <div className="fdt-tab-content" hidden={tab !== 'assistant'}>
          <AssistantTab store={store} snap={snap} active={!hidden && tab === 'assistant'} onOpenSettings={openProviderSettings} draft={aiDraft} />
        </div>
      </div>
      {!maximized && (
        <div
          className={`fdt-grip is-${place.gripY}-${place.gripX}`}
          onPointerDown={onGripDown}
          onPointerMove={onGripMove}
          onPointerUp={onGripUp}
          onPointerCancel={onGripUp}
          title="Redimensionar"
        />
      )}
    </div>
  );
});
