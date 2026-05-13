// DESIGN: v2-local-estimation-design.md
// AGENTS: err->try-catch | retention->dataRetentionDays | disk-OK

import { UsageEntry } from '../types';
import { calculateCost } from '../calc';
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
      unifiedEntries = await this.provider.localUsage.scanSessions();
    } catch (err) {
      log(`Local usage scan error: ${(err as Error).message}`);
      return empty;
    }

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
      const pricing = this.provider.pricing.getPricing(entry.model ?? config.defaultModelName);
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

    empty.entries = entries;
    return empty;
  }
}
