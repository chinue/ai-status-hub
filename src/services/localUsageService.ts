// DESIGN: v2-local-estimation-design.md
// AGENTS: err->try-catch | retention->dataRetentionDays | disk-OK

import { UsageEntry } from '../types';
import { calculateCost, claudeLogProvider, parseClineSessionUsage } from '../calc';
import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';
import { log } from '../utils';
import { ConfigService } from '../config';
import { IProvider, UnifiedUsageEntry } from '../providers/base/types';

export interface LocalAggregatedUsage {
  tokensToday: number;
  tokensOutToday: number;
  tokensCacheReadToday: number;
  tokensCacheCreateToday: number;
  costToday: number;
  requestsToday: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  requests5h: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  cost7d: number;
  requests7d: number;
  cost5h: number;
  tokensThisCycle: number;
  tokensOutThisCycle: number;
  tokensCacheReadThisCycle: number;
  tokensCacheCreateThisCycle: number;
  costThisCycle: number;
  requestsThisCycle: number;
  entries: UsageEntry[];
}

export class LocalUsageService {
  private static instance: LocalUsageService;
  private aggregate: LocalAggregatedUsage | null = null;
  private provider: IProvider | undefined;

  constructor(private readonly clineRoots = LocalUsageService.defaultClineRoots()) {}

  private static defaultClineRoots(): string[] {
    const home = os.homedir();
    const config = process.platform === 'win32' ? process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
      : process.platform === 'darwin' ? path.join(home, 'Library', 'Application Support')
        : process.env.XDG_CONFIG_HOME || path.join(home, '.config');
    const editorUsers = [path.join(home, '.vscode-server', 'data', 'User'),
      ...['Code', 'Code - Insiders', 'VSCodium', 'Cursor'].map(app => path.join(config, app, 'User'))];
    return [path.join(home, '.cline', 'data', 'tasks'), path.join(home, '.cline', 'tasks'),
      path.join(home, '.cline', 'data', 'sessions'), path.join(home, '.cline', 'sessions'),
      ...editorUsers.flatMap(user => [path.join(user, 'globalStorage'), path.join(user, 'profiles')])];
  }

  /** Cline disk access stays in LocalUsageService; provider parsers keep their native formats. */
  private async scanClineUsage(): Promise<UnifiedUsageEntry[]> {
    if (this.provider?.id !== 'kimi' && this.provider?.id !== 'glm') return [];
    const entries: UnifiedUsageEntry[] = [];
    const visited = new Set<string>();
    const walk = async (dir: string, depth: number): Promise<void> => {
      if (depth > 7 || visited.has(path.resolve(dir))) return;
      visited.add(path.resolve(dir));
      try {
        const items = await fs.readdir(dir, { withFileTypes: true });
        for (const item of items) {
          if (item.isDirectory() && !['node_modules', '.git', 'checkpoints'].includes(item.name)) {
            // Limit editor storage traversal to profiles and the Cline extension.
            if (path.basename(dir) === 'globalStorage' && item.name !== 'saoudrizwan.claude-dev') continue;
            await walk(path.join(dir, item.name), depth + 1);
          } else if (item.isFile() && item.name === 'ui_messages.json') {
            await readTask(dir);
          } else if (item.isFile() && item.name.endsWith('.messages.json')) {
            try {
              const session = JSON.parse(await fs.readFile(path.join(dir, item.name), 'utf8'));
              const parsed = parseClineSessionUsage(session, item.name.slice(0, -'.messages.json'.length));
              entries.push(...parsed.filter(entry => claudeLogProvider(entry.model) === this.provider?.id));
            } catch { /* Ignore incomplete copies and retry on the next scan. */ }
          }
        }
      } catch { /* Optional or unreadable Cline roots must not block native usage. */ }
    };
    const readTask = async (dir: string): Promise<void> => {
      let models: Array<{ ts: number; model_id: string }> = [];
      try {
        const metadata = JSON.parse(await fs.readFile(path.join(dir, 'task_metadata.json'), 'utf8'));
        if (Array.isArray(metadata?.model_usage)) {
          models = metadata.model_usage.filter((m: any) => Number.isFinite(m?.ts) && typeof m?.model_id === 'string')
            .sort((a: any, b: any) => a.ts - b.ts);
        }
      } catch { /* Newer messages carry modelInfo directly. */ }
      try {
        const messages = JSON.parse(await fs.readFile(path.join(dir, 'ui_messages.json'), 'utf8'));
        if (!Array.isArray(messages)) return;
        for (const message of messages) {
          try {
            if (message?.say !== 'api_req_started' || message.partial || !Number.isFinite(message.ts)) continue;
            const usage = JSON.parse(message.text);
            const history = models.filter(m => m.ts <= message.ts);
            const model = message.modelInfo?.modelId ?? usage?.model ?? usage?.modelId ?? history[history.length - 1]?.model_id;
            if (typeof model !== 'string' || claudeLogProvider(model) !== this.provider?.id) continue;
            const count = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
            const inputOther = count(usage.tokensIn);
            const output = count(usage.tokensOut);
            const inputCacheRead = count(usage.cacheReads);
            const inputCacheCreation = count(usage.cacheWrites);
            if (inputOther + output + inputCacheRead + inputCacheCreation === 0) continue;
            entries.push({ timestamp: message.ts, model, inputOther, output, inputCacheRead, inputCacheCreation,
              cost: 0, messageId: `cline:${path.basename(dir)}:${message.ts}` });
          } catch { /* Skip malformed individual requests, retaining other task usage. */ }
        }
      } catch { /* Ignore incomplete writes and retry on the next scan. */ }
    };
    for (const root of this.clineRoots) await walk(root, 0);
    return entries;
  }

  static getInstance(): LocalUsageService {
    if (!LocalUsageService.instance) { LocalUsageService.instance = new LocalUsageService(); }
    return LocalUsageService.instance;
  }

  setProvider(provider: IProvider): void {
    this.provider = provider;
  }

  async getLocalUsage(opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
    dataRetentionDays?: number;
    force?: boolean;
  }): Promise<LocalAggregatedUsage> {
    this.aggregate = await this.aggregateFromProvider(opts);
    return this.aggregate;
  }

  async getRawEntries(): Promise<UsageEntry[]> {
    const usage = await this.getLocalUsage();
    return usage.entries;
  }

  async getRateLimits(): Promise<import('../providers/base/types').RateLimits | null> {
    if (!this.provider) return null;
    return this.provider.localUsage.getRateLimits();
  }

  invalidate(): void {
    this.provider?.localUsage.invalidate();
    this.aggregate = null;
  }

  private async aggregateFromProvider(opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
    dataRetentionDays?: number;
  }): Promise<LocalAggregatedUsage> {
    const empty: LocalAggregatedUsage = {
      tokensToday: 0, tokensOutToday: 0, tokensCacheReadToday: 0, tokensCacheCreateToday: 0,
      costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, tokensOutThisCycle: 0, tokensCacheReadThisCycle: 0, tokensCacheCreateThisCycle: 0,
      costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    };

    if (!this.provider) {
      return empty;
    }

    let unifiedEntries: UnifiedUsageEntry[];
    try {
      unifiedEntries = await this.provider.localUsage.scanSessions(opts);
    } catch (err) {
      log(`Local usage scan error: ${(err as Error).message}`);
      unifiedEntries = [];
    }
    unifiedEntries = unifiedEntries.concat(await this.scanClineUsage());

    const now = Date.now();
    const retentionDays = opts?.dataRetentionDays ?? 365;
    const retentionStart = now - retentionDays * 24 * 3600 * 1000;
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const day24hAgo = now - 24 * 3600 * 1000;
    const window5hStart = opts?.windowResetAtMs ? opts.windowResetAtMs - 5 * 3600 * 1000 : day24hAgo;
    const window7dStart = opts?.weeklyResetAtMs ? opts.weeklyResetAtMs - 7 * 24 * 3600 * 1000 : now - 7 * 24 * 3600 * 1000;
    const cycleStart = opts?.cycleStartMs ?? window7dStart;

    const entries: UsageEntry[] = [];
    const seenMessageIds = new Set<string>();
    const config = ConfigService.getInstance();

    for (const entry of unifiedEntries) {
      // Deduplicate by messageId
      if (entry.messageId) {
        if (seenMessageIds.has(entry.messageId)) continue;
        seenMessageIds.add(entry.messageId);
      }

      // Discard entries older than retention period
      if (entry.timestamp < retentionStart) continue;

      // Calculate cost using provider pricing
      const pricing = this.provider.pricing.getPricing(entry.model ?? this.provider.pricing.defaultModelName);
      const cost = this.provider.pricing.calculateCost({
        inputOther: entry.inputOther,
        output: entry.output,
        inputCacheRead: entry.inputCacheRead,
        inputCacheCreation: entry.inputCacheCreation,
      }, pricing);

      const usageEntry: UsageEntry = {
        timestamp: entry.timestamp,
        inputOther: entry.inputOther,
        output: entry.output,
        inputCacheRead: entry.inputCacheRead,
        inputCacheCreation: entry.inputCacheCreation,
        cost,
        messageId: entry.messageId,
        model: entry.model,
      };

      entries.push(usageEntry);

      // Aggregate by time windows
      const ts = entry.timestamp;
      if (ts >= todayStart) {
        empty.tokensToday += entry.inputOther;
        empty.tokensOutToday += entry.output;
        empty.tokensCacheReadToday += entry.inputCacheRead;
        empty.tokensCacheCreateToday += entry.inputCacheCreation;
        empty.costToday += cost;
        empty.requestsToday++;
      }
      if (ts >= window5hStart) {
        empty.tokensIn5h += entry.inputOther;
        empty.tokensOut5h += entry.output;
        empty.tokensCacheRead5h += entry.inputCacheRead;
        empty.tokensCacheCreate5h += entry.inputCacheCreation;
        empty.cost5h += cost;
        empty.requests5h++;
      }
      if (ts >= window7dStart) {
        empty.tokensIn7d += entry.inputOther;
        empty.tokensOut7d += entry.output;
        empty.tokensCacheRead7d += entry.inputCacheRead;
        empty.tokensCacheCreate7d += entry.inputCacheCreation;
        empty.cost7d += cost;
        empty.requests7d++;
      }
      if (ts >= cycleStart) {
        empty.tokensThisCycle += entry.inputOther;
        empty.tokensOutThisCycle += entry.output;
        empty.tokensCacheReadThisCycle += entry.inputCacheRead;
        empty.tokensCacheCreateThisCycle += entry.inputCacheCreation;
        empty.costThisCycle += cost;
        empty.requestsThisCycle++;
      }
    }

    entries.sort((a, b) => a.timestamp - b.timestamp);
    empty.entries = entries;
    return empty;
  }
}
