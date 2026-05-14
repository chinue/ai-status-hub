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
  resolveResetTime,
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

    const weeklyResetAtMs = resolveResetTime(quota?.weeklyResetAt, 7 * 24 * 3600 * 1000).resetAt;
    const windowResetAtMs = resolveResetTime(quota?.windowResetAt, 5 * 3600 * 1000).resetAt;
    const localUsage = await this.localUsageService.getLocalUsage({
      weeklyResetAtMs,
      windowResetAtMs,
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

    // When calibration is unavailable and there is no API quota at all,
    // fall back to real-time rate limits from local session files.
    // We only do this when API is completely missing; otherwise stale local
    // rate_limits can drift behind the actual API value.
    const rateLimits = !quota ? await this.localUsageService.getRateLimits() : null;
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
    // Guard: when an API quota exists, only overwrite if the calibrated estimate
    // is within 5 percentage points of the API value. This prevents severe drift
    // when local session files don't reflect all usage (e.g. other devices,
    // VS Code Copilot Chat, etc.).
    const PCT_THRESHOLD = 5;
    if (weeklyPct !== null) {
      if (!quota || Math.abs(weeklyPct - quota.weeklyUsedPct) <= PCT_THRESHOLD) {
        payload.weeklyPct = weeklyPct;
      }
    } else if (weeklyPctLocal !== undefined) {
      payload.weeklyPct = weeklyPctLocal;
    }

    if (windowPct !== null) {
      if (!quota || Math.abs(windowPct - quota.windowUsedPct) <= PCT_THRESHOLD) {
        payload.windowPct = windowPct;
      }
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
      // Local rate_limits are temporary fallback only; do NOT persist to cache
      // because they can be severely stale (e.g. other devices, old sessions).
      await this.processQuotaData(quotaData, now, 'local-only', false);
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

    // Even without API or local rate_limits, still scan local session files
    // so the user sees usage data (tokens, cost, entries) in the status bar.
    // This is especially important for providers like Claude whose JSONL
    // does not contain rate_limits — without this, the UI stays blank.
    const localUsageFallback = await this.localUsageService.getLocalUsage({
      dataRetentionDays: this.config.dataRetentionDays,
    });
    if (localUsageFallback.entries.length > 0) {
      this.store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          cost5h: localUsageFallback.cost5h,
          cost7d: localUsageFallback.cost7d,
          costToday: localUsageFallback.costToday,
          requestsToday: localUsageFallback.requestsToday,
          tokensToday: localUsageFallback.tokensToday,
          tokensOutToday: localUsageFallback.tokensOutToday,
          tokensCacheReadToday: localUsageFallback.tokensCacheReadToday,
          tokensCacheCreateToday: localUsageFallback.tokensCacheCreateToday,
          tokensIn5h: localUsageFallback.tokensIn5h,
          tokensOut5h: localUsageFallback.tokensOut5h,
          tokensCacheRead5h: localUsageFallback.tokensCacheRead5h,
          tokensCacheCreate5h: localUsageFallback.tokensCacheCreate5h,
          requests5h: localUsageFallback.requests5h,
          tokensIn7d: localUsageFallback.tokensIn7d,
          tokensOut7d: localUsageFallback.tokensOut7d,
          tokensCacheRead7d: localUsageFallback.tokensCacheRead7d,
          tokensCacheCreate7d: localUsageFallback.tokensCacheCreate7d,
          requests7d: localUsageFallback.requests7d,
          tokensThisCycle: localUsageFallback.tokensThisCycle,
          tokensOutThisCycle: localUsageFallback.tokensOutThisCycle,
          tokensCacheReadThisCycle: localUsageFallback.tokensCacheReadThisCycle,
          tokensCacheCreateThisCycle: localUsageFallback.tokensCacheCreateThisCycle,
          costThisCycle: localUsageFallback.costThisCycle,
          requestsThisCycle: localUsageFallback.requestsThisCycle,
          entries: localUsageFallback.entries,
        },
      });
    }

    const cached = await this.cacheService.read();
    if (cached) {
      this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota, fetchedAt: cached.fetchedAt });
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
    persistToCache: boolean = true,
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

    if (persistToCache) {
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
    }

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
    // Local jsonl uses resets_at (absolute Unix timestamp in seconds);
    // API headers use resets_in_seconds (relative). Prefer resets_at.
    const windowResetAt = primary?.resets_at
      ? primary.resets_at * 1000
      : now + (primary?.resets_in_seconds ?? 5 * 3600) * 1000;
    const weeklyResetAt = secondary?.resets_at
      ? secondary.resets_at * 1000
      : now + (secondary?.resets_in_seconds ?? 7 * 24 * 3600) * 1000;
    const weeklyUsedPct = secondary?.used_percent ?? 0;
    const windowUsedPct = primary?.used_percent ?? 0;
    return {
      weeklyLimit: 100,
      weeklyUsed: weeklyUsedPct,
      weeklyUsedPct,
      weeklyResetAt,
      windowLimit: 100,
      windowUsed: windowUsedPct,
      windowRemaining: Math.max(0, 100 - windowUsedPct),
      windowUsedPct,
      windowResetAt,
      parallelLimit: 0,
    };
  }
}
