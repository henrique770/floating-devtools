import type { Category, Severity } from '../analysis/diagnostics/types';
import { defineMessages } from '../i18n';

const m = defineMessages<{ severity: Record<Severity, string>; category: Record<Category, string> }>({
  pt: {
    severity: { high: 'Alta', medium: 'Média', low: 'Baixa', info: 'Info' },
    category: { javascript: 'JavaScript', network: 'Network', storage: 'Storage', performance: 'Performance' },
  },
  en: {
    severity: { high: 'High', medium: 'Medium', low: 'Low', info: 'Info' },
    category: { javascript: 'JavaScript', network: 'Network', storage: 'Storage', performance: 'Performance' },
  },
});

export const severityLabel = (s: Severity) => m().severity[s];
export const categoryLabel = (c: Category) => m().category[c];
