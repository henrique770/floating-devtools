import { useState } from 'react';
import { defineMessages, getLocale } from '../i18n';
import { AI_PORT, PROVIDERS, type AiRequest, type AiResponse, type ProviderInfo } from '../shared/ai';
import { useAiConfig } from './useAiConfig';

const m = defineMessages({
  pt: {
    reloaded: 'A extensão foi recarregada. Atualize a página.',
    unreachable: 'Não foi possível falar com a extensão.',
    title: 'Providers de IA',
    note: 'Traga sua própria API key. Ela fica salva só neste navegador e é usada direto pela extensão — nunca passa pela página. Ao perguntar, um resumo dos erros, avisos e requisições é enviado ao provider — sem headers, cookies, corpos de requisição ou valores de query string, e com tokens, chaves, senhas, e-mails, CPFs e cartões mascarados. Ao usar “Investigar com IA” em um item, vão também uma seleção de headers sem credenciais e trechos mascarados do payload e da resposta desse item. Você pode ver o texto exato em “Contexto” na aba Assistant.',
    inUse: 'Em uso',
    use: 'Usar no assistente',
    noKey: 'Sem chave',
    checking: 'Verificando…',
    save: 'Salvar',
    cancel: 'Cancelar',
    change: 'Trocar',
    remove: 'Remover',
    model: 'Modelo',
    getKey: (name: string) => `Obter uma API key da ${name} ↗`,
  },
  en: {
    reloaded: 'The extension was reloaded. Refresh the page.',
    unreachable: 'Could not reach the extension.',
    title: 'AI providers',
    note: 'Bring your own API key. It is stored only in this browser and used directly by the extension — it never goes through the page. When you ask, a summary of the errors, warnings and requests is sent to the provider — without headers, cookies, request bodies or query string values, and with tokens, keys, passwords, emails, CPFs and cards masked. When you use “Investigate with AI” on an item, a selection of headers without credentials and masked excerpts of that item’s payload and response are sent too. You can see the exact text under “Context” in the Assistant tab.',
    inUse: 'In use',
    use: 'Use in the assistant',
    noKey: 'No key',
    checking: 'Checking…',
    save: 'Save',
    cancel: 'Cancel',
    change: 'Change',
    remove: 'Remove',
    model: 'Model',
    getKey: (name) => `Get a ${name} API key ↗`,
  },
});

const mask = (key: string) => (key.length > 10 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '••••');

/** Asks the background to validate a key against the provider before saving it. */
function testKey(providerId: string, apiKey: string): Promise<string | null> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: AI_PORT });
    } catch {
      resolve(m().reloaded);
      return;
    }
    port.onMessage.addListener((msg: AiResponse) => {
      port.disconnect();
      resolve(msg.kind === 'error' ? msg.message : null);
    });
    port.onDisconnect.addListener(() => resolve(m().unreachable));
    port.postMessage({ kind: 'test', providerId, apiKey, locale: getLocale() } satisfies AiRequest);
  });
}

/** BYOK provider list shown in Settings > Assistente. */
export function ProviderSettings() {
  const [config, setConfig] = useAiConfig();
  const t = m();
  return (
    <>
      <h3>{t.title}</h3>
      <p className="settings-hint settings-note">{t.note}</p>
      <div className="provider-list">
        {PROVIDERS.map((p) => (
          <ProviderCard
            key={p.id}
            provider={p}
            apiKey={config.providers[p.id]?.apiKey ?? ''}
            model={config.providers[p.id]?.model ?? p.models[0].id}
            active={config.active === p.id}
            onChange={(patch) => {
              const prev = config.providers[p.id] ?? { apiKey: '', model: p.models[0].id };
              const next = { ...prev, ...patch };
              const providers = { ...config.providers, [p.id]: next };
              // Saving the first key makes that provider the active one.
              const active = next.apiKey ? (config.active && config.providers[config.active]?.apiKey ? config.active : p.id) : config.active === p.id ? undefined : config.active;
              setConfig({ active, providers });
            }}
            onActivate={() => setConfig({ ...config, active: p.id })}
          />
        ))}
      </div>
    </>
  );
}

interface CardProps {
  provider: ProviderInfo;
  apiKey: string;
  model: string;
  active: boolean;
  onChange: (patch: { apiKey?: string; model?: string }) => void;
  onActivate: () => void;
}

function ProviderCard({ provider, apiKey, model, active, onChange, onActivate }: CardProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState<{ checking?: boolean; error?: string }>({});

  const save = async () => {
    const key = draft.trim();
    if (!key) return;
    setStatus({ checking: true });
    const error = await testKey(provider.id, key);
    if (error) {
      setStatus({ error });
      return;
    }
    onChange({ apiKey: key });
    setDraft('');
    setEditing(false);
    setStatus({});
  };

  const showForm = editing || !apiKey;
  const t = m();

  return (
    <div className={`provider-card${active ? ' is-active' : ''}`}>
      <div className="provider-head">
        <span className="provider-name">{provider.name}</span>
        {apiKey ? (
          active ? (
            <span className="provider-badge is-on">{t.inUse}</span>
          ) : (
            <button type="button" className="provider-badge" onClick={onActivate}>
              {t.use}
            </button>
          )
        ) : (
          <span className="provider-badge">{t.noKey}</span>
        )}
      </div>

      {showForm ? (
        <form
          className="provider-form"
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input
            className="fdt-input"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={`API key (${provider.keyPlaceholder})`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label={`API key ${provider.name}`}
          />
          <button type="submit" className="provider-btn is-primary" disabled={!draft.trim() || status.checking}>
            {status.checking ? t.checking : t.save}
          </button>
          {apiKey && (
            <button type="button" className="provider-btn" onClick={() => (setEditing(false), setStatus({}))}>
              {t.cancel}
            </button>
          )}
        </form>
      ) : (
        <div className="provider-form">
          <code className="provider-key">{mask(apiKey)}</code>
          <button type="button" className="provider-btn" onClick={() => setEditing(true)}>
            {t.change}
          </button>
          <button type="button" className="provider-btn is-danger" onClick={() => onChange({ apiKey: '' })}>
            {t.remove}
          </button>
        </div>
      )}
      {status.error && <p className="provider-error">{status.error}</p>}

      <div className="settings-row">
        <span>{t.model}</span>
        <div className="segmented" role="radiogroup" aria-label={t.model}>
          {provider.models.map((x) => (
            <button key={x.id} type="button" role="radio" aria-checked={model === x.id} onClick={() => onChange({ model: x.id })} title={x.id}>
              {x.label}
            </button>
          ))}
        </div>
      </div>
      {!apiKey && (
        <a className="link-btn provider-link" href={provider.keyUrl} target="_blank" rel="noreferrer">
          {t.getKey(provider.name)}
        </a>
      )}
    </div>
  );
}
