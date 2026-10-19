import type { ConsoleEntry, ConsoleLevel } from '../shared/types';
import { fingerprint } from './fingerprint';

const MAX_GROUPS = 2000;

export interface LogGroup {
  key: string;
  level: ConsoleLevel;
  /** Most recent occurrence, shown as the group's row. */
  sample: ConsoleEntry;
  /** Every occurrence since the last clear, including ones already evicted from the log buffer. */
  count: number;
  firstTime: number;
  lastTime: number;
}

/**
 * Incremental index of console entries by fingerprint: O(1) per entry, so it keeps up with
 * real-time capture. Groups are immutable (replaced on change) so React rows can be memoized,
 * and the map is kept in last-activity order, so listing needs no sort.
 */
export class LogGroupIndex {
  private groups = new Map<string, LogGroup>();
  /** Last list() result, reused while nothing changed (network-only flushes). */
  private cached: LogGroup[] | null = null;

  /** Records one occurrence and returns the group key. Reuses `entry.group` when already set. */
  add(entry: ConsoleEntry): string {
    const key = entry.group ?? fingerprint(entry);
    const prev = this.groups.get(key);
    if (prev) this.groups.delete(key);
    this.groups.set(key, {
      key,
      level: entry.level,
      sample: entry,
      count: (prev?.count ?? 0) + 1,
      firstTime: prev?.firstTime ?? entry.time,
      lastTime: entry.time,
    });
    if (this.groups.size > MAX_GROUPS) this.groups.delete(this.groups.keys().next().value!);
    this.cached = null;
    return key;
  }

  clear() {
    this.groups.clear();
    this.cached = null;
  }

  /** Groups ordered by last occurrence (oldest activity first, like the console). */
  list(): LogGroup[] {
    return (this.cached ??= [...this.groups.values()]);
  }
}
