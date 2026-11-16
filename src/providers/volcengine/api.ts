// DESIGN: v2-provider-abstraction.md#volcengine-api
import fetch from 'node-fetch';
import { Agent } from 'https';
import { ApiResult, IQuotaApiProvider } from '../base/types';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { parseVolcengineCodingQuota } from '../../calc';
import { signVolcengineQuotaRequest } from './signing';

export class VolcengineApiProvider implements IQuotaApiProvider {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  async fetchQuota(token: string): Promise<ApiResult> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    let credentials: { accessKeyId: string; secretAccessKey: string };
    try {
      const raw = JSON.parse(token);
      if (typeof raw?.accessKeyId !== 'string' || !raw.accessKeyId.trim()
        || typeof raw?.secretAccessKey !== 'string' || !raw.secretAccessKey.trim()) {
        return { ok: false, error: t('volcengine.quotaCredentialsRequired') };
      }
      credentials = { accessKeyId: raw.accessKeyId.trim(), secretAccessKey: raw.secretAccessKey.trim() };
    } catch { return { ok: false, error: t('volcengine.quotaCredentialsRequired') }; }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let agent: Agent | undefined;
    try {
      const request = signVolcengineQuotaRequest(credentials);
      // Do not inherit NODE_TLS_REJECT_UNAUTHORIZED=0. Keep default hostname/CA checks.
      agent = new Agent({ rejectUnauthorized: true });
      const response = await this.fetcher(request.url, { method: 'POST', body: request.body,
        headers: request.headers, redirect: 'error', signal: controller.signal, agent });
      if (response.status === 401 || response.status === 403) {
        return { ok: false, error: t('volcengine.quotaDenied'), authFailed: true };
      }
      if (response.status !== 200) {
        return { ok: false, error: t('volcengine.quotaHttpError', response.status),
          networkError: response.status >= 500 || response.status === 429 };
      }
      const raw = JSON.parse(await response.text());
      const code = raw?.ResponseMetadata?.Error?.Code;
      if (code) {
        const denied = /access|signature|unauthor|forbidden|credential|auth/i.test(String(code));
        return { ok: false, error: t(denied ? 'volcengine.quotaDenied' : 'volcengine.quotaFailed'), authFailed: denied };
      }
      const data = parseVolcengineCodingQuota(raw);
      return data ? { ok: true, data } : { ok: false, error: t('volcengine.quotaMissing') };
    } catch (error) {
      const code = (error as NodeJS.ErrnoException | null)?.code;
      const certificateError = typeof code === 'string' && [
        'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
        'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'CERT_HAS_EXPIRED', 'ERR_TLS_CERT_ALTNAME_INVALID',
        'CERT_NOT_YET_VALID', 'ERR_TLS_CERT_SIGNATURE_ALGORITHM_UNSUPPORTED',
      ].includes(code);
      return { ok: false, error: t(certificateError ? 'volcengine.quotaTlsError' : 'volcengine.quotaFailed'), networkError: true };
    } finally {
      clearTimeout(timeout);
      agent?.destroy();
    }
  }
}
