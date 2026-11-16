// DESIGN: v2-provider-abstraction.md#deepseek-provider
import fetch from 'node-fetch';
import { Agent } from 'https';
import { ApiResult, IQuotaApiProvider } from '../base/types';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { parseDeepseekBalance } from '../../calc';

export class DeepseekApiProvider implements IQuotaApiProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async fetchQuota(token: string): Promise<ApiResult> {
    const config = ConfigService.getInstance();
    const t = makeT(config.effectiveLanguage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let agent: Agent | undefined;
    try {
      agent = new Agent({ rejectUnauthorized: true });
      const response = await this.fetcher('https://api.deepseek.com/user/balance', {
        method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
        redirect: 'error', agent, signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return { ok: false, authFailed: true, error: t('deepseek.authFailed') };
      if (!response.ok) return { ok: false, networkError: response.status >= 500 || response.status === 429,
        error: t('deepseek.httpError', response.status) };
      const data = parseDeepseekBalance(await response.json(), config.currencyForProvider('deepseek').code);
      return data ? { ok: true, data } : { ok: false, error: t('deepseek.balanceMissing') };
    } catch {
      return { ok: false, networkError: true, error: t('deepseek.queryFailed') };
    } finally { clearTimeout(timeout); agent?.destroy(); }
  }
}
