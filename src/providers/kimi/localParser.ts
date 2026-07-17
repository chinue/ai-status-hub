// DESIGN: v2-local-estimation-design.md
// AGENTS: err->try-catch | retention->dataRetentionDays | disk-OK
// 🔀 Provider boundary: JSONL path and format are Kimi-specific.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { ILocalUsageProvider, UnifiedUsageEntry, RateLimits } from '../base/types';
import { log } from '../../utils';

// k3.0 (Kimi Code) sessions live in ~/.kimi-code; ~/.kimi is the legacy k2.6 location.
const DEFAULT_SESSIONS_DIRS = [
  path.join(os.homedir(), '.kimi-code', 'sessions'),
  path.join(os.homedir(), '.kimi', 'sessions'),
];

/** Normalize raw model aliases ('kimi-code/k3') to canonical names ('kimi-k3'). */
export function normalizeKimiModel(model: unknown): string | undefined {
  if (typeof model !== 'string' || !model.trim()) return undefined;
  const last = model.trim().split('/').pop()!.toLowerCase();
  return last.startsWith('kimi') ? last : `kimi-${last}`;
}

interface FileState {
  mtimeMs: number;
  size: number;
  entries: UnifiedUsageEntry[];
}

export class KimiLocalParser implements ILocalUsageProvider {
  private fileStates = new Map<string, FileState>();
  private latestRateLimits: RateLimits | null = null;
  private readonly sessionsDirs: string[];

  constructor(sessionsDirs?: string[]) {
    this.sessionsDirs = sessionsDirs ?? DEFAULT_SESSIONS_DIRS;
  }

  async scanSessions(opts?: {
    window5hStartMs?: number;
    window7dStartMs?: number;
    dataRetentionDays?: number;
    force?: boolean;
  }): Promise<UnifiedUsageEntry[]> {
    const files = await this.enumerateWireJsonl();

    // Remove stale fileStates for deleted files
    const currentFiles = new Set(files);
    for (const [fp] of this.fileStates) {
      if (!currentFiles.has(fp)) {
        this.fileStates.delete(fp);
      }
    }

    const entries: UnifiedUsageEntry[] = [];
    const seenMessageIds = new Set<string>();
    const retentionDays = opts?.dataRetentionDays ?? 365;
    const retentionStart = Date.now() - retentionDays * 24 * 3600 * 1000;

    for (const filePath of files) {
      const fileState = await this.updateFileState(filePath);
      for (const entry of fileState.entries) {
        if (entry.messageId) {
          if (seenMessageIds.has(entry.messageId)) continue;
          seenMessageIds.add(entry.messageId);
        }
        if (entry.timestamp < retentionStart) continue;
        entries.push(entry);
      }
    }

    return entries;
  }

  async getRateLimits(): Promise<RateLimits | null> {
    // Kimi local JSONL does not contain rate_limits; return null
    return null;
  }

  invalidate(): void {
    this.fileStates.clear();
    this.latestRateLimits = null;
  }

  private async updateFileState(filePath: string): Promise<FileState> {
    const existing = this.fileStates.get(filePath);

    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return existing ?? { mtimeMs: 0, size: 0, entries: [] };
    }

    if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
      return existing;
    }

    let text: string;
    try {
      text = await fs.readFile(filePath, 'utf-8');
    } catch {
      return existing ?? { mtimeMs: stat.mtimeMs, size: stat.size, entries: [] };
    }

    const newEntries = this.parseText(text);
    const fileState: FileState = { mtimeMs: stat.mtimeMs, size: stat.size, entries: newEntries };
    this.fileStates.set(filePath, fileState);
    return fileState;
  }

  private parseText(text: string): UnifiedUsageEntry[] {
    const entries: UnifiedUsageEntry[] = [];
    const lines = text.split(/\r?\n/);
    for (const line of lines) {
      if (!line.trim()) continue;
      const entry = this.parseLine(line);
      if (entry) entries.push(entry);
    }
    return entries;
  }

  private parseLine(line: string): UnifiedUsageEntry | null {
    try {
      const json = JSON.parse(line);

      // k3.0 (Kimi Code) format:
      // {"type":"usage.record","model":"kimi-code/k3","usage":{...},"usageScope":"turn","time":<ms>}
      if (json.type === 'usage.record') {
        // Only per-turn increments are additive; skip any cumulative scopes.
        if (json.usageScope && json.usageScope !== 'turn') return null;
        const u = json.usage;
        if (!u) return null;
        const timestamp = typeof json.time === 'number' ? json.time : Date.now();

        return {
          timestamp,
          inputOther: toInt(u.inputOther),
          output: toInt(u.output),
          inputCacheRead: toInt(u.inputCacheRead),
          inputCacheCreation: toInt(u.inputCacheCreation),
          cost: 0, // cost is calculated later by LocalUsageService using provider pricing
          messageId: null,
          model: normalizeKimiModel(json.model),
        };
      }

      // k2.6 legacy format:
      // {"timestamp":<s>,"message":{"type":"StatusUpdate","payload":{"token_usage":{...},"message_id":...}}}
      if (json.message?.type !== 'StatusUpdate') return null;
      const payload = json.message.payload;
      if (!payload?.token_usage) return null;

      const tu = payload.token_usage;
      const timestamp = typeof json.timestamp === 'number' ? json.timestamp * 1000 : Date.now();

      return {
        timestamp,
        inputOther: toInt(tu.input_other),
        output: toInt(tu.output),
        inputCacheRead: toInt(tu.input_cache_read),
        inputCacheCreation: toInt(tu.input_cache_creation),
        cost: 0, // cost is calculated later by LocalUsageService using provider pricing
        messageId: payload.message_id ?? null,
        model: normalizeKimiModel(payload.model),
      };
    } catch {
      return null;
    }
  }

  private async enumerateWireJsonl(): Promise<string[]> {
    const results: string[] = [];
    for (const dir of this.sessionsDirs) {
      await this.walkWireJsonl(dir, 0, results);
    }
    return results;
  }

  /** Recursively collect wire.jsonl files (legacy layout: 2 levels, k3.0 layout: 4 levels). */
  private async walkWireJsonl(dir: string, depth: number, results: string[]): Promise<void> {
    if (depth > 6) return;
    let items: import('fs').Dirent[];
    try {
      items = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // ignore missing/unreadable dirs
    }
    for (const item of items) {
      const p = path.join(dir, item.name);
      if (item.isDirectory()) {
        await this.walkWireJsonl(p, depth + 1, results);
      } else if (item.isFile() && item.name === 'wire.jsonl') {
        results.push(p);
      }
    }
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}
