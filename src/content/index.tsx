/**
 * Isolated-world content script: receives data from the page hook and the background,
 * and mounts the React UI inside a closed-off Shadow DOM so page CSS cannot touch it.
 */
import { createRoot } from 'react-dom/client';
import { defineMessages } from '../i18n';
import { TO_PAGE, TO_UI, type BackgroundMessage, type PageMessage, type UIMessage } from '../shared/types';
import { App } from '../ui/App';
import styles from '../ui/styles.css?inline';
import { DevtoolsStore } from './store';

const sendToPage = (msg: UIMessage) => document.dispatchEvent(new CustomEvent(TO_PAGE, { detail: JSON.stringify(msg) }));

const m = defineMessages({
  pt: { cspBlocked: 'CSP do site bloqueou eval —' },
  en: { cspBlocked: 'The site CSP blocked eval —' },
});

const store = new DevtoolsStore((code) => sendToPage({ kind: 'eval', code, blockedLabel: m().cspBlocked }));

document.addEventListener(TO_UI, (event) => {
  let msg: PageMessage;
  try {
    msg = JSON.parse((event as CustomEvent<string>).detail);
  } catch {
    return;
  }
  if (msg.kind === 'hello') sendToPage({ kind: 'ready' });
  else store.handlePageMessage(msg);
});
sendToPage({ kind: 'ready' });

const panelToggles = new Set<() => void>();
chrome.runtime.onMessage.addListener((msg: BackgroundMessage) => {
  if (msg.kind === 'webreq') store.handleWebRequest(msg);
  else if (msg.kind === 'toggle-panel') panelToggles.forEach((fn) => fn());
});

function mount() {
  const host = document.createElement('floating-devtools');
  host.setAttribute(
    'style',
    'all: initial !important; position: fixed !important; top: 0 !important; left: 0 !important; width: 0 !important; height: 0 !important; z-index: 2147483647 !important; display: block !important;',
  );
  const shadow = host.attachShadow({ mode: 'open' });
  // Constructable stylesheets are not subject to the site's CSP style-src rules.
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(styles);
  shadow.adoptedStyleSheets = [sheet];
  const container = document.createElement('div');
  container.className = 'fdt-root';
  shadow.append(container);

  // Keep keystrokes typed in our inputs from triggering the site's keyboard shortcuts.
  for (const type of ['keydown', 'keyup', 'keypress']) {
    container.addEventListener(type, (e) => e.stopPropagation());
  }

  const attach = () => {
    if (!host.isConnected) document.documentElement.appendChild(host);
  };
  attach();
  // Some apps rewrite <html> children during hydration; re-attach if we get removed.
  new MutationObserver(attach).observe(document.documentElement, { childList: true });

  createRoot(container).render(
    <App
      store={store}
      onTogglePanelRequest={(fn) => {
        panelToggles.add(fn);
        return () => panelToggles.delete(fn);
      }}
    />,
  );
}

if (window.top === window && document.documentElement) {
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount, { once: true });
}
