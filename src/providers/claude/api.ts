// DESIGN: v2-provider-abstraction.md#claude-api
// AGENTS: err->try-catch | network-fallback
// 🔀 Provider boundary: Anthropic API rate-limit headers

import nodeFetch from 'node-fetch';
import { IQuotaApiProvider, ApiResult, FetchQuotaOptions, UnifiedQuota } from '../base/types';
import { log } from '../../utils';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const REQUEST_TIMEOUT_MS = 30_000;
const USAGE_REQUEST_TIMEOUT_MS = 10_000;
const USAGE_CACHE_TTL_MS = 5 * 60 * 1000;
const DEFAULT_USAGE_RETRY_MS = 5 * 60 * 1000;
const CLAUDE_CODE_USER_AGENT = 'claude-code/2.1.257 (external, ai-status-hub)';

interface HeaderReader {
  get(name: string): string | null;
}

interface UsageWindow {
  usedPct: number;
  resetAt: number;
}

interface OAuthUsageResult {
  quota: UnifiedQuota | null;
  fableWindow: UsageWindow | null;
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && value.trim().length === 0) return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function retryAfterDeadline(value: string | null, now: number): number {
  if (value) {
    const seconds = Number(value);
    if (Number.isFinite(seconds) && seconds > 0) return now + seconds * 1000;
    const absolute = Date.parse(value);
    if (Number.isFinite(absolute) && absolute > now) return absolute;
  }
  return now + DEFAULT_USAGE_RETRY_MS;
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, value));
}

function parseAbsoluteReset(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value > 1_000_000_000_000 ? Math.round(value) : Math.round(value * 1000);
  }
  if (typeof value !== 'string' || value.length === 0) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseUsageWindow(value: unknown, ...percentKeys: Array<'utilization' | 'percent'>): UsageWindow | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const usedPct = percentKeys
    .map(key => finiteNumber(record[key]))
    .find(candidate => candidate != null) ?? null;
  if (usedPct == null) return null;
  const resetAt = parseAbsoluteReset(record.resets_at);
  if (usedPct === 0 && resetAt === 0) return null;
  return { usedPct: clampPercent(usedPct), resetAt };
}

function parseClaudeFableWindow(data: Record<string, unknown>): UsageWindow | null {
  if (!Array.isArray(data.limits)) return null;
  const fableLimit = data.limits.find(item => {
    if (!item || typeof item !== 'object') return false;
    const limit = item as Record<string, unknown>;
    if (limit.kind !== 'weekly_scoped') return false;
    const scope = limit.scope && typeof limit.scope === 'object'
      ? limit.scope as Record<string, unknown>
      : null;
    const model = scope?.model && typeof scope.model === 'object'
      ? scope.model as Record<string, unknown>
      : null;
    const identifiers = [
      model?.display_name,
      model?.id,
      limit.label,
      limit.name,
      limit.display_name,
    ];
    return identifiers.some(value => typeof value === 'string' && value.toLowerCase().includes('fable'));
  });
  return parseUsageWindow(fableLimit, 'percent', 'utilization');
}

/** Parse Claude's OAuth usage payload, including model-scoped Fable weekly limits. */
export function parseClaudeUsageResponse(payload: unknown): UnifiedQuota | null {
  if (!payload || typeof payload !== 'object') return null;
  const data = payload as Record<string, unknown>;
  const limits = Array.isArray(data.limits)
    ? data.limits.filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    : [];
  const findLimit = (kind: string) => limits.find(limit => limit.kind === kind);

  const window5h = parseUsageWindow(data.five_hour, 'utilization')
    ?? parseUsageWindow(findLimit('session'), 'percent');
  const window7d = parseUsageWindow(data.seven_day, 'utilization')
    ?? parseUsageWindow(findLimit('weekly_all'), 'percent');
  if (!window5h || !window7d) return null;

  const fableWindow = parseClaudeFableWindow(data);

  return {
    weeklyLimit: 100,
    weeklyUsed: window7d.usedPct,
    weeklyUsedPct: window7d.usedPct,
    weeklyResetAt: window7d.resetAt,
    ...(fableWindow ? {
      fableWeeklyUsedPct: fableWindow.usedPct,
      ...(fableWindow.resetAt > 0 ? { fableWeeklyResetAt: fableWindow.resetAt } : {}),
    } : {}),
    windowLimit: 100,
    windowUsed: window5h.usedPct,
    windowRemaining: Math.max(0, 100 - window5h.usedPct),
    windowUsedPct: window5h.usedPct,
    windowResetAt: window5h.resetAt,
    parallelLimit: 0,
  };
}

function parseResetInSeconds(resetStr: string | null | undefined, nowSec: number): number {
  if (!resetStr) { return 0; }
  const num = Number(resetStr);
  if (!isNaN(num) && isFinite(num)) {
    if (num > 1_000_000_000_000) {
      return Math.max(0, Math.round(num / 1000) - nowSec);
    }
    if (num > 1_000_000_000) {
      return Math.max(0, Math.round(num - nowSec));
    }
    return Math.max(0, Math.round(num));
  }
  const parsed = Date.parse(resetStr);
  if (!isNaN(parsed)) {
    return Math.max(0, Math.round(parsed / 1000) - nowSec);
  }
  return 0;
}

/** Convert Claude rate-limit response headers into the provider-neutral quota shape. */
export function parseClaudeQuotaHeaders(headers: HeaderReader, nowMs = Date.now()): UnifiedQuota {
  const util5hRaw = String(headers.get('anthropic-ratelimit-unified-5h-utilization') ?? '0');
  const util7dRaw = String(headers.get('anthropic-ratelimit-unified-7d-utilization') ?? '0');
  const fableUtilRaw = headers.get('anthropic-ratelimit-unified-7d_oi-utilization');
  const reset5hStr = headers.get('anthropic-ratelimit-unified-5h-reset');
  const reset7dStr = headers.get('anthropic-ratelimit-unified-7d-reset');
  const fableResetStr = headers.get('anthropic-ratelimit-unified-7d_oi-reset');
  const status5h = headers.get('anthropic-ratelimit-unified-5h-status');

  const clamp01 = (n: number) => (!isFinite(n) ? 0 : Math.max(0, Math.min(1, n)));
  const util5h = clamp01(parseFloat(util5hRaw));
  const util7d = clamp01(parseFloat(util7dRaw));
  const fableUtil = fableUtilRaw == null ? undefined : clamp01(parseFloat(fableUtilRaw));
  const nowSec = Math.floor(nowMs / 1000);
  const resetIn5h = parseResetInSeconds(reset5hStr, nowSec);
  const resetIn7d = parseResetInSeconds(reset7dStr, nowSec);

  let limitStatus: 'allowed' | 'allowed_warning' | 'denied';
  if (status5h === 'denied') {
    limitStatus = 'denied';
  } else if (util5h >= 0.75) {
    limitStatus = 'allowed_warning';
  } else {
    limitStatus = 'allowed';
  }

  const windowUsedPct = util5h * 100;
  const weeklyUsedPct = util7d * 100;
  return {
    weeklyLimit: 100,
    weeklyUsed: weeklyUsedPct,
    weeklyUsedPct,
    weeklyResetAt: nowMs + resetIn7d * 1000,
    ...(fableUtil == null ? {} : {
      fableWeeklyUsedPct: fableUtil * 100,
      ...(fableResetStr == null ? {} : {
        fableWeeklyResetAt: nowMs + parseResetInSeconds(fableResetStr, nowSec) * 1000,
      }),
    }),
    windowLimit: 100,
    windowUsed: windowUsedPct,
    windowRemaining: Math.max(0, 100 - windowUsedPct),
    windowUsedPct,
    windowResetAt: nowMs + resetIn5h * 1000,
    parallelLimit: 0,
  };
}

// VS Code 1.80+ (Node.js 18+) has native fetch; use it when available to avoid
// node-fetch bundling issues. Fallback to node-fetch for older VS Code versions.
const _fetch: typeof nodeFetch =
  typeof (globalThis as any).fetch === 'function'
    ? ((globalThis as any).fetch as typeof nodeFetch)
    : nodeFetch;

export class QuotaExhaustedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QuotaExhaustedError';
  }
}

export class ClaudeApiProvider implements IQuotaApiProvider {
  private usageCache: { token: string; quota: UnifiedQuota; expiresAt: number } | null = null;
  private usageRetry: { token: string; until: number } | null = null;

  constructor(private readonly fetchImpl: typeof nodeFetch = _fetch) {}

  invalidateCache(): void {
    this.usageCache = null;
  }

  async fetchQuota(token: string, options?: FetchQuotaOptions): Promise<ApiResult> {
    if (this.usageCache?.token === token && this.usageCache.expiresAt > Date.now()) {
      return { ok: true, data: this.usageCache.quota };
    }

    const canUseOAuthUsage = options?.credentialType !== 'api-key'
      && !(this.usageRetry?.token === token && this.usageRetry.until > Date.now());
    const usageResult = canUseOAuthUsage ? await this.fetchOAuthUsage(token) : null;
    const usageQuota = usageResult?.quota ?? null;
    if (usageQuota) {
      this.usageCache = { token, quota: usageQuota, expiresAt: Date.now() + USAGE_CACHE_TTL_MS };
      this.usageRetry = null;
      const fablePct = usageQuota.fableWeeklyUsedPct == null
        ? 'n/a'
        : `${usageQuota.fableWeeklyUsedPct.toFixed(2)}%`;
      log(`Claude usage API success: window=${usageQuota.windowUsedPct.toFixed(2)}%, weekly=${usageQuota.weeklyUsedPct.toFixed(2)}%, fable=${fablePct}`);
      return { ok: true, data: usageQuota };
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      log(`Claude API: fetching quota with ${typeof (globalThis as any).fetch === 'function' ? 'native fetch' : 'node-fetch'}`);
      const response = await this.fetchImpl(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: options?.credentialType === 'api-key'
          ? {
              'x-api-key': token,
              'anthropic-version': '2023-06-01',
              'content-type': 'application/json',
            }
          : {
              Authorization: `Bearer ${token}`,
              'anthropic-version': '2023-06-01',
              'anthropic-beta': 'oauth-2025-04-20',
              'content-type': 'application/json',
            },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 1,
          messages: [{ role: 'user', content: '.' }],
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const bodyText = await response.text().catch(() => '');
        log(`Claude API error: HTTP ${response.status}, body=${bodyText.slice(0, 200)}`);
        if (response.status === 403) {
          return { ok: false, error: `Quota exhausted: ${bodyText}`, authFailed: true };
        }
        if (response.status === 401) {
          return { ok: false, error: `HTTP ${response.status}: ${bodyText}`, authFailed: true };
        }
        return { ok: false, error: `Anthropic API returned ${response.status}: ${bodyText}` };
      }

      const data = parseClaudeQuotaHeaders(response.headers);
      if (usageResult?.fableWindow) {
        data.fableWeeklyUsedPct = usageResult.fableWindow.usedPct;
        if (usageResult.fableWindow.resetAt > 0) {
          data.fableWeeklyResetAt = usageResult.fableWindow.resetAt;
        }
        this.usageCache = { token, quota: data, expiresAt: Date.now() + USAGE_CACHE_TTL_MS };
        this.usageRetry = null;
      }
      log(`Claude API success: window=${data.windowUsedPct.toFixed(2)}%, weekly=${data.weeklyUsedPct.toFixed(2)}%, reset5h=${data.windowResetAt}, reset7d=${data.weeklyResetAt}`);
      return { ok: true, data };
    } catch (err) {
      const msg = (err as Error).message;
      log(`Claude API exception: ${msg}`);
      const isNetwork = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|abort/i.test(msg);
      return { ok: false, error: msg, networkError: isNetwork };
    } finally {
      clearTimeout(timeout);
    }
  }

  private async fetchOAuthUsage(token: string): Promise<OAuthUsageResult | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), USAGE_REQUEST_TIMEOUT_MS);
    try {
      const response = await this.fetchImpl(ANTHROPIC_USAGE_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'anthropic-beta': 'oauth-2025-04-20',
          'content-type': 'application/json',
          'user-agent': CLAUDE_CODE_USER_AGENT,
        },
        signal: controller.signal,
      });
      if (!response.ok) {
        if (response.status === 429) {
          this.usageRetry = {
            token,
            until: retryAfterDeadline(response.headers.get('retry-after'), Date.now()),
          };
        }
        log(`Claude usage API unavailable: HTTP ${response.status}; falling back to Messages headers`);
        return null;
      }

      const bodyText = await response.text();
      try {
        const payload = JSON.parse(bodyText);
        if (!payload || typeof payload !== 'object') return null;
        const data = payload as Record<string, unknown>;
        return {
          quota: parseClaudeUsageResponse(data),
          fableWindow: parseClaudeFableWindow(data),
        };
      } catch (err) {
        log(`Claude usage API parse error: ${(err as Error).message}`);
        return null;
      }
    } catch (err) {
      log(`Claude usage API exception: ${(err as Error).message}; falling back to Messages headers`);
      return null;
    } finally {
      clearTimeout(timeout);
    }
  }

}
