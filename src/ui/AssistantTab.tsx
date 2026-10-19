import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DevtoolsStore, Snapshot } from '../content/store';
import { AI_PORT, type AiRequest, type AiResponse } from '../shared/ai';
import { describeRedactions } from '../analysis/redact';
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

const MAX_HISTORY = 20;

type Message = ChatEntry;
type ConversationMeta = Pick<Conversation, 'id' | 'title' | 'host' | 'createdAt' | 'provider' | 'focus'>;
/** Focus as used by the tab: freshly built (with masking stats) or restored from history. */
type Focus = SavedFocus & { redactions?: FocusContext['redactions'] };

const FOCUS_KIND: Record<FocusTarget['kind'], string> = { log: 'Log', request: 'Requisição', diagnostic: 'Diagnóstico' };

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

  const actions = useMemo(() => quickActions(focus ? { ...focus, redactions: focus.redactions ?? { found: {}, total: 0 } } : null, snap), [focus, snap]);

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
    setNotice(ctx ? null : 'Esse item não está mais capturado (saiu do buffer ou foi limpo).');
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
    const thread: Message[] = [...messages.filter((m) => !m.error), { role: 'user', content: question }];
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
      setMessages((m) => [...m, { role: 'assistant', content: 'A extensão foi recarregada. Atualize a página para usar o assistente.', error: true }]);
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
          setMessages((m) => [...m, { role: 'assistant', content: msg.text }]);
        } else {
          setMessages((m) => [...m.slice(0, -1), { ...m[m.length - 1], content: m[m.length - 1].content + msg.text }]);
        }
      } else {
        if (msg.kind === 'error') setMessages((m) => [...m, { role: 'assistant', content: msg.message, error: true }]);
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
    p.postMessage({ kind: 'chat', messages: payload } satisfies AiRequest);
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
        <button type="button" className="fdt-icon-btn" onClick={reset} title="Nova conversa" disabled={!messages.length && !focus && view === 'chat'}>
          <IconPlus />
        </button>
        <button
          type="button"
          className={`fdt-icon-btn${view === 'history' ? ' is-active' : ''}`}
          onClick={() => setView(view === 'history' ? 'chat' : 'history')}
          title="Histórico de conversas"
        >
          <IconHistory />
        </button>
        <button
          type="button"
          className={`ai-context${view === 'context' ? ' is-active' : ''}`}
          onClick={() => setView(view === 'context' ? 'chat' : 'context')}
          aria-pressed={view === 'context'}
          title="Ver exatamente o que será enviado como contexto para a IA"
        >
          Contexto: <b className={snap.errors ? 'is-error' : ''}>{snap.errors} erros</b> · <b className={snap.warnings ? 'is-warn' : ''}>{snap.warnings} avisos</b> ·{' '}
          <b className={failed ? 'is-error' : ''}>{failed} falhas</b> · {snap.requests.length} requisições
        </button>
        <button type="button" className="ai-provider" onClick={onOpenSettings} title="Configurar provider">
          {current ? `${current.provider.name} · ${current.settings.model}` : 'Sem provider'}
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
              <p>Conecte um provider de IA para perguntar sobre os erros, avisos e requisições desta página.</p>
              <p className="muted">Você usa a sua própria API key (BYOK). Ela fica salva apenas neste navegador.</p>
              <button type="button" className="ai-cta" onClick={onOpenSettings}>
                Adicionar provider
              </button>
            </div>
          ) : !messages.length ? (
            <div className="ai-welcome">
              <IconAssistant size={36} className="ai-sparkle" />
              {notice && <p className="ai-notice">{notice}</p>}
              {focus ? (
                <>
                  <p>
                    Vou analisar {focus.target.kind === 'request' ? 'esta requisição' : focus.target.kind === 'log' ? 'este erro' : 'este diagnóstico'} com os
                    eventos relacionados. Nada foi enviado ainda: escolha uma pergunta ou escreva a sua.
                  </p>
                  <p className="muted">Você pode revisar o contexto exato em “Ver contexto”.</p>
                </>
              ) : (
                <>
                  <p>Olá! Eu vejo o que o DevTools capturou nesta página — erros, avisos, requisições e os diagnósticos do Insights. Pergunte o que quiser.</p>
                  <p>Não sabe o que perguntar? Escolha uma das opções:</p>
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
            messages.map((m, i) =>
              m.role === 'user' ? (
                <div key={i} className="ai-msg is-user">
                  {m.content}
                </div>
              ) : (
                <div key={i} className={`ai-msg is-assistant${m.error ? ' is-error' : ''}`}>
                  {m.error ? m.content : <Markdown text={m.content} />}
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
              {busy === 'thinking' ? 'Pensando…' : 'Analisando os logs…'}
            </div>
          )}
        </div>
      )}

      {focus && view === 'chat' && (
        <div className="ai-focus">
          <div className="ai-focus-head">
            <span className="ai-focus-kind">{FOCUS_KIND[focus.target.kind]}</span>
            <span className="ai-focus-title" title={focus.title}>
              {focus.title}
            </span>
            <button type="button" className="link-btn" onClick={() => setView('context')}>
              Ver contexto
            </button>
            <button
              type="button"
              className="fdt-icon-btn ai-focus-clear"
              onClick={() => setFocus(null)}
              disabled={!!messages.length}
              title={messages.length ? 'O foco faz parte desta conversa; comece uma nova para trocar' : 'Remover o foco'}
              aria-label="Remover o foco"
            >
              ×
            </button>
          </div>
          {messages.length > 0 && !busy && (
            <div className="ai-quick" role="group" aria-label="Ações rápidas">
              {actions.map((a) => (
                <button key={a.label} type="button" className="ai-suggestion" onClick={() => send(a.question)} title={a.question}>
                  {a.label}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      <p className="ai-disclaimer">A IA pode cometer erros. Por isso, é importante checar as respostas.</p>
      <div className="ai-input">
        <textarea
          ref={inputRef}
          rows={Math.min(8, input.split('\n').length)}
          value={input}
          disabled={!current}
          placeholder={current ? 'Faça uma pergunta…' : 'Configure um provider para começar'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              send(input);
            }
          }}
        />
        {busy ? (
          <button type="button" className="ai-send" onClick={stop} title="Parar">
            <IconStop />
          </button>
        ) : (
          <button type="button" className="ai-send" onClick={() => send(input)} disabled={!current || !input.trim()} title="Enviar (Enter)">
            <IconSend />
          </button>
        )}
      </div>
    </div>
  );
}

/** The exact context text the next question will carry, after masking. */
function ContextPreview({ snap, focus, onClose }: { snap: Snapshot; focus: Focus | null; onClose: () => void }) {
  const context = useMemo(() => buildContext(snap, focus ? OVERVIEW_WITH_FOCUS : undefined), [snap, focus]);
  const total = context.redactions.total + (focus?.redactions?.total ?? 0);
  const found = { ...context.redactions.found };
  for (const [k, n] of Object.entries(focus?.redactions?.found ?? {}) as [keyof typeof found, number][]) found[k] = (found[k] ?? 0) + n;
  return (
    <div className="ai-context-view">
      <div className="ai-context-note">
        <p>
          Este texto é enviado ao provider junto com cada pergunta (a visão geral é recalculada no envio). Valores de query string e cookies nunca
          são incluídos.{' '}
          {focus
            ? 'Do item em foco entram também uma seleção de headers sem credenciais e trechos do payload e da resposta, já mascarados.'
            : 'Headers e corpos de requisição não são incluídos.'}
        </p>
        <p>
          {total ? (
            <>
              <b>{total} {total === 1 ? 'valor mascarado' : 'valores mascarados'}</b>: {describeRedactions(found)}.
            </>
          ) : (
            'Nenhum valor sensível detectado no que será enviado.'
          )}{' '}
          A detecção é automática e pode não reconhecer todo dado sensível: revise antes de perguntar.
        </p>
        <button type="button" className="link-btn" onClick={onClose}>
          Voltar para a conversa
        </button>
      </div>
      {focus && (
        <>
          <h4 className="ai-context-heading">Item em foco: {focus.title}</h4>
          <pre className="code-block ai-context-text">{focus.text}</pre>
          <h4 className="ai-context-heading">Visão geral da página</h4>
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
    return list.filter((c) => c.title.toLowerCase().includes(q) || c.host.includes(q) || c.messages.some((m) => m.content.toLowerCase().includes(q)));
  }, [list, query]);

  return (
    <div className="ai-history">
      <div className="ai-history-search">
        <input className="fdt-input" placeholder="Buscar nas conversas" value={query} onChange={(e) => setQuery(e.target.value)} spellCheck={false} />
      </div>
      <div className="ai-history-list">
        {visible.map((c) => (
          <div key={c.id} className={`ai-history-item${c.id === currentId ? ' is-current' : ''}`}>
            <button type="button" className="ai-history-open" onClick={() => onOpen(c)}>
              <span className="ai-history-title">{c.title}</span>
              <span className="ai-history-meta">
                {c.host} · {relativeTime(c.updatedAt)} · {c.messages.filter((m) => m.role === 'user').length} perguntas
              </span>
            </button>
            <button type="button" className="fdt-icon-btn ai-history-delete" onClick={() => onDelete(c.id)} title="Apagar conversa">
              <IconTrash />
            </button>
          </div>
        ))}
        {!visible.length && <div className="empty">{list.length ? 'Nenhuma conversa encontrada.' : 'Nenhuma conversa salva ainda.'}</div>}
      </div>
      {list.length > 0 && (
        <button
          type="button"
          className="link-btn ai-history-clear"
          onClick={() => window.confirm('Apagar todo o histórico de conversas?') && clearHistory()}
        >
          Limpar histórico
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
