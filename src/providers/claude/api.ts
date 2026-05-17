// DESIGN: v2-provider-abstraction.md#claude-api
// AGENTS: err->try-catch | network-fallback
// 🔀 Provider boundary: Anthropic API rate-limit headers

import nodeFetch from 'node-fetch';
import { IQuotaApiProvider, ApiResult, UnifiedQuota } from '../base/types';
import { log } from '../../utils';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';

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
  async fetchQuota(token: string): Promise<ApiResult> {
    try {
      log(`Claude API: fetching quota with ${typeof (globalThis as any).fetch === 'function' ? 'native fetch' : 'node-fetch'}`);
      const response = await _fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
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

      const data = this.parseHeaders(response.headers);
      log(`Claude API success: window=${data.windowUsedPct.toFixed(2)}%, weekly=${data.weeklyUsedPct.toFixed(2)}%, reset5h=${data.windowResetAt}, reset7d=${data.weeklyResetAt}`);
      return { ok: true, data };
    } catch (err) {
      const msg = (err as Error).message;
      log(`Claude API exception: ${msg}`);
      const isNetwork = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(msg);
      return { ok: false, error: msg, networkError: isNetwork };
    }
  }

  /** Parse Anthropic reset header into remaining seconds.
   *  Handles: Unix epoch seconds, Unix epoch milliseconds, ISO 8601 strings, relative seconds.
   */
  private parseResetInSeconds(resetStr: string | null | undefined, nowSec: number): number {
    if (!resetStr) { return 0; }
    const num = Number(resetStr);
    if (!isNaN(num) && isFinite(num)) {
      if (num > 1_000_000_000_000) {
        // Milliseconds timestamp
        return Math.max(0, Math.round(num / 1000) - nowSec);
      }
      if (num > 1_000_000_000) {
        // Seconds timestamp (absolute) — round to avoid floating-point underflow
        return Math.max(0, Math.round(num - nowSec));
      }
      // Small number: relative seconds from now
      return Math.max(0, Math.round(num));
    }
    // Try ISO 8601
    const parsed = Date.parse(resetStr);
    if (!isNaN(parsed)) {
      return Math.max(0, Math.round(parsed / 1000) - nowSec);
    }
    return 0;
  }

  private parseHeaders(headers: any): UnifiedQuota {
    const util5hRaw = String(headers.get('anthropic-ratelimit-unified-5h-utilization') ?? '0');
    const util7dRaw = String(headers.get('anthropic-ratelimit-unified-7d-utilization') ?? '0');
    const reset5hStr = headers.get('anthropic-ratelimit-unified-5h-reset');
    const reset7dStr = headers.get('anthropic-ratelimit-unified-7d-reset');
    const status5h = headers.get('anthropic-ratelimit-unified-5h-status');

    const clamp01 = (n: number) => (!isFinite(n) ? 0 : Math.max(0, Math.min(1, n)));
    const util5h = clamp01(parseFloat(util5hRaw));
    const util7d = clamp01(parseFloat(util7dRaw));

    const nowMs = Date.now();
    const nowSec = Math.floor(nowMs / 1000);
    const resetIn5h = this.parseResetInSeconds(reset5hStr, nowSec);
    const resetIn7d = this.parseResetInSeconds(reset7dStr, nowSec);

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
      windowLimit: 100,
      windowUsed: windowUsedPct,
      windowRemaining: Math.max(0, 100 - windowUsedPct),
      windowUsedPct,
      windowResetAt: nowMs + resetIn5h * 1000,
      parallelLimit: 0,
    };
  }
}
