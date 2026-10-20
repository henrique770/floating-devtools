import { useMemo, useState } from 'react';
import { describeRedactions } from '../analysis/redact';
import { defineMessages } from '../i18n';
import type { DevtoolsStore, Snapshot } from '../content/store';
import { buildReport, defaultDiagnostics, githubIssueUrl, toGitHubIssue, toJson, toMarkdown } from './bugReport';
import { copyText } from './format';
import { IconBack, IconCopy } from './Icons';
import { severityLabel } from './labels';
import { useLocale } from './useLocale';
import { usePersistentState } from './usePersistentState';

const m = defineMessages({
  pt: {
    include: { environment: 'Ambiente', diagnostics: 'Diagnósticos', errors: 'Erros', requests: 'Requisições' } as Record<keyof Include, string>,
    repoHint: 'Informe o repositório como owner/repo.',
    tooLong: 'Relatório longo demais para a URL: o corpo foi copiado, cole-o na issue.',
    keptManual: 'Edição manual mantida. Use “Regenerar” para aplicar as mudanças dos campos.',
    back: 'Voltar aos diagnósticos',
    title: 'Relatório de bug',
    refreshTitle: 'Recria o relatório com o que foi capturado até agora (mantém título, resumo e passos)',
    refresh: 'Atualizar dados',
    fieldTitle: 'Título',
    summary: 'Resumo',
    steps: 'Passos para reproduzir',
    onePerLine: 'um por linha',
    stepsPlaceholder: 'Abrir /login\nPreencher o formulário\nClicar em Entrar',
    includeLegend: 'Incluir',
    diagnostics: (selected: number, total: number) => `Diagnósticos (${selected} de ${total})`,
    noDiagnostics: 'Nenhum diagnóstico ativo. O relatório usa os erros e requisições com falha.',
    format: 'Formato',
    regenerateTitle: 'Descarta as edições manuais e gera o texto de novo',
    regenerate: 'Regenerar',
    masked: (n: number, kinds: string) => `${n === 1 ? '1 valor mascarado' : `${n} valores mascarados`} automaticamente (${kinds}). `,
    noneMasked: 'Nenhum valor sensível detectado. ',
    reviewNote: 'Query strings e cookies nunca entram. A detecção é automática: revise o texto antes de compartilhar.',
    edited: ' Texto editado à mão.',
    textLabel: 'Texto do relatório (editável)',
    titleBodyCopied: 'Título e corpo copiados.',
    copied: 'Copiado.',
    copy: 'Copiar',
    download: (ext: string) => `Baixar .${ext}`,
    repo: 'Repositório do GitHub',
    openIssueTitle: 'Abre uma issue nova no GitHub com este título e corpo (você revisa lá antes de criar)',
    openIssue: 'Abrir issue ↗',
  },
  en: {
    include: { environment: 'Environment', diagnostics: 'Diagnostics', errors: 'Errors', requests: 'Requests' },
    repoHint: 'Enter the repository as owner/repo.',
    tooLong: 'Report too long for the URL: the body was copied, paste it into the issue.',
    keptManual: 'Manual edit kept. Use “Regenerate” to apply the field changes.',
    back: 'Back to diagnostics',
    title: 'Bug report',
    refreshTitle: 'Rebuilds the report with what was captured so far (keeps title, summary and steps)',
    refresh: 'Refresh data',
    fieldTitle: 'Title',
    summary: 'Summary',
    steps: 'Steps to reproduce',
    onePerLine: 'one per line',
    stepsPlaceholder: 'Open /login\nFill in the form\nClick Sign in',
    includeLegend: 'Include',
    diagnostics: (selected, total) => `Diagnostics (${selected} of ${total})`,
    noDiagnostics: 'No active diagnostics. The report uses the errors and failed requests.',
    format: 'Format',
    regenerateTitle: 'Discards the manual edits and generates the text again',
    regenerate: 'Regenerate',
    masked: (n, kinds) => `${n === 1 ? '1 value' : `${n} values`} masked automatically (${kinds}). `,
    noneMasked: 'No sensitive values detected. ',
    reviewNote: 'Query strings and cookies are never included. Detection is automatic: review the text before sharing.',
    edited: ' Text edited by hand.',
    textLabel: 'Report text (editable)',
    titleBodyCopied: 'Title and body copied.',
    copied: 'Copied.',
    copy: 'Copy',
    download: (ext) => `Download .${ext}`,
    repo: 'GitHub repository',
    openIssueTitle: 'Opens a new GitHub issue with this title and body (you review it there before creating)',
    openIssue: 'Open issue ↗',
  },
});

type Format = 'markdown' | 'github' | 'json';
const FORMATS: { key: Format; label: string }[] = [
  { key: 'markdown', label: 'Markdown' },
  { key: 'github', label: 'GitHub Issue' },
  { key: 'json', label: 'JSON' },
];
type Include = { environment: boolean; diagnostics: boolean; errors: boolean; requests: boolean };
const INCLUDE_KEYS: (keyof Include)[] = ['environment', 'diagnostics', 'errors', 'requests'];

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
  const locale = useLocale();
  const t = m();

  const report = useMemo(
    () => buildReport(snap, { diagnosticIds: [...selected], scope, title, summary, steps: steps.split('\n'), include }),
    [snap, selected, scope, title, summary, steps, include, locale],
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
    if (!target) return flash(t.repoHint);
    if (!target.bodyIncluded) {
      copyText(text);
      flash(t.tooLong);
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
    if (manual !== null) flash(t.keptManual);
  };

  return (
    <div className="rep">
      <div className="toolbar">
        <button type="button" className="fdt-icon-btn" onClick={onClose} title={t.back}>
          <IconBack />
        </button>
        <span className="rep-title">{t.title}</span>
        <button
          type="button"
          className="link-btn"
          onClick={() => setSnap(store.getSnapshot())}
          title={t.refreshTitle}
        >
          {t.refresh}
        </button>
      </div>
      <div className="rep-scroll">
        <div className="rep-form">
          <label className="rep-field">
            <span>{t.fieldTitle}</span>
            <input className="fdt-input" value={title} onChange={(e) => edit(setTitle)(e.target.value)} spellCheck={false} />
          </label>
          <label className="rep-field">
            <span>{t.summary}</span>
            <textarea className="fdt-input rep-textarea" rows={2} value={summary} onChange={(e) => edit(setSummary)(e.target.value)} />
          </label>
          <label className="rep-field">
            <span>
              {t.steps} <small>{t.onePerLine}</small>
            </span>
            <textarea
              className="fdt-input rep-textarea"
              rows={3}
              value={steps}
              placeholder={t.stepsPlaceholder}
              onChange={(e) => edit(setSteps)(e.target.value)}
            />
          </label>
          <fieldset className="rep-include">
            <legend>{t.includeLegend}</legend>
            {INCLUDE_KEYS.map((k) => (
              <label key={k} className="check">
                <input type="checkbox" checked={include[k]} onChange={(e) => edit(setInclude)({ ...include, [k]: e.target.checked })} /> {t.include[k]}
              </label>
            ))}
          </fieldset>
          {include.diagnostics && (
            <fieldset className="rep-diags">
              <legend>{t.diagnostics(selected.size, candidates.length)}</legend>
              {candidates.length ? (
                candidates.map((d) => (
                  <label key={d.id} className="check rep-diag">
                    <input type="checkbox" checked={selected.has(d.id)} onChange={() => edit(toggle)(d.id)} />
                    <span className={`ins-sev sev-${d.severity}`}>{severityLabel(d.severity)}</span>
                    <span className="ellipsis">{d.title}</span>
                    {d.count > 1 && <span className="muted">{d.count}×</span>}
                  </label>
                ))
              ) : (
                <span className="muted">{t.noDiagnostics}</span>
              )}
            </fieldset>
          )}
        </div>

        <div className="rep-output">
          <div className="rep-output-head">
            <div className="segmented" role="radiogroup" aria-label={t.format}>
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
              <button type="button" className="link-btn" onClick={() => setManual(null)} title={t.regenerateTitle}>
                {t.regenerate}
              </button>
            )}
          </div>
          <p className={`rep-note${report.redactions.total ? ' is-masked' : ''}`}>
            {report.redactions.total
              ? t.masked(report.redactions.total, describeRedactions(report.redactions.found))
              : t.noneMasked}
            {t.reviewNote}
            {manual !== null && t.edited}
          </p>
          <textarea
            className="fdt-input rep-text"
            value={text}
            onChange={(e) => setManual(e.target.value)}
            spellCheck={false}
            aria-label={t.textLabel}
          />
          <div className="rep-actions">
            <button
              type="button"
              className="provider-btn is-primary"
              onClick={() => {
                copyText(format === 'github' ? `${report.title}\n\n${text}` : text);
                flash(format === 'github' ? t.titleBodyCopied : t.copied);
              }}
            >
              <IconCopy width={12} height={12} /> {t.copy}
            </button>
            <button type="button" className="provider-btn" onClick={download}>
              {t.download(format === 'json' ? 'json' : 'md')}
            </button>
            {format === 'github' && (
              <span className="rep-github">
                <input
                  className="fdt-input"
                  placeholder="owner/repo"
                  value={repo}
                  onChange={(e) => setRepo(e.target.value)}
                  spellCheck={false}
                  aria-label={t.repo}
                />
                <button type="button" className="provider-btn" onClick={openIssue} disabled={!repo.trim()} title={t.openIssueTitle}>
                  {t.openIssue}
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
