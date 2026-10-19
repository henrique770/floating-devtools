import type { Category, Severity } from '../analysis/diagnostics/types';

export const SEVERITY_LABEL: Record<Severity, string> = { high: 'Alta', medium: 'Média', low: 'Baixa', info: 'Info' };
export const CATEGORY_LABEL: Record<Category, string> = { javascript: 'JavaScript', network: 'Network', storage: 'Storage', performance: 'Performance' };
