// DESIGN: v2-provider-abstraction.md#glm-provider
import fetch from 'node-fetch';
import { ApiResult, IQuotaApiProvider } from '../base/types';
import { parseGlmQuota } from '../../calc';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

const QUOTA_URL = 'https://open.bigmodel.cn/api/monitor/usage/quota/limit';

export class GlmApiProvider implements IQuotaApiProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchQuota(token: string): Promise<ApiResult> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await this.fetcher(QUOTA_URL, { method: 'GET', redirect: 'error',
        headers: { Authorization: token, Accept: 'application/json', 'Cache-Control': 'no-cache' },
        signal: controller.signal });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: t('glm.invalidKey'), authFailed: true };
      }
      if (response.status !== 200) {
        return { ok: false, error: t('glm.httpError', response.status),
          networkError: response.status >= 500 || response.status === 429 };
      }
      const raw = JSON.parse(await response.text());
      const code = String(raw?.code ?? raw?.error?.code ?? '');
      if (['401', '403', '1000', '1001', '1002', '1003', '1004'].includes(code)) {
        return { ok: false, error: t('glm.invalidKey'), authFailed: true };
      }
      const data = parseGlmQuota(raw);
      return data ? { ok: true, data } : { ok: false, error: t('glm.noQuota'), networkError: false };
    } catch {
      // Never expose credentials, server messages or request/response bodies.
      return { ok: false, error: t('glm.queryFailed'), networkError: true };
    } finally { clearTimeout(timeout); }
  }
}
