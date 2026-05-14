// DESIGN: v2-phase2-implementation.md#servicesapihistoryservicets
// AGENTS: err->try-catch | disk-OK
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { EstHistoryEntry } from '../types';
import { Store } from '../store';
import { ConfigService } from '../config';

export class ApiHistoryService {
  private static instance: ApiHistoryService;
  private store: Store | null = null;
  private providerId = 'codex';

  static getInstance(): ApiHistoryService {
    if (!ApiHistoryService.instance) {
      ApiHistoryService.instance = new ApiHistoryService();
    }
    return ApiHistoryService.instance;
  }

  setStore(store: Store): void {
    this.store = store;
  }

  setProviderId(id: string): void {
    this.providerId = id;
  }

  async readFromDisk(): Promise<EstHistoryEntry[]> {
    const file = this.historyFile;
    try {
      const raw = await fs.readFile(file, 'utf-8');
      const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
      const entries: EstHistoryEntry[] = [];
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (typeof parsed.timestamp === 'number') {
            parsed.timestamp = Math.round(parsed.timestamp);
          }
          entries.push(parsed as EstHistoryEntry);
        } catch {
          // skip malformed line
        }
      }
      return entries;
    } catch {
      return [];
    }
  }

  async writeToDisk(entries: EstHistoryEntry[]): Promise<void> {
    const file = this.historyFile;
    try {
      const lines = entries.map(e => JSON.stringify({ ...e, timestamp: Math.round(e.timestamp) }));
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, lines.join('\n') + (lines.length > 0 ? '\n' : ''), 'utf-8');
    } catch {
      // ignore write errors
    }
  }

  async persistIfEnabled(): Promise<void> {
    const config = ConfigService.getInstance();
    if (!config.apiHistoryPersistOnExit || !this.store) {
      return;
    }
    await this.writeToDisk(this.store.getState().estHistory);
  }

  private get historyFile(): string {
    const suffix = this.providerId && this.providerId !== 'codex' ? `-${this.providerId}` : '';
    return path.join(os.homedir(), '.codex', `codex-status-pro-api-history${suffix}.jsonl`);
  }
}
