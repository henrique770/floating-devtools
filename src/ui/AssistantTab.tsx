import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DevtoolsStore, Snapshot } from '../content/store';
import { AI_PORT, type AiRequest, type AiResponse, type ChatMessage } from '../shared/ai';
import { buildContext, SYSTEM_PROMPT } from './assistantContext';
import { isErrorEntry } from './format';
import { IconClear, IconSend, IconSparkle, IconStop } from './Icons';
import { Markdown } from './Markdown';
import { activeProvider, useAiConfig } from './useAiConfig';

const MAX_HISTORY = 20;

type Message = { role: 'user' | 'assistant'; content: string; error?: boolean };

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
  }, [messages, busy, active]);

  useEffect(() => {
    if (active && current) inputRef.current?.focus();
  }, [active, current]);

  useEffect(() => () => port.current?.disconnect(), []);

  const stop = () => {
    port.current?.disconnect();
    port.current = null;
    setBusy(false);
  };

  const send = (text: string) => {
    const question = text.trim();
    if (!question || busy || !current) return;
    const history: Message[] = [...messages.filter((m) => !m.error), { role: 'user', content: question }];
    // The context is rebuilt on every question, so the answer reflects what was captured up to now.
    const payload: ChatMessage[] = [
      { role: 'system', content: `${SYSTEM_PROMPT}\n\n# Dados capturados agora\n${buildContext(store.getSnapshot())}` },
      ...history.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content })),
    ];
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

  const reset = () => {
    stop();
    setMessages([]);
  };

  return (
    <div className="ai">
      <div className="toolbar">
        <button type="button" className="fdt-icon-btn" onClick={reset} title="Nova conversa" disabled={!messages.length}>
          <IconClear />
        </button>
        <span className="ai-context" title="O que será enviado como contexto para a IA">
          Contexto: <b className={snap.errors ? 'is-error' : ''}>{snap.errors} erros</b> · <b className={snap.warnings ? 'is-warn' : ''}>{snap.warnings} avisos</b> ·{' '}
          <b className={failed ? 'is-error' : ''}>{failed} falhas</b> · {snap.requests.length} requisições
        </span>
        <button type="button" className="ai-provider" onClick={onOpenSettings} title="Configurar provider">
          {current ? `${current.provider.name} · ${current.settings.model}` : 'Sem provider'}
        </button>
      </div>

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
            <IconSparkle width={22} height={22} className="ai-sparkle" />
            <p>Conecte um provider de IA para perguntar sobre os erros, avisos e requisições desta página.</p>
            <p className="muted">Você usa a sua própria API key (BYOK). Ela fica salva apenas neste navegador.</p>
            <button type="button" className="ai-cta" onClick={onOpenSettings}>
              Adicionar provider
            </button>
          </div>
        ) : !messages.length ? (
          <div className="ai-welcome">
            <IconSparkle width={22} height={22} className="ai-sparkle" />
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
