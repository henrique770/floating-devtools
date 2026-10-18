import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DevtoolsStore, Snapshot } from '../content/store';
import { AI_PORT, type AiRequest, type AiResponse, type ChatMessage } from '../shared/ai';
import { buildContext, SYSTEM_PROMPT } from './assistantContext';
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
} from './chatHistory';
import { isErrorEntry } from './format';
import { IconAssistant, IconHistory, IconPlus, IconSend, IconStop, IconTrash } from './Icons';
import { Markdown } from './Markdown';
import { activeProvider, useAiConfig } from './useAiConfig';

const MAX_HISTORY = 20;

type Message = ChatEntry;
type ConversationMeta = Pick<Conversation, 'id' | 'title' | 'host' | 'createdAt' | 'provider'>;

interface Props {
  store: DevtoolsStore;
  snap: Snapshot;
  active: boolean;
  onOpenSettings: () => void;
}

export function AssistantTab({ store, snap, active, onOpenSettings }: Props) {
  const [config] = useAiConfig();
  const current = activeProvider(config);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState<false | 'waiting' | 'thinking' | 'streaming'>(false);
  const [view, setView] = useState<'chat' | 'history'>('chat');
  const history = useChatHistory();
  const meta = useRef<ConversationMeta | null>(null);
  // Set when this tab changed the conversation, so merely opening one from the history doesn't re-save it.
  const dirty = useRef(false);
  const port = useRef<chrome.runtime.Port | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);

  const failed = useMemo(() => snap.requests.filter(isErrorEntry).length, [snap.requests]);

  const suggestions = useMemo(() => {
    const list = ['Resuma os logs'];
    if (snap.errors) list.push('Quais erros devo resolver primeiro?', 'Explique o último erro do console');
    if (failed) list.push('Por que essas requisições estão falhando?');
    list.push('Recomende melhorias', 'Existe algum problema de performance?');
    return list.slice(0, 5);
  }, [snap.errors, failed]);

  useLayoutEffect(() => {
    const el = listRef.current;
    if (el && active && stickToBottom.current) el.scrollTop = el.scrollHeight;
  }, [messages, busy, active, view]);

  useEffect(() => {
    if (active && current) inputRef.current?.focus();
  }, [active, current]);

  useEffect(() => () => port.current?.disconnect(), []);

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
    // The context is rebuilt on every question, so the answer reflects what was captured up to now.
    const payload: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n# Dados capturados agora\n${buildContext(store.getSnapshot())}` },
      ...thread.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content })),
    ];
    meta.current ??= { id: newConversationId(), title: titleFrom(question), host: location.host, createdAt: Date.now(), provider: current.provider.name };
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
    setView('chat');
    inputRef.current?.focus();
  };

  const open = (c: Conversation) => {
    leave();
    meta.current = { id: c.id, title: c.title, host: c.host, createdAt: c.createdAt, provider: c.provider };
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
        <button type="button" className="fdt-icon-btn" onClick={reset} title="Nova conversa" disabled={!messages.length && view === 'chat'}>
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
        <span className="ai-context" title="O que será enviado como contexto para a IA">
          Contexto: <b className={snap.errors ? 'is-error' : ''}>{snap.errors} erros</b> · <b className={snap.warnings ? 'is-warn' : ''}>{snap.warnings} avisos</b> ·{' '}
          <b className={failed ? 'is-error' : ''}>{failed} falhas</b> · {snap.requests.length} requisições
        </span>
        <button type="button" className="ai-provider" onClick={onOpenSettings} title="Configurar provider">
          {current ? `${current.provider.name} · ${current.settings.model}` : 'Sem provider'}
        </button>
      </div>

      {view === 'history' ? (
        <HistoryList list={history} currentId={meta.current?.id} onOpen={open} onDelete={remove} />
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
              <p>Olá! Eu vejo o que o DevTools capturou nesta página — erros, avisos e requisições. Pergunte o que quiser.</p>
              <p>Não sabe o que perguntar? Escolha uma das opções:</p>
              <div className="ai-suggestions">
                {suggestions.map((s) => (
                  <button key={s} type="button" className="ai-suggestion" onClick={() => send(s)}>
                    {s}
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

      <p className="ai-disclaimer">A IA pode cometer erros. Por isso, é importante checar as respostas.</p>
      <div className="ai-input">
        <textarea
          ref={inputRef}
          rows={Math.min(5, input.split('\n').length)}
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
