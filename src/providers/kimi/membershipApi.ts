// DESIGN: v2-provider-abstraction.md#kimi-web-membership
import fetch from 'node-fetch';
import { Agent } from 'https';
import { QuotaData } from '../../types';
import { parseKimiMembershipUsage } from '../../calc';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

export class KimiMembershipApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async fetchMonthly(token: string): Promise<{ ok: boolean; data?: Partial<QuotaData>; error?: string }> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let agent: Agent | undefined;
    try {
      agent = new Agent({ rejectUnauthorized: true });
      const response = await this.fetcher('https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats', {
        method: 'POST', body: JSON.stringify({ mute_notice: false }),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
          'Connect-Protocol-Version': '1', 'x-msh-platform': 'web', Accept: 'application/json' },
        agent, redirect: 'error', signal: controller.signal,
      });
      if (response.status === 401 || response.status === 403) return { ok: false, error: t('kimi.webAuthRequired') };
      if (!response.ok) return { ok: false, error: t('kimi.webQueryFailed') };
      const data = parseKimiMembershipUsage(await response.json());
      return data ? { ok: true, data } : { ok: false, error: t('kimi.webUsageMissing') };
    } catch { return { ok: false, error: t('kimi.webQueryFailed') }; }
    finally { clearTimeout(timeout); agent?.destroy(); }
  }
}
