import type { ConsoleEntry, NetworkEntry } from '../../shared/types';
import { builtinRules } from './rules';
import { DEFAULT_INSIGHTS_CONFIG, severityRank, type Diagnostic, type EventRef, type Finding, type InsightsConfig, type RuleContext, type RuleSet } from './types';

const MAX_DIAGNOSTICS = 500;
const MAX_RELATED = 50;
const MAX_SEEN = 2000;

interface State {
  diag: Diagnostic;
  /** Occurrences already counted (request ids, or log id + repeat number). */
  seen: Set<string>;
  /** Occurrence whose finding is currently displayed. */
  sampleKey: string;
}

const refKey = (r: EventRef) => `${r.kind}:${r.id}`;

function mergeRelated(first: EventRef[], rest: EventRef[]): EventRef[] {
  const out: EventRef[] = [];
  const keys = new Set<string>();
  for (const r of [...first, ...rest]) {
    const k = refKey(r);
    if (keys.has(k)) continue;
    keys.add(k);
    out.push(r);
    if (out.length >= MAX_RELATED) break;
  }
  return out;
}

const content = (f: Finding) => ({
  category: f.category,
  title: f.title,
  description: f.description,
  evidence: f.evidence,
  causes: f.causes,
  impact: f.impact,
  recommendations: f.recommendations,
});

/**
 * Runs the rules over captured events, one event at a time, and merges findings that describe
 * the same problem into one diagnostic. Independent of any AI provider.
 *
 * Requests are evaluated again whenever they gain data; an occurrence is counted once, and a
 * re-evaluation only refreshes the text when it is the occurrence being displayed.
 */
export class DiagnosticsEngine {
  private states = new Map<string, State>();
  private rules: RuleSet;
  private ctx: RuleContext;
  private cached: Diagnostic[] | null = null;

  constructor(
    config: InsightsConfig = DEFAULT_INSIGHTS_CONFIG,
    pageOrigin = '',
    private makeRules: () => RuleSet = builtinRules,
  ) {
    this.ctx = { config, pageOrigin };
    this.rules = makeRules();
  }

  get config() {
    return this.ctx.config;
  }

  /** Forgets everything (and optionally switches config); stateful rules start over. */
  reset(config = this.ctx.config) {
    this.states.clear();
    this.ctx = { ...this.ctx, config };
    this.rules = this.makeRules();
    this.cached = null;
  }

  /**
   * @param occurrence repeat number when consecutive repeats were collapsed into the same entry.
   * @param weight occurrences this call stands for (a rebuild replays a collapsed entry once).
   */
  onLog(entry: ConsoleEntry, occurrence = entry.count ?? 1, weight = 1) {
    for (const rule of this.rules.log) {
      const finding = this.run(() => rule.evaluate(entry, this.ctx));
      if (finding) {
        this.record(finding, `${entry.id}#${occurrence}`, weight);
        return;
      }
    }
  }

  onRequest(entry: NetworkEntry) {
    if (entry.state === 'pending') return;
    for (const rule of this.rules.request) {
      const finding = this.run(() => rule.evaluate(entry, this.ctx));
      if (finding) this.record(finding, entry.id);
    }
  }

  list(): Diagnostic[] {
    return (this.cached ??= [...this.states.values()].map((s) => s.diag));
  }

  /** A broken rule must never break capture. */
  private run(fn: () => Finding | null): Finding | null {
    try {
      return fn();
    } catch {
      return null;
    }
  }

  private record(f: Finding, occurrence: string, weight = 1) {
    const id = `${f.ruleId}:${f.subject}`;
    const prev = this.states.get(id);
    const related = [f.event, ...(f.related ?? [])];

    if (!prev) {
      this.states.set(id, {
        diag: {
          id,
          ruleId: f.ruleId,
          severity: f.severity,
          ...content(f),
          count: weight,
          firstTime: f.time,
          lastTime: f.time,
          related: mergeRelated(related, []),
        },
        seen: new Set([occurrence]),
        sampleKey: occurrence,
      });
      if (this.states.size > MAX_DIAGNOSTICS) this.states.delete(this.states.keys().next().value!);
      this.cached = null;
      return;
    }

    const d = prev.diag;
    const severity = severityRank(f.severity) < severityRank(d.severity) ? f.severity : d.severity;
    if (prev.seen.has(occurrence)) {
      // Same occurrence evaluated again with more data (timing, webRequest status...).
      if (prev.sampleKey !== occurrence) return;
      prev.diag = { ...d, ...content(f), severity, related: mergeRelated(related, d.related) };
    } else {
      prev.seen.add(occurrence);
      if (prev.seen.size > MAX_SEEN) prev.seen.delete(prev.seen.values().next().value!);
      prev.sampleKey = occurrence;
      prev.diag = {
        ...d,
        ...content(f),
        severity,
        count: d.count + weight,
        firstTime: Math.min(d.firstTime, f.time),
        lastTime: Math.max(d.lastTime, f.time),
        related: mergeRelated(related, d.related),
      };
    }
    // Keep the map in last-activity order so the cap evicts the stalest diagnostic.
    this.states.delete(id);
    this.states.set(id, prev);
    this.cached = null;
  }
}
