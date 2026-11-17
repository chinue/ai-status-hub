// DESIGN: v2-provider-abstraction.md#deepseek-web-billing
import fetch from 'node-fetch';
import { Agent } from 'https';
import { DeepseekBilling } from '../../types';
import { parseDeepseekWebSummary, parseDeepseekRecharge } from '../../calc';
import { makeT } from '../../i18n';
import { ConfigService } from '../../config';

export class DeepseekWebApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async fetchBilling(token: string, currency: 'CNY' | 'USD'): Promise<{ ok: boolean; data?: DeepseekBilling; error?: string }> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15_000);
    let agent: Agent | undefined;
    try {
      agent = new Agent({ rejectUnauthorized: true });
      const read = async (path: string): Promise<unknown> => {
        try {
          const response = await this.fetcher('https://platform.deepseek.com' + path, {
            method: 'GET', headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' },
            redirect: 'error', agent, signal: controller.signal,
          });
          return response.ok ? await response.json() : null;
        } catch { return null; }
      };
      const [summary, invoices] = await Promise.all([read('/api/v0/users/get_user_summary'), read('/auth-api/v0/users/get_all_invoice')]);
      const data = parseDeepseekWebSummary(summary, currency);
      if (!data) return { ok: false, error: t('deepseek.webQueryFailed') };
      const recharge = parseDeepseekRecharge(invoices, currency);
      if (recharge) Object.assign(data, recharge);
      return { ok: true, data, error: recharge ? undefined : t('deepseek.webRechargeMissing') };
    } catch { return { ok: false, error: t('deepseek.webQueryFailed') }; }
    finally { clearTimeout(timer); agent?.destroy(); }
  }
}
