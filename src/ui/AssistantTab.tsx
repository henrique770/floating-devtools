import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DevtoolsStore, Snapshot } from '../content/store';
import { AI_PORT, type AiRequest, type AiResponse } from '../shared/ai';
import { describeRedactions } from '../analysis/redact';
import { defineMessages, getLocale, plural } from '../i18n';
import { buildContext, buildPayload, OVERVIEW_WITH_FOCUS } from './assistantContext';
import {
  clearHistory,
  deleteConversation,
  newConversationId,
  relativeTime,
  saveConversation,
  titleFrom,
  useChatHistory,
  type ChatEntry,
  type Conversation,
  type SavedFocus,
} from './chatHistory';
import { buildFocusContext, quickActions, type FocusContext, type FocusTarget } from './focusContext';
import { isErrorEntry } from './format';
import { IconAssistant, IconHistory, IconPlus, IconSend, IconStop, IconTrash } from './Icons';
import { Markdown } from './Markdown';
import { activeProvider, useAiConfig } from './useAiConfig';
import { useLocale } from './useLocale';

const MAX_HISTORY = 20;

type Message = ChatEntry;
type ConversationMeta = Pick<Conversation, 'id' | 'title' | 'host' | 'createdAt' | 'provider' | 'focus'>;
/** Focus as used by the tab: freshly built (with masking stats) or restored from history. */
type Focus = SavedFocus & { redactions?: FocusContext['redactions'] };

const m = defineMessages({
  pt: {
    kind: { log: 'Log', request: 'Requisição', diagnostic: 'Diagnóstico' } as Record<FocusTarget['kind'], string>,
    gone: 'Esse item não está mais capturado (saiu do buffer ou foi limpo).',
    reloaded: 'A extensão foi recarregada. Atualize a página para usar o assistente.',
    newChat: 'Nova conversa',
    history: 'Histórico de conversas',
    contextTitle: 'Ver exatamente o que será enviado como contexto para a IA',
    context: 'Contexto:',
    errors: (n: number) => plural(n, 'erro', 'erros'),
    warnings: (n: number) => plural(n, 'aviso', 'avisos'),
    failures: (n: number) => plural(n, 'falha', 'falhas'),
    requests: (n: number) => plural(n, 'requisição', 'requisições'),
    configure: 'Configurar provider',
    noProvider: 'Sem provider',
    connect: 'Conecte um provider de IA para perguntar sobre os erros, avisos e requisições desta página.',
    byok: 'Você usa a sua própria API key (BYOK). Ela fica salva apenas neste navegador.',
    addProvider: 'Adicionar provider',
    focusIntro: (kind: FocusTarget['kind']) =>
      `Vou analisar ${kind === 'request' ? 'esta requisição' : kind === 'log' ? 'este erro' : 'este diagnóstico'} com os eventos relacionados. Nada foi enviado ainda: escolha uma pergunta ou escreva a sua.`,
    reviewContext: 'Você pode revisar o contexto exato em “Ver contexto”.',
    hello: 'Olá! Eu vejo o que o DevTools capturou nesta página — erros, avisos, requisições e os diagnósticos do Insights. Pergunte o que quiser.',
    pick: 'Não sabe o que perguntar? Escolha uma das opções:',
    thinking: 'Pensando…',
    analyzing: 'Analisando os logs…',
    viewContext: 'Ver contexto',
    focusLocked: 'O foco faz parte desta conversa; comece uma nova para trocar',
    removeFocus: 'Remover o foco',
    quickActions: 'Ações rápidas',
    disclaimer: 'A IA pode cometer erros. Por isso, é importante checar as respostas.',
    ask: 'Faça uma pergunta…',
    setup: 'Configure um provider para começar',
    stop: 'Parar',
    send: 'Enviar (Enter)',
    sentNote: 'Este texto é enviado ao provider junto com cada pergunta (a visão geral é recalculada no envio). Valores de query string e cookies nunca são incluídos.',
    focusNote: 'Do item em foco entram também uma seleção de headers sem credenciais e trechos do payload e da resposta, já mascarados.',
    noBodies: 'Headers e corpos de requisição não são incluídos.',
    masked: (n: number) => (n === 1 ? '1 valor mascarado' : `${n} valores mascarados`),
    noneMasked: 'Nenhum valor sensível detectado no que será enviado.',
    review: 'A detecção é automática e pode não reconhecer todo dado sensível: revise antes de perguntar.',
    back: 'Voltar para a conversa',
    focusHeading: (title: string) => `Item em foco: ${title}`,
    overview: 'Visão geral da página',
    search: 'Buscar nas conversas',
    questions: (n: number) => (n === 1 ? '1 pergunta' : `${n} perguntas`),
    deleteChat: 'Apagar conversa',
    notFound: 'Nenhuma conversa encontrada.',
    noneSaved: 'Nenhuma conversa salva ainda.',
    confirmClear: 'Apagar todo o histórico de conversas?',
    clearHistory: 'Limpar histórico',
  },
  en: {
    kind: { log: 'Log', request: 'Request', diagnostic: 'Diagnostic' },
    gone: 'This item is no longer captured (it left the buffer or was cleared).',
    reloaded: 'The extension was reloaded. Refresh the page to use the assistant.',
    newChat: 'New conversation',
    history: 'Conversation history',
    contextTitle: 'See exactly what will be sent to the AI as context',
    context: 'Context:',
    errors: (n) => plural(n, 'error', 'errors'),
    warnings: (n) => plural(n, 'warning', 'warnings'),
    failures: (n) => plural(n, 'failure', 'failures'),
    requests: (n) => plural(n, 'request', 'requests'),
    configure: 'Configure provider',
    noProvider: 'No provider',
    connect: 'Connect an AI provider to ask about the errors, warnings and requests on this page.',
    byok: 'You use your own API key (BYOK). It is stored only in this browser.',
    addProvider: 'Add provider',
    focusIntro: (kind) =>
      `I will analyze ${kind === 'request' ? 'this request' : kind === 'log' ? 'this error' : 'this diagnostic'} together with its related events. Nothing was sent yet: pick a question or write your own.`,
    reviewContext: 'You can review the exact context in “View context”.',
    hello: 'Hi! I can see what the DevTools captured on this page — errors, warnings, requests and the Insights diagnostics. Ask anything.',
    pick: "Not sure what to ask? Pick one of these:",
    thinking: 'Thinking…',
    analyzing: 'Analyzing the logs…',
    viewContext: 'View context',
    focusLocked: 'The focus is part of this conversation; start a new one to change it',
    removeFocus: 'Remove focus',
    quickActions: 'Quick actions',
    disclaimer: 'AI can make mistakes. Check the answers.',
    ask: 'Ask a question…',
    setup: 'Configure a provider to start',
    stop: 'Stop',
    send: 'Send (Enter)',
    sentNote: 'This text is sent to the provider with every question (the overview is recomputed on send). Query string values and cookies are never included.',
    focusNote: 'For the item in focus, a selection of headers without credentials and excerpts of the payload and response are also included, already masked.',
    noBodies: 'Request headers and bodies are not included.',
    masked: (n) => (n === 1 ? '1 value masked' : `${n} values masked`),
    noneMasked: 'No sensitive values detected in what will be sent.',
    review: 'Detection is automatic and may miss some sensitive data: review before asking.',
    back: 'Back to the conversation',
    focusHeading: (title) => `Item in focus: ${title}`,
    overview: 'Page overview',
    search: 'Search conversations',
    questions: (n) => (n === 1 ? '1 question' : `${n} questions`),
    deleteChat: 'Delete conversation',
    notFound: 'No conversation found.',
    noneSaved: 'No saved conversations yet.',
    confirmClear: 'Delete the whole conversation history?',
    clearHistory: 'Clear history',
  },
});

interface Props {
  store: DevtoolsStore;
  snap: Snapshot;
  active: boolean;
  onOpenSettings: () => void;
  /** Item chosen with "Investigar com IA": starts a conversation focused on it. Nothing is sent until the user asks. */
  investigate?: { target: FocusTarget; nonce: number };
}

export function AssistantTab({ store, snap, active, onOpenSettings, investigate }: Props) {
  const [config] = useAiConfig();
  const current = activeProvider(config);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'waiting' | 'thinking' | 'streaming'>(false);
  const [view, setView] = useState<'chat' | 'history' | 'context'>('chat');
  const [focus, setFocus] = useState<Focus | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const history = useChatHistory();
  const meta = useRef<ConversationMeta | null>(null);
  // Set when this tab changed the conversation, so merely opening one from the history doesn't re-save it.
  const dirty = useRef(false);
  const port = useRef<chrome.runtime.Port | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  const failed = useMemo(() => snap.requests.filter(isErrorEntry).length, [snap.requests]);
  const locale = useLocale();
  const t = m();

  const actions = useMemo(
    () => quickActions(focus ? { ...focus, redactions: focus.redactions ?? { found: {}, total: 0 } } : null, snap),
    [focus, snap, locale],
  );

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && active && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy, active, view]);

  // Focus the input only when the tab becomes visible (tab click or panel opened), never on re-renders,
  // and never while the user is typing in a field of the page itself.
  useEffect(() => {
    if (active && !isTypingInPage()) inputRef.current?.focus({ preventScroll: true });
  }, [active]);

  useEffect(() => () => port.current?.disconnect(), []);

  // "Investigar com IA": a new conversation about that item. The context is built now, from what is captured.
  useEffect(() => {
    if (!investigate) return;
    leave();
    meta.current = null;
    setMessages([]);
    setView('chat');
    const ctx = buildFocusContext(investigate.target, store.getSnapshot());
    setFocus(ctx);
    setNotice(ctx ? null : m().gone);
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
    // Only on a new request; leave() reads the current conversation through refs/state at that moment.
  }, [investigate]);

  // Persist once the answer is complete (not on every streamed token).
  useEffect(() => {
    if (busy || !dirty.current || !meta.current || !messages.length) return;
    dirty.current = false;
    saveConversation({ ...meta.current, updatedAt: Date.now(), messages });
  }, [busy, messages]);

  const stop = () => {
    port.current?.disconnect();
    port.current = null;
    setBusy(false);
  };

  const send = (text: string) => {
    const question = text.trim();
    if (!question || busy || !current) return;
    const thread: Message[] = [...messages.filter((msg) => !msg.error), { role: 'user', content: question }];
    // The page overview is rebuilt on every question; the focus block stays as it was when the item was chosen.
    const overview = buildContext(store.getSnapshot(), focus ? OVERVIEW_WITH_FOCUS : undefined).text;
    const payload = buildPayload(thread.slice(-MAX_HISTORY), overview, focus ?? undefined);
    meta.current ??= {
      id: newConversationId(),
      title: titleFrom(focus ? `${focus.title} — ${question}` : question),
      host: location.host,
      createdAt: Date.now(),
      provider: current.provider.name,
      focus: focus ? { target: focus.target, title: focus.title, text: focus.text } : undefined,
    };
    setNotice(null);
    dirty.current = true;
    setView('chat');
    setMessages([...messages, { role: 'user', content: question }]);
    setInput('');
    setBusy('waiting');
    stickToBottom.current = true;

    let p: chrome.runtime.Port;
    try {
      p = chrome.runtime.connect({ name: AI_PORT });
    } catch {
      setMessages((prev) => [...prev, { role: 'assistant', content: m().reloaded, error: true }]);
      setBusy(false);
      return;
    }
    port.current = p;
    let started = false;
    p.onMessage.addListener((msg: AiResponse) => {
      if (msg.kind === 'thinking') setBusy('thinking');
      else if (msg.kind === 'delta') {
        setBusy('streaming');
        if (!started) {
          started = true;
          setMessages((prev) => [...prev, { role: 'assistant', content: msg.text }]);
        } else {
          setMessages((prev) => [...prev.slice(0, -1), { ...prev[prev.length - 1], content: prev[prev.length - 1].content + msg.text }]);
        }
      } else {
        if (msg.kind === 'error') setMessages((prev) => [...prev, { role: 'assistant', content: msg.message, error: true }]);
        p.disconnect();
        if (port.current === p) port.current = null;
        setBusy(false);
      }
    });
    p.onDisconnect.addListener(() => {
      if (port.current !== p) return;
      port.current = null;
      setBusy(false);
    });
    p.postMessage({ kind: 'chat', messages: payload, locale: getLocale() } satisfies AiRequest);
  };

  /** Saves a conversation that is being left mid-answer, before switching away from it. */
  const leave = () => {
    stop();
    if (dirty.current && meta.current && messages.length) saveConversation({ ...meta.current, updatedAt: Date.now(), messages });
    dirty.current = false;
  };

  const reset = () => {
    leave();
    meta.current = null;
    setMessages([]);
    setFocus(null);
    setNotice(null);
    setView('chat');
    inputRef.current?.focus();
  };

  const open = (c: Conversation) => {
    leave();
    meta.current = { id: c.id, title: c.title, host: c.host, createdAt: c.createdAt, provider: c.provider, focus: c.focus };
    setFocus(c.focus ?? null);
    setNotice(null);
    dirty.current = false;
    stickToBottom.current = true;
    setMessages(c.messages);
    setView('chat');
  };

  const remove = (id: string) => {
    deleteConversation(id);
    if (meta.current?.id === id) reset();
  };

  return (
    <div className="ai">
      <div className="toolbar">
        <button type="button" className="fdt-icon-btn" onClick={reset} title={t.newChat} disabled={!messages.length && !focus && view === 'chat'}>
          <IconPlus />
        </button>
        <button
          type="button"
          className={`fdt-icon-btn${view === 'history' ? ' is-active' : ''}`}
          onClick={() => setView(view === 'history' ? 'chat' : 'history')}
          title={t.history}
        >
          <IconHistory />
        </button>
        <button
          type="button"
          className={`ai-context${view === 'context' ? ' is-active' : ''}`}
          onClick={() => setView(view === 'context' ? 'chat' : 'context')}
          aria-pressed={view === 'context'}
          title={t.contextTitle}
        >
          {t.context} <b className={snap.errors ? 'is-error' : ''}>{t.errors(snap.errors)}</b> ·{' '}
          <b className={snap.warnings ? 'is-warn' : ''}>{t.warnings(snap.warnings)}</b> · <b className={failed ? 'is-error' : ''}>{t.failures(failed)}</b> ·{' '}
          {t.requests(snap.requests.length)}
        </button>
        <button type="button" className="ai-provider" onClick={onOpenSettings} title={t.configure}>
          {current ? `${current.provider.name} · ${current.settings.model}` : t.noProvider}
        </button>
      </div>

      {view === 'history' ? (
        <HistoryList list={history} currentId={meta.current?.id} onOpen={open} onDelete={remove} />
      ) : view === 'context' ? (
        <ContextPreview snap={snap} focus={focus} onClose={() => setView('chat')} />
      ) : (
        <div
          className="ai-list"
          ref={listRef}
          onScroll={(e) => {
            const el = e.currentTarget;
            stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
        >
          {!current ? (
            <div className="ai-welcome">
              <IconAssistant size={36} className="ai-sparkle" />
              <p>{t.connect}</p>
              <p className="muted">{t.byok}</p>
              <button type="button" className="ai-cta" onClick={onOpenSettings}>
                {t.addProvider}
              </button>
            </div>
          ) : !messages.length ? (
            <div className="ai-welcome">
              <IconAssistant size={36} className="ai-sparkle" />
              {notice && <p className="ai-notice">{notice}</p>}
              {focus ? (
                <>
                  <p>{t.focusIntro(focus.target.kind)}</p>
                  <p className="muted">{t.reviewContext}</p>
                </>
              ) : (
                <>
                  <p>{t.hello}</p>
                  <p>{t.pick}</p>
                </>
              )}
              <div className="ai-suggestions">
                {actions.map((a) => (
                  <button key={a.label} type="button" className="ai-suggestion" onClick={() => send(a.question)} title={a.question}>
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) =>
              msg.role === 'user' ? (
                <div key={i} className="ai-msg is-user">
                  {msg.content}
                </div>
              ) : (
                <div key={i} className={`ai-msg is-assistant${msg.error ? ' is-error' : ''}`}>
                  {msg.error ? msg.content : <Markdown text={msg.content} />}
                </div>
              ),
            )
          )}
          {(busy === 'waiting' || busy === 'thinking') && (
            <div className="ai-msg is-assistant ai-typing">
              <span className="ai-dots">
                <i />
                <i />
                <i />
              </span>
              {busy === 'thinking' ? t.thinking : t.analyzing}
            </div>
          )}
        </div>
      )}

      {focus && view === 'chat' && (
        <div className="ai-focus">
          <div className="ai-focus-head">
            <span className="ai-focus-kind">{t.kind[focus.target.kind]}</span>
            <span className="ai-focus-title" title={focus.title}>
              {focus.title}
            </span>
            <button type="button" className="link-btn" onClick={() => setView('context')}>
              {t.viewContext}
            </button>
            <button
              type="button"
              className="fdt-icon-btn ai-focus-clear"
              onClick={() => setFocus(null)}
              disabled={!!messages.length}
              title={messages.length ? t.focusLocked : t.removeFocus}
              aria-label={t.removeFocus}
            >
              ×
            </button>
          </div>
          {messages.length > 0 && !busy && (
            <div className="ai-quick" role="group" aria-label={t.quickActions}>
              {actions.map((a) => (
                <button key={a.label} type="button" className="ai-suggestion" onClick={() => send(a.question)} title={a.question}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="ai-disclaimer">{t.disclaimer}</p>
      <div className="ai-input">
        <textarea
          ref={inputRef}
          rows={Math.min(8, input.split('\n').length)}
          value={input}
          disabled={!current}
          placeholder={current ? t.ask : t.setup}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="ai-send" onClick={stop} title={t.stop}>
            <IconStop />
          </button>
        ) : (
          <button type="button" className="ai-send" onClick={() => send(input)} disabled={!current || !input.trim()} title={t.send}>
            <IconSend />
          </button>
        )}
      </div>
    </div>
  );
}

/** The exact context text the next question will carry, after masking. */
function ContextPreview({ snap, focus, onClose }: { snap: Snapshot; focus: Focus | null; onClose: () => void }) {
  const locale = useLocale();
  const t = m();
  const context = useMemo(() => buildContext(snap, focus ? OVERVIEW_WITH_FOCUS : undefined), [snap, focus, locale]);
  const total = context.redactions.total + (focus?.redactions?.total ?? 0);
  const found = { ...context.redactions.found };
  for (const [k, n] of Object.entries(focus?.redactions?.found ?? {}) as [keyof typeof found, number][]) found[k] = (found[k] ?? 0) + n;
  return (
    <div className="ai-context-view">
      <div className="ai-context-note">
        <p>
          {t.sentNote} {focus ? t.focusNote : t.noBodies}
        </p>
        <p>
          {total ? (
            <>
              <b>{t.masked(total)}</b>: {describeRedactions(found)}.
            </>
          ) : (
            t.noneMasked
          )}{' '}
          {t.review}
        </p>
        <button type="button" className="link-btn" onClick={onClose}>
          {t.back}
        </button>
      </div>
      {focus && (
        <>
          <h4 className="ai-context-heading">{t.focusHeading(focus.title)}</h4>
          <pre className="code-block ai-context-text">{focus.text}</pre>
          <h4 className="ai-context-heading">{t.overview}</h4>
        </>
      )}
      <pre className="code-block ai-context-text">{context.text}</pre>
    </div>
  );
}

interface HistoryProps {
  list: Conversation[];
  currentId?: string;
  onOpen: (c: Conversation) => void;
  onDelete: (id: string) => void;
}

function HistoryList({ list, currentId, onOpen, onDelete }: HistoryProps) {
  const [query, setQuery] = useState('');
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((c) => c.title.toLowerCase().includes(q) || c.host.includes(q) || c.messages.some((msg) => msg.content.toLowerCase().includes(q)));
  }, [list, query]);

  const t = m();
  return (
    <div className="ai-history">
      <div className="ai-history-search">
        <input className="fdt-input" placeholder={t.search} value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      </div>
      <div className="ai-history-list">
        {visible.map((c) => (
          <div key={c.id} className={`ai-history-item${c.id === currentId ? ' is-current' : ''}`}>
            <button type="button" className="ai-history-open" onClick={() => onOpen(c)}>
              <span className="ai-history-title">{c.title}</span>
              <span className="ai-history-meta">
                {c.host} · {relativeTime(c.updatedAt)} · {t.questions(c.messages.filter((msg) => msg.role === 'user').length)}
              </span>
            </button>
            <button type="button" className="fdt-icon-btn ai-history-delete" onClick={() => onDelete(c.id)} title={t.deleteChat}>
              <IconTrash />
            </button>
          </div>
        ))}
        {!visible.length && <div className="empty">{list.length ? t.notFound : t.noneSaved}</div>}
      </div>
      {list.length > 0 && (
        <button
          type="button"
          className="link-btn ai-history-clear"
          onClick={() => window.confirm(t.confirmClear) && clearHistory()}
        >
          {t.clearHistory}
        </button>
      )}
    </div>
  );
}

/** True when focus is in an editable element of the page (our UI lives in a shadow root, so it is never the page's activeElement). */
function isTypingInPage() {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el.tagName === 'FLOATING-DEVTOOLS') return false;
  return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT';
}
