// DESIGN: v2-provider-abstraction.md#codex-local-parser
// AGENTS: err->try-catch | disk-OK
// 🔀 Provider boundary: scans ~/.codex/sessions/**/*.jsonl
// Reference: tokscale crates/tokscale-core/src/sessions/codex.rs

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { createHash } from 'crypto';
import { ILocalUsageProvider, UnifiedUsageEntry, RateLimits } from '../base/types';
import { log } from '../../utils';

const SESSIONS_DIR = path.join(os.homedir(), '.codex', 'sessions');
const ARCHIVED_DIR = path.join(os.homedir(), '.codex', 'archived_sessions');

interface CodexTokenUsage {
  input_tokens?: number;
  output_tokens?: number;
  cached_input_tokens?: number;
  cache_read_input_tokens?: number;
  reasoning_output_tokens?: number;
}

interface CodexTotals {
  input: number;
  output: number;
  cached: number;
  reasoning: number;
}

function totalsFromUsage(usage: CodexTokenUsage): CodexTotals {
  return {
    input: Math.max(0, usage.input_tokens ?? 0),
    output: Math.max(0, usage.output_tokens ?? 0),
    cached: Math.max(0, usage.cached_input_tokens ?? 0, usage.cache_read_input_tokens ?? 0),
    reasoning: Math.max(0, usage.reasoning_output_tokens ?? 0),
  };
}

function deltaFromTotals(current: CodexTotals, previous: CodexTotals): CodexTotals | null {
  if (
    current.input < previous.input ||
    current.output < previous.output ||
    current.cached < previous.cached ||
    current.reasoning < previous.reasoning
  ) {
    return null;
  }
  return {
    input: current.input - previous.input,
    output: current.output - previous.output,
    cached: current.cached - previous.cached,
    reasoning: current.reasoning - previous.reasoning,
  };
}

function looksLikeStaleRegression(current: CodexTotals, previous: CodexTotals, last: CodexTotals): boolean {
  const prevTotal = previous.input + previous.output + previous.cached + previous.reasoning;
  const currTotal = current.input + current.output + current.cached + current.reasoning;
  const lastTotal = last.input + last.output + last.cached + last.reasoning;

  if (prevTotal <= 0 || currTotal <= 0 || lastTotal <= 0) {
    return false;
  }

  // Regresses by roughly one recent increment → stale snapshot
  return (
    currTotal * 100 >= prevTotal * 98 ||
    currTotal + lastTotal * 2 >= prevTotal
  );
}

function intoTokenUsage(totals: CodexTotals): { inputOther: number; output: number; cacheRead: number; cacheCreate: number; reasoning: number } {
  const clampedCached = Math.min(totals.cached, totals.input);
  return {
    inputOther: Math.max(0, totals.input - clampedCached),
    output: Math.max(0, totals.output),
    cacheRead: Math.max(0, clampedCached),
    cacheCreate: 0,
    reasoning: Math.max(0, totals.reasoning),
  };
}

interface FileState {
  mtimeMs: number;
  size: number;
  contentHash: string;
  entries: UnifiedUsageEntry[];
  lineCount: number;
  lastTotals: CodexTotals | undefined;
}

export class CodexLocalParser implements ILocalUsageProvider {
  private fileStates = new Map<string, FileState>();
  private currentModel: string | undefined;
  private latestRateLimits: RateLimits | null = null;

  async scanSessions(): Promise<UnifiedUsageEntry[]> {
    const allEntries: UnifiedUsageEntry[] = [];
    const files = await this.enumerateJsonlFiles();

    // Remove stale fileStates for deleted files
    const currentFiles = new Set(files);
    for (const [fp] of this.fileStates) {
      if (!currentFiles.has(fp)) {
        this.fileStates.delete(fp);
      }
    }

    for (const filePath of files) {
      const fileState = await this.updateFileState(filePath);
      allEntries.push(...fileState.entries);
    }

    return allEntries;
  }

  invalidate(): void {
    this.fileStates.clear();
    this.currentModel = undefined;
    this.latestRateLimits = null;
  }

  async getRateLimits(): Promise<RateLimits | null> {
    // Re-scan to pick up latest rate_limits from recent JSONL lines
    await this.scanSessions();
    return this.latestRateLimits;
  }

  private async enumerateJsonlFiles(): Promise<string[]> {
    const results: string[] = [];
    for (const dir of [SESSIONS_DIR, ARCHIVED_DIR]) {
      try {
        const files = await this.scanDir(dir);
        results.push(...files);
      } catch {
        // ignore unreadable dirs
      }
    }
    return results;
  }

  private async scanDir(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          const sub = await this.scanDir(fullPath);
          results.push(...sub);
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          results.push(fullPath);
        }
      }
    } catch {
      // ignore
    }
    return results;
  }

  private async updateFileState(filePath: string): Promise<FileState> {
    const existing = this.fileStates.get(filePath);

    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return existing ?? { mtimeMs: 0, size: 0, contentHash: '', entries: [], lineCount: 0, lastTotals: undefined };
    }

    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf-8');
    } catch {
      return existing ?? { mtimeMs: stat.mtimeMs, size: stat.size, contentHash: '', entries: [], lineCount: 0, lastTotals: undefined };
    }

    const contentHash = this.quickHash(text);

    if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size && existing.contentHash === contentHash) {
      return existing;
    }

    const lines = text.split(/\r?\n/);
    let entries: UnifiedUsageEntry[];
    let lineCount = lines.length;
    let lastTotals: CodexTotals | undefined;

    // Incremental parse: if the file grew and we have previous state, try to parse only new lines.
    // This matches tokscale's approach of resuming from a cached offset.
    if (existing && existing.size < stat.size && existing.lineCount > 0 && lineCount > existing.lineCount) {
      const incrementalLines = lines.slice(existing.lineCount);
      const parsed = this.parseLines(incrementalLines, stat.mtimeMs, existing.lastTotals, existing.lastTotals);
      entries = [...existing.entries, ...parsed.entries];
      lastTotals = parsed.lastTotals ?? existing.lastTotals;
    } else {
      const parsed = this.parseLines(lines, stat.mtimeMs, undefined, undefined);
      entries = parsed.entries;
      lastTotals = parsed.lastTotals;
    }

    const fileState: FileState = { mtimeMs: stat.mtimeMs, size: stat.size, contentHash, entries, lineCount, lastTotals };
    this.fileStates.set(filePath, fileState);
    return fileState;
  }

  private parseLines(
    lines: string[],
    fileMtimeMs: number,
    previousTotals?: CodexTotals,
    lastTotals?: CodexTotals,
  ): { entries: UnifiedUsageEntry[]; lastTotals: CodexTotals | undefined } {
    const entries: UnifiedUsageEntry[] = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = this.parseLine(line, fileMtimeMs, previousTotals, lastTotals);
      if (entry) {
        entries.push(entry.entry);
        previousTotals = entry.nextTotals;
        lastTotals = entry.lastTotals;
      }
    }
    return { entries, lastTotals: previousTotals };
  }

  private parseText(text: string, fileMtimeMs: number): UnifiedUsageEntry[] {
    return this.parseLines(text.split(/\r?\n/), fileMtimeMs, undefined, undefined).entries;
  }

  private parseLine(
    line: string,
    fileMtimeMs: number,
    previousTotals: CodexTotals | undefined,
    lastTotals: CodexTotals | undefined,
  ): { entry: UnifiedUsageEntry; nextTotals: CodexTotals | undefined; lastTotals: CodexTotals | undefined } | null {
    try {
      const json = JSON.parse(line);
      const type = json.type;
      const payload = json.payload;

      // Track model from turn_context
      if (type === 'turn_context') {
        const model = this.extractModel(payload);
        if (model) {
          this.currentModel = model;
        }
        return null;
      }

      // Only process event_msg with token_count
      if (type !== 'event_msg') return null;
      const payloadType = payload?.type ?? payload?.payload_type;
      if (payloadType !== 'token_count') return null;

      // Extract rate_limits if present (available in both vscode and exec mode).
      // Try payload.rate_limits first, then info.rate_limits, then top-level rate_limits.
      const rateLimits = payload.rate_limits ?? payload.info?.rate_limits ?? json.rate_limits;
      if (rateLimits) {
        this.latestRateLimits = this.normalizeRateLimits(rateLimits);
      }

      const info = payload.info;
      if (!info) {
        return null;
      }

      const totalUsage: CodexTokenUsage | undefined = info.total_token_usage;
      const lastUsage: CodexTokenUsage | undefined = info.last_token_usage;

      const totalTotals = totalUsage ? totalsFromUsage(totalUsage) : undefined;
      const lastTotalsValue = lastUsage ? totalsFromUsage(lastUsage) : undefined;

      // Skip all-zero snapshots
      const isAllZero = (t?: CodexTotals) => t && t.input === 0 && t.output === 0 && t.cached === 0 && t.reasoning === 0;
      if (isAllZero(totalTotals) && isAllZero(lastTotalsValue)) {
        return null;
      }

      // Compute delta
      let delta: CodexTotals | undefined;
      let nextTotals: CodexTotals | undefined;

      if (totalTotals && lastTotalsValue && previousTotals) {
        if (this.totalsEqual(totalTotals, previousTotals)) {
          return null;
        }
        const d = deltaFromTotals(totalTotals, previousTotals);
        if (d === null && looksLikeStaleRegression(totalTotals, previousTotals, lastTotalsValue)) {
          return null;
        }
        delta = lastTotalsValue;
        nextTotals = totalTotals;
      } else if (totalTotals && lastTotalsValue && !previousTotals) {
        delta = lastTotalsValue;
        nextTotals = totalTotals;
      } else if (totalTotals && !lastTotalsValue && previousTotals) {
        if (this.totalsEqual(totalTotals, previousTotals)) {
          return null;
        }
        const d = deltaFromTotals(totalTotals, previousTotals);
        if (d === null) {
          return null;
        }
        delta = d;
        nextTotals = totalTotals;
      } else if (totalTotals && !lastTotalsValue && !previousTotals) {
        delta = totalTotals;
        nextTotals = totalTotals;
      } else if (!totalTotals && lastTotalsValue && previousTotals) {
        delta = lastTotalsValue;
        nextTotals = {
          input: previousTotals.input + lastTotalsValue.input,
          output: previousTotals.output + lastTotalsValue.output,
          cached: previousTotals.cached + lastTotalsValue.cached,
          reasoning: previousTotals.reasoning + lastTotalsValue.reasoning,
        };
      } else if (!totalTotals && lastTotalsValue && !previousTotals) {
        delta = lastTotalsValue;
        nextTotals = lastTotalsValue;
      } else {
        return null;
      }

      if (!delta) return null;

      // Skip if delta is all zero
      if (delta.input === 0 && delta.output === 0 && delta.cached === 0 && delta.reasoning === 0) {
        return null;
      }

      const usage = intoTokenUsage(delta);
      const timestamp = this.parseTimestamp(json.timestamp) ?? fileMtimeMs;
      const model = this.extractModel(payload) ?? this.currentModel;

      const entry: UnifiedUsageEntry = {
        timestamp,
        inputOther: usage.inputOther,
        output: usage.output,
        inputCacheRead: usage.cacheRead,
        inputCacheCreation: usage.cacheCreate,
        cost: 0, // cost computed later by pricing layer
        messageId: this.makeDedupKey(timestamp, usage, model),
        model,
      };

      return { entry, nextTotals, lastTotals: lastTotalsValue ?? lastTotals };
    } catch {
      return null;
    }
  }

  private normalizeRateLimits(raw: any): RateLimits {
    const out: RateLimits = {};
    if (raw.primary) {
      out.primary = {
        used_percent: typeof raw.primary.used_percent === 'number' ? raw.primary.used_percent : parseFloat(raw.primary.used_percent) || 0,
        window_minutes: typeof raw.primary.window_minutes === 'number' ? raw.primary.window_minutes : parseInt(raw.primary.window_minutes, 10) || undefined,
        resets_in_seconds: typeof raw.primary.resets_in_seconds === 'number' ? raw.primary.resets_in_seconds : parseInt(raw.primary.resets_in_seconds, 10) || undefined,
      };
    }
    if (raw.secondary) {
      out.secondary = {
        used_percent: typeof raw.secondary.used_percent === 'number' ? raw.secondary.used_percent : parseFloat(raw.secondary.used_percent) || 0,
        window_minutes: typeof raw.secondary.window_minutes === 'number' ? raw.secondary.window_minutes : parseInt(raw.secondary.window_minutes, 10) || undefined,
        resets_in_seconds: typeof raw.secondary.resets_in_seconds === 'number' ? raw.secondary.resets_in_seconds : parseInt(raw.secondary.resets_in_seconds, 10) || undefined,
      };
    }
    return out;
  }

  private extractModel(payload: any): string | undefined {
    if (!payload) return undefined;
    const slug = payload.model_info?.slug;
    if (slug) return String(slug);
    if (payload.model) return String(payload.model);
    if (payload.model_name) return String(payload.model_name);
    const info = payload.info;
    if (info) {
      if (info.model) return String(info.model);
      if (info.model_name) return String(info.model_name);
    }
    return undefined;
  }

  private parseTimestamp(v: any): number | undefined {
    if (typeof v === 'number') {
      return v < 1e12 ? v * 1000 : v;
    }
    if (typeof v === 'string') {
      const d = new Date(v);
      return isNaN(d.getTime()) ? undefined : d.getTime();
    }
    return undefined;
  }

  private totalsEqual(a: CodexTotals, b: CodexTotals): boolean {
    return a.input === b.input && a.output === b.output && a.cached === b.cached && a.reasoning === b.reasoning;
  }

  private makeDedupKey(timestamp: number, usage: { inputOther: number; output: number; cacheRead: number; cacheCreate: number; reasoning: number }, model?: string): string {
    return `codex:${timestamp}:${usage.inputOther}:${usage.output}:${usage.cacheRead}:${usage.cacheCreate}${model ? ':' + model : ''}`;
  }

  private quickHash(text: string): string {
    return createHash('md5').update(text).digest('hex').slice(0, 16);
  }
}
