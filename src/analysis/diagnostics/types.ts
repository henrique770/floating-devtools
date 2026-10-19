import type { ConsoleEntry, NetworkEntry } from '../../shared/types';

export type Severity = 'high' | 'medium' | 'low' | 'info';
export type Category = 'javascript' | 'network' | 'storage' | 'performance';

export const SEVERITIES: Severity[] = ['high', 'medium', 'low', 'info'];
export const CATEGORIES: Category[] = ['javascript', 'network', 'storage', 'performance'];

export type EventRef = { kind: 'log' | 'request'; id: string };

/** Limits used by the performance rules (configurable in Settings > Insights). */
export interface InsightsConfig {
  /** Requests slower than this (total duration) are reported. */
  slowMs: number;
  /** Resources larger than this (bytes transferred, or decoded when served from cache) are reported. */
  largeBytes: number;
  /** Identical requests inside this window count as potential duplicates... */
  duplicateWindowMs: number;
  /** ...once there are at least this many. */
  duplicateMin: number;
}

export const DEFAULT_INSIGHTS_CONFIG: InsightsConfig = {
  slowMs: 1000,
  largeBytes: 1_000_000,
  duplicateWindowMs: 2000,
  duplicateMin: 3,
};

/**
 * What a rule reports about one event. `evidence` holds only facts read from the captured data;
 * anything inferred goes in `causes`, which the UI presents as hypotheses.
 */
export interface Finding {
  ruleId: string;
  /** Identifies the problem: findings with the same rule and subject merge into one diagnostic. */
  subject: string;
  category: Category;
  severity: Severity;
  title: string;
  description: string;
  evidence: string[];
  causes: string[];
  impact: string;
  recommendations: string[];
  event: EventRef;
  time: number;
  /** Other events that are part of this occurrence (e.g. the earlier duplicates). */
  related?: EventRef[];
}

export interface Diagnostic extends Omit<Finding, 'event' | 'time' | 'related' | 'subject'> {
  /** `ruleId:subject` - stable across re-evaluations, so dismissals survive. */
  id: string;
  count: number;
  firstTime: number;
  lastTime: number;
  /** Most recent events first, capped. */
  related: EventRef[];
}

export interface RuleContext {
  config: InsightsConfig;
  /** Origin of the inspected page, to tell first-party problems from third-party noise. */
  pageOrigin: string;
}

export interface LogRule {
  id: string;
  evaluate(entry: ConsoleEntry, ctx: RuleContext): Finding | null;
}

export interface RequestRule {
  id: string;
  /** Called again whenever a finished request gains data (status from webRequest, timing...). */
  evaluate(entry: NetworkEntry, ctx: RuleContext): Finding | null;
}

/** Rule sets are built by factories so stateful rules (duplicates) start clean on every reset. */
export interface RuleSet {
  log: LogRule[];
  request: RequestRule[];
}

const ORDER: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };
export const severityRank = (s: Severity) => ORDER[s];

/** One step less severe: used for third-party noise. */
export const downgrade = (s: Severity): Severity => SEVERITIES[Math.min(SEVERITIES.length - 1, ORDER[s] + 1)];
