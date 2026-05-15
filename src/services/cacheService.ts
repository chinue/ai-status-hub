// DESIGN: v2-phase2-implementation.md#servicescacheservicets
// AGENTS: err->try-catch | schema-version->v2 | disk-OK
// 💠 Generic: cache schema is provider-agnostic.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CachedData } from '../types';

const CACHE_DIR = path.join(os.homedir(), '.codex');
const SCHEMA = 'ai-status-hub-cache-v1';
const CURRENT_VERSION = 3;

function cacheFileFor(providerId?: string): string {
  const suffix = providerId && providerId !== 'codex' ? `-${providerId}` : '';
  return path.join(CACHE_DIR, `ai-status-hub-cache-v1${suffix}.json`);
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
}
