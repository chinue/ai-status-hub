// DESIGN: v2-phase2-implementation.md#servicesschedulerts
// AGENTS: fmt->calc.ts | err->try-catch | no-disk-IO
// 💠 Generic: scheduler logic is provider-agnostic.

import { Store } from '../store';
import { IAuthProvider, IQuotaApiProvider, RateLimits } from '../providers/base/types';
import { CacheService } from './cacheService';
import { LocalUsageService } from './localUsageService';
import { ConfigService } from '../config';
import { log } from '../utils';
import {
  calibrateTokenCapacity,
  calibrateWindowCostCapacity,
  estimateWeeklyPct,
  estimateWindowPct,
  fallbackWeeklyPct,
  fallbackWindowPct,
  isCalibrationValid,
} from '../calc';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLongTick = 0;
  private readonly config = ConfigService.getInstance();

  private get longMs(): number {
    return this.config.refreshIntervalSeconds * 1000;
  }

  constructor(
    private store: Store,
    private authService: IAuthProvider,
    private apiService: IQuotaApiProvider,
    private cacheService: CacheService,
    private localUsageService: LocalUsageService,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Ensure first tick is a long tick so we fetch API data immediately
    this.lastLongTick = Date.now() - this.longMs;
    // First tick immediately (fetch API data as soon as possible)
    this.schedule(Date.now());
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Manual refresh: force a long tick (API fetch) immediately. */
  force(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    // Reset lastLongTick so the next tick is guaranteed to be a long tick
    this.lastLongTick = Date.now() - this.longMs;
    this.schedule(Date.now() + 50);
  }

  private schedule(at: number): void {
    if (!this.running) return;
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const isLong = now - this.lastLongTick >= this.longMs;

    try {
      if (isLong) {
        await this.doLongTick();
        this.lastLongTick = now;
      } else {
        await this.doShortTick();
      }
    } catch (err) {
      log(`Scheduler tick error: ${err}`);
    }

    // Schedule next tick: whichever comes first (short or long)
    const nextLong = this.lastLongTick + this.longMs;
    const nextShort = now + this.config.shortRefreshIntervalSeconds * 1000;
    this.schedule(Math.min(nextLong, nextShort));
  }

  private async doShortTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    const state = this.store.getState();
    const quota = state.quota;

    const localUsage = await this.localUsageService.getLocalUsage({
      weeklyResetAtMs: quota?.weeklyResetAt,
      windowResetAtMs: quota?.windowResetAt,
      dataRetentionDays: this.config.dataRetentionDays,
    });

    // Skip short tick when no local data is available to avoid overwriting
    // API percentages with zeros.
    if (localUsage.entries.length === 0) {
      return;
    }

    const calibration = state.localEstimate
      ? {
          tokenCapacity: state.localEstimate.tokenCapacity,
          windowCostCapacity: state.localEstimate.windowCostCapacity,
          calibratedAt: state.localEstimate.calibratedAt ?? 0,
          resetAt: quota?.weeklyResetAt ?? 0,
        }
      : null;

    const tokenCapacity = isCalibrationValid(calibration, quota?.weeklyResetAt ?? null)
      ? calibration!.tokenCapacity
      : null;
    const windowCostCapacity = isCalibrationValid(
      calibration ? { ...calibration, resetAt: quota?.windowResetAt ?? 0 } : null,
      quota?.windowResetAt ?? null,
    )
      ? calibration!.windowCostCapacity
      : null;

    // Only compute percentages when calibration is valid. Codex doesn't expose
    // absolute limits, so fallback functions return 0 when capacity is missing.
    // Avoid overwriting API percentages with zeros during short ticks.
    const weeklyPct = tokenCapacity && tokenCapacity > 0
      ? (estimateWeeklyPct(localUsage.tokensThisCycle, tokenCapacity)
        ?? fallbackWeeklyPct(localUsage.tokensThisCycle, quota?.weeklyLimit ?? null))
      : null;
    const windowPct = windowCostCapacity && windowCostCapacity > 0
      ? (estimateWindowPct(localUsage.cost5h, windowCostCapacity)
        ?? fallbackWindowPct(localUsage.cost5h, quota?.windowLimit ?? null))
      : null;

    // When calibration is unavailable, fall back to real-time rate limits from local
    // session files (same approach as codex-ratelimit-vscode).
    const rateLimits = await this.localUsageService.getRateLimits();
    const weeklyPctLocal = rateLimits?.secondary?.used_percent;
    const windowPctLocal = rateLimits?.primary?.used_percent;

    const payload: any = {
      cost5h: localUsage.cost5h,
      cost7d: localUsage.cost7d,
      costToday: localUsage.costToday,
      // Full detail for tooltip / dashboard (from memory, no disk access)
      requestsToday: localUsage.requestsToday,
      tokensToday: localUsage.tokensToday,
      tokensIn5h: localUsage.tokensIn5h,
      tokensOut5h: localUsage.tokensOut5h,
      tokensCacheRead5h: localUsage.tokensCacheRead5h,
      tokensCacheCreate5h: localUsage.tokensCacheCreate5h,
      requests5h: localUsage.requests5h,
      tokensIn7d: localUsage.tokensIn7d,
      tokensOut7d: localUsage.tokensOut7d,
      tokensCacheRead7d: localUsage.tokensCacheRead7d,
      tokensCacheCreate7d: localUsage.tokensCacheCreate7d,
      requests7d: localUsage.requests7d,
      tokensThisCycle: localUsage.tokensThisCycle,
      costThisCycle: localUsage.costThisCycle,
      requestsThisCycle: localUsage.requestsThisCycle,
      // entries omitted in short tick to avoid unnecessary state churn every 5s
    };

    // Prefer calibration estimates when valid; otherwise use local rate limits.
    if (weeklyPct !== null) {
      payload.weeklyPct = weeklyPct;
    } else if (weeklyPctLocal !== undefined) {
      payload.weeklyPct = weeklyPctLocal;
    }

    if (windowPct !== null) {
      payload.windowPct = windowPct;
    } else if (windowPctLocal !== undefined) {
      payload.windowPct = windowPctLocal;
    }

    // When we have local rate limits but no API calibration yet,
    // set a synthetic calibratedAt so resolveWeeklyPct uses these values.
    if ((weeklyPct === null && weeklyPctLocal !== undefined) || (windowPct === null && windowPctLocal !== undefined)) {
      payload.calibratedAt = Date.now();
    }

    this.store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload,
    });
  }

  private async doLongTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    this.store.dispatch({ type: 'LOADING_START' });
    const now = Date.now();

    // ── Step 1: try API first ────────────────────────────────────────────────
    const token = await this.authService.resolveToken();
    let apiResult: import('../providers/base/types').ApiResult | null = null;

    if (token) {
      try {
        apiResult = await this.apiService.fetchQuota(token);
      } catch {
        apiResult = null;
      }
    }

    // ── Step 2: API success ──────────────────────────────────────────────────
    if (apiResult && apiResult.ok && apiResult.data) {
      await this.processQuotaData(apiResult.data, now, 'api');
      this.store.dispatch({ type: 'LOADING_END' });
      return;
    }

    // ── Step 3: API failed → fallback to local JSONL rate_limits ────────────
    const rateLimits = await this.localUsageService.getRateLimits();
    let quotaData: import('../types').QuotaData | null = null;
    if (rateLimits?.primary || rateLimits?.secondary) {
      quotaData = this.rateLimitsToQuota(rateLimits, now);
    }

    if (quotaData) {
      await this.processQuotaData(quotaData, now, 'local-only');
      this.store.dispatch({ type: 'LOADING_END' });
      return;
    }

    // ── Step 4: both failed ──────────────────────────────────────────────────
    const apiError = apiResult?.error ?? 'No API data and no local rate limits available.';
    this.store.dispatch({
      type: 'API_ERROR',
      payload: {
        error: apiError,
        authFailed: apiResult?.authFailed ?? false,
        networkError: apiResult?.networkError ?? false,
      },
    });

    const cached = await this.cacheService.read();
    if (cached) {
      this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
      if (cached.calibration) {
        this.store.dispatch({
          type: 'LOCAL_ESTIMATE',
          payload: {
            tokenCapacity: cached.calibration.tokenCapacity,
            windowCostCapacity: cached.calibration.windowCostCapacity,
            calibratedAt: cached.calibration.calibratedAt,
          },
        });
      }
    }

    this.store.dispatch({ type: 'LOADING_END' });
  }

  private async processQuotaData(
    quotaData: import('../types').QuotaData,
    now: number,
    source: import('../types').DataSource,
  ): Promise<void> {
    const oldQuota = this.store.getState().quota;

    const localUsage = await this.localUsageService.getLocalUsage({
      weeklyResetAtMs: quotaData.weeklyResetAt,
      windowResetAtMs: quotaData.windowResetAt,
      dataRetentionDays: this.config.dataRetentionDays,
    });

    // Smoothing: preserve fine-grained local estimate when rounded value matches
    const currentEstimate = this.store.getState().localEstimate;
    let weeklyPct = quotaData.weeklyUsedPct;
    let windowPct = quotaData.windowUsedPct;
    if (currentEstimate) {
      if (Math.round(currentEstimate.weeklyPct) === quotaData.weeklyUsedPct) {
        weeklyPct = currentEstimate.weeklyPct;
      }
      if (Math.round(currentEstimate.windowPct) === quotaData.windowUsedPct) {
        windowPct = currentEstimate.windowPct;
      }
    }
    if (oldQuota && Math.round(oldQuota.weeklyUsedPct) === quotaData.weeklyUsedPct && weeklyPct === quotaData.weeklyUsedPct) {
      weeklyPct = oldQuota.weeklyUsedPct;
    }
    if (oldQuota && Math.round(oldQuota.windowUsedPct) === quotaData.windowUsedPct && windowPct === quotaData.windowUsedPct) {
      windowPct = oldQuota.windowUsedPct;
    }

    const tokenCapacity = calibrateTokenCapacity(weeklyPct, localUsage.tokensThisCycle);
    const windowCostCapacity = calibrateWindowCostCapacity(windowPct, localUsage.cost5h);

    await this.cacheService.write({
      quota: quotaData,
      fetchedAt: now,
      calibration: {
        tokenCapacity,
        windowCostCapacity,
        calibratedAt: now,
        reset5hAt: quotaData.windowResetAt,
        reset7dAt: quotaData.weeklyResetAt,
      },
    });

    this.store.dispatch({ type: 'API_SUCCESS', payload: quotaData, source });
    this.store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct,
        windowPct,
        tokenCapacity,
        windowCostCapacity,
        calibratedAt: now,
        cost5h: localUsage.cost5h,
        cost7d: localUsage.cost7d,
        costToday: localUsage.costToday,
        requestsToday: localUsage.requestsToday,
        tokensToday: localUsage.tokensToday,
        tokensOutToday: localUsage.tokensOutToday,
        tokensCacheReadToday: localUsage.tokensCacheReadToday,
        tokensCacheCreateToday: localUsage.tokensCacheCreateToday,
        tokensIn5h: localUsage.tokensIn5h,
        tokensOut5h: localUsage.tokensOut5h,
        tokensCacheRead5h: localUsage.tokensCacheRead5h,
        tokensCacheCreate5h: localUsage.tokensCacheCreate5h,
        requests5h: localUsage.requests5h,
        tokensIn7d: localUsage.tokensIn7d,
        tokensOut7d: localUsage.tokensOut7d,
        tokensCacheRead7d: localUsage.tokensCacheRead7d,
        tokensCacheCreate7d: localUsage.tokensCacheCreate7d,
        requests7d: localUsage.requests7d,
        tokensThisCycle: localUsage.tokensThisCycle,
        tokensOutThisCycle: localUsage.tokensOutThisCycle,
        tokensCacheReadThisCycle: localUsage.tokensCacheReadThisCycle,
        tokensCacheCreateThisCycle: localUsage.tokensCacheCreateThisCycle,
        costThisCycle: localUsage.costThisCycle,
        requestsThisCycle: localUsage.requestsThisCycle,
        entries: localUsage.entries,
      },
    });
  }

  private rateLimitsToQuota(rateLimits: RateLimits, now: number): import('../types').QuotaData {
    const primary = rateLimits.primary;
    const secondary = rateLimits.secondary;
    const windowResetSec = primary?.resets_in_seconds ?? 5 * 3600;
    const weeklyResetSec = secondary?.resets_in_seconds ?? 7 * 24 * 3600;
    return {
      weeklyLimit: 0,
      weeklyUsed: 0,
      weeklyUsedPct: secondary?.used_percent ?? 0,
      weeklyResetAt: now + weeklyResetSec * 1000,
      windowLimit: 0,
      windowUsed: 0,
      windowRemaining: 0,
      windowUsedPct: primary?.used_percent ?? 0,
      windowResetAt: now + windowResetSec * 1000,
      parallelLimit: 0,
    };
  }
}
