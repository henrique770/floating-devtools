# Floating DevTools

A Chrome / Brave / Edge extension (Manifest V3) that puts **Network**, **Console**, automatic **Insights** and an
optional AI **Assistant** inside a floating, draggable button, in the style of the Next.js dev indicator. The panel
opens on top of the page instead of squeezing it.

Everything is captured and analyzed locally in the browser. Nothing leaves it unless you use the AI assistant with
your own API key. See [PRIVACY.md](PRIVACY.md).

## Getting started

```bash
npm install
npm run build        # outputs dist/
npm run dev          # rebuilds on save
npm test             # tests (Vitest)
npm run typecheck
```

Open `chrome://extensions` (or `brave://extensions`), enable **Developer mode**, click **Load unpacked** and select
the `dist/` folder. Reload tabs that were already open.

## Usage

- **Click** the button to open or close the panel. **Drag** it anywhere on the screen; near an edge it snaps to it.
  Its position is saved.
- **Drag the panel header** (including the tab strip) to move the panel anywhere. Double-click an empty spot of the
  header to dock it back next to the button.
- Resize the panel from the marked corner, or use ⤢ to maximize it.
- `Alt+Shift+D` toggles the panel, `Esc` closes it.
- The toolbar icon shows or hides the button on every site.

### Network

- Filter by text (`-text` negates) and by type; sort by any column.
- Details with **Headers**, **Payload**, **Preview**, **Response** and **Timing** tabs, plus **Copy as cURL**.
- Fetch/XHR details also show the **Initiator** (the stack of the caller).
- **⇄ Compare** (in the details), then click another request to compare them side by side:
  - summary (URL, method, status, type, duration, TTFB, download and sizes, with the difference as a value and %);
  - query string, request and response headers, payload and response body;
  - JSON is compared structurally (added, removed and changed fields, with their path, e.g. `$.user.roles[1]`);
    other text is compared line by line.
  
  Clicking another row replaces B, **Swap** exchanges A and B, and the A/B labels open the original details.
  Sensitive values (cookies, `authorization`, tokens, passwords…) stay masked until you check **Sensitive values**;
  the comparison itself uses the real values. Bodies over 300 kB are compared only by equality and size; binary or
  uncaptured responses are flagged.

### Console

- Levels, text filter, origin (this origin / third parties) and time period, expandable objects, collapsed repeated
  messages and unhandled errors.
- A prompt to run JS on the page (↑/↓ for history).
- **Group** merges equivalent messages even when they are not consecutive: 200× `QuotaExceededError` becomes a single
  row with the total, first and last occurrence. Click the counter to see the original occurrences.

  Two messages are equivalent when they share level, prefix, normalized message, origin and the first 3 stack frames
  (without query strings or bundle hashes). Normalization replaces ids, UUIDs, hashes, numbers with 4+ digits and
  decimals with placeholders, and keeps short numbers such as HTTP statuses. Because the error location is part of the
  key, the same message thrown from different places lands in separate groups. With a period filter, groups active in
  that period are shown, but the counter shows the total since the last clear.

### Console ↔ Network correlation

On Console errors and warnings, **⇄** lists the requests that may be related. In a request's details, the
**Related** tab does the opposite. In Insights, each expanded diagnostic shows the relations of its latest
occurrence, and the Assistant receives a summary of them. Each relation has a confidence level and a reason:

- **High**: object identity. The logged error is the very object produced by the failure of `fetch()` or
  `response.json()` (also when it arrives as another error's `cause`). These errors get a **NET ↗** shortcut.
- **Medium**: the error's stack and the code that started the request go through the same page function (library
  frames are ignored), or a JSON error happens right after a non-JSON response.
- **Low**: time proximity only (a failure up to 2 s before the error). Shown as a hint, never as a cause.

Insights also groups **failure bursts** (3+ network errors or 5xx on the same host within 10 s), a sign of a common
cause.

### Insights

Automatic diagnostics generated locally (no AI) from what was captured:

- a dashboard with totals (requests, errors, warnings, diagnostics, slow requests) and a severity breakdown;
- a list of problems with evidence, possible causes, impact, recommendations and related events (click to open the
  original request or log);
- filters by category, severity and text; sorting by relevance or time;
- **Dismiss** hides a diagnostic even if it happens again; **Investigate with AI** opens the Assistant focused on it.

Thresholds (slow request, heavy resource, duplicates) are under **⚙ → Insights**.

Built-in rules:

| Category | Detects |
| --- | --- |
| **JavaScript** | unhandled exceptions (TypeError, ReferenceError, SyntaxError…), unhandled Promise rejections, `Error` objects logged with `console.error`, scripts that failed to load. A plain `console.error("text")` is not a diagnostic. |
| **Network** | HTTP 4xx/5xx, timeouts, cancellations, blocked by the browser (ad blockers), connection failures, **possible CORS** (a cross-origin call where `webRequest` saw the server respond but the page only got "Failed to fetch"; the browser never tells the page why, so it is always presented as a hypothesis), HTML received from an API call, invalid JSON. |
| **Storage** | `QuotaExceededError`, denied storage access, IndexedDB failures. |
| **Performance** | slow requests (total duration; TTFB and download shown separately when timing data exists), heavy resources, identical calls repeated within the same window ("potentially duplicated", since polling and retries also repeat calls). |

Problems coming from third-party scripts or hosts are lowered one severity level. Occurrences of the same problem
(same rule and same endpoint or log group) are merged into one diagnostic.

**Network performance** panel: rankings of the **slowest** requests (a bar with the real phases: queue/connection,
server wait/TTFB and download, or "no phases" when the browser doesn't expose timing) and the **heaviest** resources
(bytes transferred, or body size when served from cache), the median of API calls, and how many exceeded the
configured thresholds (▲). Click a row to open the request.

### Bug reports

**Report** (in the Insights toolbar or on a diagnostic) builds a reviewable bug report:

- editable title, summary and steps to reproduce;
- selectable sections (environment, diagnostics, errors, requests) and diagnostics;
- page URL without query values; environment (browser, viewport, language, time zone);
- diagnostics with evidence and hypotheses kept apart; grouped errors with count, timestamps and stack; related
  requests with status, duration and TTFB; and the medium/high-confidence relations between errors and requests.

Export as **Markdown**, **GitHub Issue** (long sections collapsible; **Open issue ↗** opens
`github.com/<owner/repo>/issues/new` prefilled; if the body is too long for the URL it is copied for you to paste) or
**JSON** (versioned structure). All captured text goes through masking, and the final text can be edited by hand
before copying or downloading.

Opened from a diagnostic, the report contains only that diagnostic's events; from the general button, it also
includes the other errors and failed requests. It uses the data from when it was opened (**Refresh data** rebuilds it).

### Assistant (optional, bring your own key)

A chat with an AI that receives a summary of what was captured (console errors and warnings, failed and slow
requests, totals, and Insights diagnostics). Ask things like "Summarize the logs" or "Recommend improvements".

- **Setup**: **⚙ → Assistant**, paste a DeepSeek API key and choose the model. The key is kept in
  `chrome.storage.local` and only the service worker uses it; it never goes through the page.
- **Investigate with AI**, from a Console error or warning (assistant icon), a request's details (**AI**) or an
  Insights diagnostic, starts a conversation focused on that item. The Assistant receives the item in detail (message
  and stack; or status, timing with TTFB, headers without credentials, initiator and masked excerpts of payload and
  response; or the diagnostic with evidence and hypotheses separated), related events with their confidence, and the
  diagnostics involving it, followed by a reduced page overview. Nothing is sent until you pick a quick action
  (Explain this error, What could be the cause?, How to fix it?, Analyze this request, Is there a performance
  problem?…) or type a question. The focus is saved with the conversation for follow-up questions.
- **Context** / **View context** shows the exact text that will be sent and how many values were masked.
- Answers use the chosen font and theme (including code colors), each code block has a copy button, and
  conversations are kept in the history (🕘, up to 50, searchable).

**What is sent, and how:**

- Headers, cookies, request bodies and query string values are not sent in the general overview. In focused mode,
  only a selection of headers without credentials and masked excerpts of that item's payload and response are added.
- In everything that is sent, tokens, JWTs, known API key formats, passwords and sensitive fields (`password`,
  `*_token`, `api_key`…), credentials in URLs, emails, CPFs and card numbers are replaced with `[REDACTED:kind]`
  before leaving the browser (`src/analysis/redact.ts`).
- Captured data goes in a delimited block in the user message, never in the system instructions, and the model is
  told to treat it as untrusted data (it comes from the page).
- Code suggested by the AI is never executed: code blocks only have "copy".

New OpenAI-compatible providers go in `src/shared/ai.ts`.

### Settings (⚙)

- **Language**: English or Português. The default, **System**, follows the browser/OS preferred language (Portuguese
  for `pt-*`, English otherwise) and tracks changes while the page is open. It applies to the whole interface, the
  Insights diagnostics (rebuilt on change, keeping dismissed ones), bug reports and the Assistant's answers. The
  extension's name, description and shortcut label follow the browser language (`public/_locales`).
- **Appearance**: translucent mode (blurred glass with adjustable opacity) and themes. Dark: Default, Dracula, Tokyo
  Night, Catppuccin, Gruvbox, Nord, Cyberpunk 2077, Evangelion, SynthWave '84. Light: Atom One Light, Ayu Light,
  White & Black, GitHub Light, Solarized Light, Gruvbox Light, Rosé Pine Dawn, Catppuccin Latte.
- **Font**: size (10–18px), weight (regular/medium/bold), bold errors and warnings, and 11 monospace fonts bundled
  with the extension (they work offline and on sites with a CSP), including Atkinson Hyperlegible Mono and Intel One
  Mono, designed for legibility and contrast, JetBrains Mono, Fira Code and IBM Plex Mono.

## How it works

| Part | File | Role |
| --- | --- | --- |
| Page hook (MAIN world, `document_start`) | `src/injected/main-world.ts` | intercepts `console.*`, errors, `fetch` and `XHR` (with the initiator stack) and uses `PerformanceObserver` for other resources; tags error objects produced by a request for correlation |
| Service worker | `src/background.ts` | `chrome.webRequest` fills in status, headers, IP and cache for static resources; toolbar icon and shortcut; AI provider calls (streaming) |
| Content script | `src/content/` | store with batched updates and the React UI inside a Shadow DOM (site CSS doesn't leak in) |
| Analysis | `src/analysis/` | pure, testable logic (no `chrome.*`): log fingerprinting and incremental grouping, diagnostics engine (`diagnostics/`, evaluated event by event), on-demand correlation (`correlate.ts`) and masking (`redact.ts`) |
| UI | `src/ui/` | button, panel, tabs |
| i18n | `src/i18n/` | locale resolution and typed message dictionaries |

## Extending

- **Diagnostic rule**: implement a `LogRule` or `RequestRule` in `src/analysis/diagnostics/rules/` (return `null` when
  it doesn't apply; put only facts in `evidence` and hypotheses in `causes`), register it in `rules/index.ts`, and add
  positive and negative cases to `rules.test.ts`. The rule's texts go in a `defineMessages` in the same file.
- **Theme**: add a palette to `src/ui/themes.ts` (`light: true` for light themes).
- **Font**: `npm i -D @fontsource/<name>` and an entry in `src/ui/fonts.ts`.
- **AI provider**: any OpenAI-compatible API, in `src/shared/ai.ts`.
- **Translations**: each module declares its texts with `defineMessages({ pt: {...}, en: {...} })` next to the code
  that uses them; messages with parameters are functions (`(n: number) => ...`). TypeScript requires the same keys
  and signatures in every language, so a missing translation is a compile error. Read the dictionary (`m()`) when the
  text is produced, never at module load; memoized components call `useLocale()` to re-render on change. To add a
  language, add it to `LOCALES`/`LOCALE_NAMES` and fill in the dictionaries the compiler points to. Tests run in
  Portuguese (`src/test/setup.ts`).

## Limitations (compared to the native DevTools)

- Response bodies are captured only for `fetch`/XHR (for images, CSS and JS, use "Open in new tab").
- WebSocket, iframes and service workers are not captured.
- Correlation only covers the tab's main frame. Errors from axios and other libraries that create a new error object
  have no identity link (they fall back to stack or time).
- The log is not preserved across navigations or reloads.
- Sites with a CSP without `unsafe-eval` block the console prompt (the error message says so).
- Logs emitted before the extension loaded (tabs opened before installation) don't show up: reload the tab.
