import { useMemo, useState } from 'react';
import { describeRedactions } from '../analysis/redact';
import type { DevtoolsStore, Snapshot } from '../content/store';
import { buildReport, defaultDiagnostics, githubIssueUrl, toGitHubIssue, toJson, toMarkdown } from './bugReport';
import { copyText } from './format';
import { IconBack, IconCopy } from './Icons';
import { SEVERITY_LABEL } from './labels';
import { usePersistentState } from './usePersistentState';

type Format = 'markdown' | 'github' | 'json';
const FORMATS: { key: Format; label: string }[] = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'github', label: 'GitHub Issue' },
  { key: 'json', label: 'JSON' },
];
type Include = { environment: boolean; diagnostics: boolean; errors: boolean; requests: boolean };
const INCLUDE_LABEL: Record<keyof Include, string> = { environment: 'Ambiente', diagnostics: 'Diagnósticos', errors: 'Erros', requests: 'Requisições' };

interface Props {
  store: DevtoolsStore;
  /** Diagnostics to start with (from a diagnostic's "Relatório"); otherwise every relevant one. */
  initialIds?: string[];
  onClose: () => void;
}

/**
 * Report editor. Works on a frozen snapshot so the text doesn't change while it is being read;
 * "Atualizar dados" takes a new one. The final text can be edited by hand before copying/exporting.
 */
export function ReportView({ store, initialIds, onClose }: Props) {
  const [snap, setSnap] = useState<Snapshot>(() => store.getSnapshot());
  const candidates = useMemo(() => {
    const list = defaultDiagnostics(snap);
    // A diagnostic opened explicitly may be informational or dismissed: keep it selectable.
    for (const id of initialIds ?? []) if (!list.some((d) => d.id === id)) list.unshift(...snap.diagnostics.filter((d) => d.id === id));
    return list;
  }, [snap, initialIds]);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(initialIds ?? defaultDiagnostics(snap).map((d) => d.id)));
  // From one diagnostic: only its events. From the general button: every error and failed request too.
  const scope = initialIds ? 'related' : 'all';
  const [initial] = useState(() => buildReport(snap, { diagnosticIds: [...selected], scope }));
  const [title, setTitle] = useState(initial.title);
  const [summary, setSummary] = useState(initial.summary);
  const [steps, setSteps] = useState('');
  const [include, setInclude] = useState<Include>({ environment: true, diagnostics: true, errors: true, requests: true });
  const [format, setFormat] = useState<Format>('markdown');
  const [manual, setManual] = useState<string | null>(null);
  const [repo, setRepo] = usePersistentState('report.repo', '');
  const [status, setStatus] = useState<string | null>(null);

  const report = useMemo(
    () => buildReport(snap, { diagnosticIds: [...selected], scope, title, summary, steps: steps.split('\n'), include }),
    [snap, selected, scope, title, summary, steps, include],
  );
  const generated = useMemo(() => (format === 'json' ? toJson(report) : format === 'github' ? toGitHubIssue(report).body : toMarkdown(report)), [report, format]);
  const text = manual ?? generated;

  const flash = (msg: string) => {
    setStatus(msg);
    setTimeout(() => setStatus(null), 2500);
  };

  const download = () => {
    const ext = format === 'json' ? 'json' : 'md';
    const blob = new Blob([text], { type: format === 'json' ? 'application/json' : 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `bug-report-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  const openIssue = () => {
    const issue = { title: report.title, body: text };
    const target = githubIssueUrl(repo, issue);
    if (!target) return flash('Informe o repositório como owner/repo.');
    if (!target.bodyIncluded) {
      copyText(text);
      flash('Relatório longo demais para a URL: o corpo foi copiado, cole-o na issue.');
    }
    window.open(target.url, '_blank', 'noopener');
  };

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });

  // Any change to the inputs regenerates the text; manual edits are kept until "Regenerar".
  const edit = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    if (manual !== null) flash('Edição manual mantida. Use “Regenerar” para aplicar as mudanças dos campos.');
  };

  return (
    <div className="rep">
      <div className="toolbar">
        <button type="button" className="fdt-icon-btn" onClick={onClose} title="Voltar aos diagnósticos">
          <IconBack />
        </button>
        <span className="rep-title">Relatório de bug</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => setSnap(store.getSnapshot())}
          title="Recria o relatório com o que foi capturado até agora (mantém título, resumo e passos)"
        >
          Atualizar dados
        </button>
      </div>
      <div className="rep-scroll">
        <div className="rep-form">
          <label className="rep-field">
            <span>Título</span>
            <input className="fdt-input" value={title} onChange={(e) => edit(setTitle)(e.target.value)} spellCheck={false} />
          </label>
          <label className="rep-field">
            <span>Resumo</span>
            <textarea className="fdt-input rep-textarea" rows={2} value={summary} onChange={(e) => edit(setSummary)(e.target.value)} />
          </label>
          <label className="rep-field">
            <span>
              Passos para reproduzir <small>um por linha</small>
            </span>
            <textarea
              className="fdt-input rep-textarea"
              rows={3}
              value={steps}
              placeholder={'Abrir /login\nPreencher o formulário\nClicar em Entrar'}
              onChange={(e) => edit(setSteps)(e.target.value)}
            />
          </label>
          <fieldset className="rep-include">
            <legend>Incluir</legend>
            {(Object.keys(INCLUDE_LABEL) as (keyof Include)[]).map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={include[k]} onChange={(e) => edit(setInclude)({ ...include, [k]: e.target.checked })} /> {INCLUDE_LABEL[k]}
              </label>
            ))}
          </fieldset>
          {include.diagnostics && (
            <fieldset className="rep-diags">
              <legend>
                Diagnósticos ({selected.size} de {candidates.length})
              </legend>
              {candidates.length ? (
                candidates.map((d) => (
                  <label key={d.id} className="check rep-diag">
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => edit(toggle)(d.id)} />
                    <span className={`ins-sev sev-${d.severity}`}>{SEVERITY_LABEL[d.severity]}</span>
                    <span className="ellipsis">{d.title}</span>
                    {d.count > 1 && <span className="muted">{d.count}×</span>}
                  </label>
                ))
              ) : (
                <span className="muted">Nenhum diagnóstico ativo. O relatório usa os erros e requisições com falha.</span>
              )}
            </fieldset>
          )}
        </div>

        <div className="rep-output">
          <div className="rep-output-head">
            <div className="segmented" role="radiogroup" aria-label="Formato">
              {FORMATS.map((f) => (
                <button
                  key={f.key}
                  type="button"
                  role="radio"
                  aria-checked={format === f.key}
                  onClick={() => {
                    setFormat(f.key);
                    setManual(null);
                  }}
                >
                  {f.label}
                </button>
              ))}
            </div>
            {manual !== null && (
              <button type="button" className="link-btn" onClick={() => setManual(null)} title="Descarta as edições manuais e gera o texto de novo">
                Regenerar
              </button>
            )}
          </div>
          <p className={`rep-note${report.redactions.total ? ' is-masked' : ''}`}>
            {report.redactions.total
              ? `${report.redactions.total} ${report.redactions.total === 1 ? 'valor mascarado' : 'valores mascarados'} automaticamente (${describeRedactions(report.redactions.found)}). `
              : 'Nenhum valor sensível detectado. '}
            Query strings e cookies nunca entram. A detecção é automática: revise o texto antes de compartilhar.
            {manual !== null && ' Texto editado à mão.'}
          </p>
          <textarea
            className="fdt-input rep-text"
            value={text}
            onChange={(e) => setManual(e.target.value)}
            spellCheck={false}
            aria-label="Texto do relatório (editável)"
          />
          <div className="rep-actions">
            <button
              type="button"
              className="provider-btn is-primary"
              onClick={() => {
                copyText(format === 'github' ? `${report.title}\n\n${text}` : text);
                flash(format === 'github' ? 'Título e corpo copiados.' : 'Copiado.');
              }}
            >
              <IconCopy width={12} height={12} /> Copiar
            </button>
            <button type="button" className="provider-btn" onClick={download}>
              Baixar .{format === 'json' ? 'json' : 'md'}
            </button>
            {format === 'github' && (
              <span className="rep-github">
                <input
                  className="fdt-input"
                  placeholder="owner/repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  spellCheck={false}
                  aria-label="Repositório do GitHub"
                />
                <button type="button" className="provider-btn" onClick={openIssue} disabled={!repo.trim()} title="Abre uma issue nova no GitHub com este título e corpo (você revisa lá antes de criar)">
                  Abrir issue ↗
                </button>
              </span>
            )}
            {status && (
              <span className="rep-status" role="status">
                {status}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
