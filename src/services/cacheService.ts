// DESIGN: v2-phase2-implementation.md#servicescacheservicets
// AGENTS: err->try-catch | schema-version->v2 | disk-OK
// 💠 Generic: cache schema is provider-agnostic.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CachedData, WindowAnchorData } from '../types';

const CACHE_DIR = path.join(os.homedir(), '.codex');
const SCHEMA = 'ai-status-hub-cache-v1';
const CURRENT_VERSION = 3;
const WINDOW_ANCHOR_SCHEMA = 'ai-status-hub-window-anchors-v1';
const WINDOW_ANCHOR_VERSION = 1;

function cacheFileFor(providerId?: string): string {
  const suffix = providerId && providerId !== 'codex' ? `-${providerId}` : '';
  return path.join(CACHE_DIR, `ai-status-hub-cache-v1${suffix}.json`);
}

function windowAnchorFileFor(providerId?: string): string {
  const suffix = providerId && providerId !== 'codex' ? `-${providerId}` : '';
  return path.join(CACHE_DIR, `ai-status-hub-window-anchors${suffix}.json`);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validateWindowAnchors(data: unknown, providerId: string): WindowAnchorData | null {
  const d = data as Partial<WindowAnchorData> | null;
  if (!d || typeof d !== 'object') return null;
  if (d.providerId !== providerId) return null;
  if (!isFiniteNumber(d.window5hStartMs)) return null;
  if (!isFiniteNumber(d.window5hResetAtMs)) return null;
  if (!isFiniteNumber(d.window7dStartMs)) return null;
  if (!isFiniteNumber(d.window7dResetAtMs)) return null;
  if (!isFiniteNumber(d.updatedAt)) return null;
  if (d.source !== 'api' && d.source !== 'disk' && d.source !== 'fallback') return null;
  return {
    providerId: d.providerId,
    window5hStartMs: d.window5hStartMs,
    window5hResetAtMs: d.window5hResetAtMs,
    window7dStartMs: d.window7dStartMs,
    window7dResetAtMs: d.window7dResetAtMs,
    updatedAt: d.updatedAt,
    source: d.source,
  };
}

export class CacheService {
  private static instance: CacheService;
  private providerId: string | undefined;
  private overrideFile: string | undefined;

  static getInstance(): CacheService {
    if (!CacheService.instance) { CacheService.instance = new CacheService(); }
    return CacheService.instance;
  }

  constructor(overrideFile?: string) {
    this.overrideFile = overrideFile;
  }

  setProviderId(id: string): void {
    this.providerId = id;
  }

  private get cacheFile(): string {
    return this.overrideFile ?? cacheFileFor(this.providerId);
  }

  private windowAnchorFile(providerId?: string): string {
    const resolvedProvider = providerId ?? this.providerId;
    if (!this.overrideFile) {
      return windowAnchorFileFor(resolvedProvider);
    }
    const suffix = resolvedProvider && resolvedProvider !== 'codex' ? `-${resolvedProvider}` : '';
    return path.join(path.dirname(this.overrideFile), `ai-status-hub-window-anchors${suffix}.json`);
  }

  async read(): Promise<CachedData | null> {
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== SCHEMA || parsed.version !== CURRENT_VERSION) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async write(data: CachedData): Promise<void> {
    const payload = {
      version: CURRENT_VERSION,
      schema: SCHEMA,
      writtenAt: new Date().toISOString(),
      data,
    };
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(payload, null, 2));
    } catch {
      // ignore write errors
    }
  }

  async clear(): Promise<void> {
    try { await fs.unlink(this.cacheFile); } catch { /* ignore */ }
  }

  async readWindowAnchors(providerId?: string): Promise<WindowAnchorData | null> {
    const resolvedProvider = providerId ?? this.providerId ?? 'codex';
    try {
      const raw = await fs.readFile(this.windowAnchorFile(resolvedProvider), 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== WINDOW_ANCHOR_SCHEMA || parsed.version !== WINDOW_ANCHOR_VERSION) {
        return null;
      }
      const anchors = validateWindowAnchors(parsed.data, resolvedProvider);
      return anchors ? { ...anchors, source: 'disk' } : null;
    } catch {
      return null;
    }
  }

  async writeWindowAnchors(providerId: string, data: WindowAnchorData): Promise<void> {
    const anchors = validateWindowAnchors(data, providerId);
    if (!anchors) return;
    const payload = {
      version: WINDOW_ANCHOR_VERSION,
      schema: WINDOW_ANCHOR_SCHEMA,
      writtenAt: new Date().toISOString(),
      data: anchors,
    };
    const file = this.windowAnchorFile(providerId);
    try {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(payload, null, 2));
    } catch {
      // ignore write errors
    }
  }
}
