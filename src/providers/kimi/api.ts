// DESIGN: v2-provider-abstraction.md#kimi-api
// AGENTS: err->try-catch | network-fallback
// 🔀 Provider boundary: API format is Kimi-specific.

import fetch from 'node-fetch';
import { IQuotaApiProvider, ApiResult, UnifiedQuota } from '../base/types';

const API_URL = 'https://api.kimi.com/coding/v1/usages';

export class KimiApiProvider implements IQuotaApiProvider {
  async fetchQuota(token: string): Promise<ApiResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
      const resp = await fetch(API_URL, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'KimiCLI/1.6',
          Accept: 'application/json',
        },
        signal: controller.signal,
      });

      if (resp.status === 401 || resp.status === 403) {
        return { ok: false, error: `HTTP ${resp.status}`, authFailed: true };
      }
      if (!resp.ok) {
        return { ok: false, error: `HTTP ${resp.status}` };
      }

      const json = await resp.json();
      const data = this.parseResponse(json);
      return { ok: true, data };
    } catch (err) {
      const msg = (err as Error).message;
      const isNetwork = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|abort/i.test(msg);
      return { ok: false, error: msg, networkError: isNetwork };
    } finally {
      clearTimeout(timeout);
    }
  }

  private parseResponse(json: any): UnifiedQuota {
    const usage = json.usage ?? {};
    const win = json.limits?.[0]?.detail ?? {};

    const weeklyLimit = toInt(usage.limit);
    const weeklyUsed = toInt(usage.used);
    const windowLimit = toInt(win.limit);
    const windowUsed = toInt(win.used);

    return {
      weeklyLimit,
      weeklyUsed,
      weeklyUsedPct: pctOrCompute(usage.used_pct, weeklyUsed, weeklyLimit),
      weeklyResetAt: toMs(usage.resetTime),
      windowLimit,
      windowUsed,
      windowRemaining: toInt(win.remaining),
      windowUsedPct: pctOrCompute(win.used_pct, windowUsed, windowLimit),
      windowResetAt: toMs(win.resetTime),
      parallelLimit: toInt(json.parallel?.limit),
    };
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

function pctOrCompute(pct: any, used: number, limit: number): number {
  if (typeof pct === 'number' && !isNaN(pct)) return Math.min(100, Math.max(0, pct));
  if (typeof pct === 'string') {
    const n = parseFloat(pct);
    if (!isNaN(n)) return Math.min(100, Math.max(0, n));
  }
  if (limit > 0) return Math.min(100, Math.max(0, (used / limit) * 100));
  return 0;
}

function toMs(v: any): number {
  if (typeof v === 'number') {
    return v < 1e12 ? v * 1000 : v;
  }
  if (typeof v === 'string') {
    const d = new Date(v);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  }
  return 0;
}
