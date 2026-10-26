// DESIGN: v2-provider-abstraction.md#codex-api
// AGENTS: err->try-catch | network-fallback | no-disk-IO

import fetch from 'node-fetch';
import { IQuotaApiProvider, ApiResult } from '../base/types';
import { CacheService } from '../../services/cacheService';
import { parseCodexUsage } from '../../calc';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

const USAGE_URL = 'https://chatgpt.com/backend-api/wham/usage';

export class CodexApiProvider implements IQuotaApiProvider {
  constructor(private fetcher: typeof fetch = fetch) {}

  async fetchQuota(token: string): Promise<ApiResult> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const accountId = await CacheService.getInstance().readCodexAccountId();
      const headers: Record<string, string> = {
        Authorization: `Bearer ${token}`, Accept: 'application/json',
        'Cache-Control': 'no-cache', originator: 'codex_vscode_extension',
      };
      if (accountId) headers['chatgpt-account-id'] = accountId;
      const response = await this.fetcher(USAGE_URL, { method: 'GET', headers, signal: controller.signal });
      if (response.status !== 200) {
        return { ok: false, error: t('codex.usageHttpError').replace('{status}', String(response.status)),
          authFailed: response.status === 401 || response.status === 403,
          networkError: response.status >= 500 || response.status === 429 };
      }
      const data = parseCodexUsage(JSON.parse(await response.text()), Date.now());
      return data ? { ok: true, data } : { ok: false, error: t('codex.usageMissing'), networkError: false };
    } catch {
      // Do not log response bodies or credentials. A failed read is never a zero reset.
      return { ok: false, error: t('codex.usageFailed'), networkError: true };
    } finally {
      clearTimeout(timeout);
    }
  }
}
