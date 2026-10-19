import { describe, expect, it } from 'vitest';
import type { Diagnostic } from '../analysis/diagnostics/types';
import { aiPrompt } from './InsightsTab';

describe('aiPrompt', () => {
  it('separates evidence from hypotheses and masks secrets', () => {
    const d: Diagnostic = {
      id: 'net.http-error:x',
      ruleId: 'net.http-error',
      category: 'network',
      severity: 'medium',
      title: 'Não autenticado (HTTP 401)',
      description: 'GET app.test respondeu com status 401.',
      evidence: ['Resposta: {"error":"expired","access_token":"abc.def"}', 'Authorization: Bearer abcdefgh12345'],
      causes: ['Token/sessão expirado ou ausente.'],
      impact: '',
      recommendations: [],
      count: 2,
      firstTime: 0,
      lastTime: 0,
      related: [],
    };
    const text = aiPrompt(d);
    expect(text).toContain('Evidências observadas:');
    expect(text).toContain('Hipóteses levantadas localmente (não confirmadas):');
    expect(text).not.toContain('abc.def');
    expect(text).not.toContain('abcdefgh12345');
  });
});
