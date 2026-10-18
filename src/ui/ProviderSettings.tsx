import { useState } from 'react';
import { AI_PORT, PROVIDERS, type AiRequest, type AiResponse, type ProviderInfo } from '../shared/ai';
import { useAiConfig } from './useAiConfig';

const mask = (key: string) => (key.length > 10 ? `${key.slice(0, 3)}…${key.slice(-4)}` : '••••');

/** Asks the background to validate a key against the provider before saving it. */
function testKey(providerId: string, apiKey: string): Promise<string | null> {
  return new Promise((resolve) => {
    let port: chrome.runtime.Port;
    try {
      port = chrome.runtime.connect({ name: AI_PORT });
    } catch {
      resolve('A extensão foi recarregada. Atualize a página.');
      return;
    }
    port.onMessage.addListener((msg: AiResponse) => {
      port.disconnect();
      resolve(msg.kind === 'error' ? msg.message : null);
    });
    port.onDisconnect.addListener(() => resolve('Não foi possível falar com a extensão.'));
    port.postMessage({ kind: 'test', providerId, apiKey } satisfies AiRequest);
  });
}

/** BYOK provider list shown in Settings > Assistente. */
export function ProviderSettings() {
  const [config, setConfig] = useAiConfig();
  return (
    <>
      <h3>Providers de IA</h3>
      <p className="settings-hint settings-note">
        Traga sua própria API key. Ela fica salva só neste navegador e é usada direto pela extensão — nunca passa pela página. Ao perguntar,
        um resumo dos erros, avisos e requisições (sem headers, cookies ou valores de query string) é enviado ao provider.
      </p>
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

  return (
    <div className={`provider-card${active ? ' is-active' : ''}`}>
      <div className="provider-head">
        <span className="provider-name">{provider.name}</span>
        {apiKey ? (
          active ? (
            <span className="provider-badge is-on">Em uso</span>
          ) : (
            <button type="button" className="provider-badge" onClick={onActivate}>
              Usar no assistente
            </button>
          )
        ) : (
          <span className="provider-badge">Sem chave</span>
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
            {status.checking ? 'Verificando…' : 'Salvar'}
          </button>
          {apiKey && (
            <button type="button" className="provider-btn" onClick={() => (setEditing(false), setStatus({}))}>
              Cancelar
            </button>
          )}
        </form>
      ) : (
        <div className="provider-form">
          <code className="provider-key">{mask(apiKey)}</code>
          <button type="button" className="provider-btn" onClick={() => setEditing(true)}>
            Trocar
          </button>
          <button type="button" className="provider-btn is-danger" onClick={() => onChange({ apiKey: '' })}>
            Remover
          </button>
        </div>
      )}
      {status.error && <p className="provider-error">{status.error}</p>}

      <div className="settings-row">
        <span>Modelo</span>
        <div className="segmented" role="radiogroup" aria-label="Modelo">
          {provider.models.map((m) => (
            <button key={m.id} type="button" role="radio" aria-checked={model === m.id} onClick={() => onChange({ model: m.id })} title={m.id}>
              {m.label}
            </button>
          ))}
        </div>
      </div>
      {!apiKey && (
        <a className="link-btn provider-link" href={provider.keyUrl} target="_blank" rel="noreferrer">
          Obter uma API key da {provider.name} ↗
        </a>
      )}
    </div>
  );
}
