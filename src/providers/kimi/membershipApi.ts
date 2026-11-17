// DESIGN: v2-provider-abstraction.md#kimi-web-membership
import fetch from 'node-fetch';
import { Agent } from 'https';
import { QuotaData } from '../../types';
import { parseKimiMembershipUsage } from '../../calc';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { log } from '../../utils';

export class KimiMembershipApi {
  constructor(private readonly fetcher: typeof fetch = fetch) {}
  async refreshToken(token: string): Promise<{ accessToken: string; refreshToken: string } | undefined> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    let agent: Agent | undefined;
    try {
      agent = new Agent({ rejectUnauthorized: true });
      const response = await this.fetcher('https://auth.kimi.com/api/account.gateway.v1.AuthService/RefreshToken', {
        method: 'POST', body: JSON.stringify({ refresh_token: token }),
        headers: { 'Content-Type': 'application/json', 'Connect-Protocol-Version': '1',
          'x-msh-platform': 'web', Accept: 'application/json' },
        agent, redirect: 'error', signal: controller.signal,
      });
      if (!response.ok) {
        log(`Kimi membership renewal failed: HTTP ${response.status}`);
        return undefined;
      }
      const data = await response.json() as Record<string, unknown> | null;
      const access = data?.access_token ?? data?.accessToken;
      const refresh = data?.refresh_token ?? data?.refreshToken;
      if (typeof access !== 'string' || !access.trim() || typeof refresh !== 'string' || !refresh.trim()) return undefined;
      return { accessToken: access.trim(), refreshToken: refresh.trim() };
    } catch { log('Kimi membership renewal unavailable.'); return undefined; }
    finally { clearTimeout(timeout); agent?.destroy(); }
  }
  async fetchMonthly(token: string): Promise<{ ok: boolean; data?: Partial<QuotaData>; error?: string; authRejected?: boolean }> {
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
      if (response.status === 401 || response.status === 403) return { ok: false, error: t('kimi.webAuthRequired'), authRejected: response.status === 401 };
      if (!response.ok) return { ok: false, error: t('kimi.webQueryFailed') };
      const data = parseKimiMembershipUsage(await response.json());
      return data ? { ok: true, data } : { ok: false, error: t('kimi.webUsageMissing') };
    } catch { return { ok: false, error: t('kimi.webQueryFailed') }; }
    finally { clearTimeout(timeout); agent?.destroy(); }
  }
}
