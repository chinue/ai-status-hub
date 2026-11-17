// DESIGN: v2-provider-abstraction.md#kimi-api
// AGENTS: err->try-catch | network-fallback | no-disk-IO
import fetch from 'node-fetch';
import { Agent } from 'https';
import { IQuotaApiProvider, ApiResult } from '../base/types';
import { parseKimiQuota } from '../../calc';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { log } from '../../utils';
import { KimiMembershipApi } from './membershipApi';

const API_URL = 'https://api.kimi.com/coding/v1/usages';

export class KimiApiProvider implements IQuotaApiProvider {
  constructor(private readonly fetcher: typeof fetch = fetch,
    private readonly webToken?: (forceRefresh?: boolean) => Promise<string | undefined>) {}

  async fetchQuota(token: string): Promise<ApiResult> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    let agent: Agent | undefined;
    try {
      agent = new Agent({ rejectUnauthorized: true });
      const response = await this.fetcher(API_URL, {
        method: 'GET', redirect: 'error', agent,
        headers: { Authorization: `Bearer ${token}`, 'User-Agent': 'KimiCLI/1.6', Accept: 'application/json' },
        signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: t('kimi.usageAuthFailed'), authFailed: true };
      }
      if (!response.ok) {
        return { ok: false, error: t('kimi.usageHttpError', response.status),
          networkError: response.status >= 500 || response.status === 429 };
      }
      const data = parseKimiQuota(await response.json());
      if (data && data.monthlyUsedPct === undefined) {
        try {
          const savedWebToken = await this.webToken?.();
          const tokenForWeb = savedWebToken || token;
          const membership = new KimiMembershipApi(this.fetcher);
          let monthly = await membership.fetchMonthly(tokenForWeb);
          if (monthly.authRejected && savedWebToken && this.webToken) {
            const refreshed = await this.webToken(true);
            if (refreshed) monthly = await membership.fetchMonthly(refreshed);
          }
          if (monthly.ok && monthly.data) Object.assign(data, monthly.data);
          log(`Kimi membership monthly fields available=${monthly.ok}`);
        } catch { log('Kimi membership monthly query unavailable.'); }
      }
      if (data) {
        log(`Kimi quota fields: 5h=${data.has5hLimit === true}, 7d=${data.has7dLimit === true}, month_total=${data.monthlyUsedPct !== undefined}, month_code=${data.monthlyCodeUsedPct !== undefined}`);
      }
      return data ? { ok: true, data } : { ok: false, error: t('kimi.usageMissing') };
    } catch {
      return { ok: false, error: t('kimi.usageFailed'), networkError: true };
    } finally {
      clearTimeout(timeout);
      agent?.destroy();
    }
  }
}
