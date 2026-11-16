import { expect } from 'chai';
import * as sinon from 'sinon';
import { KimiApiProvider } from '../src/providers/kimi/api';
import { parseKimiQuota, formatProviderStatus } from '../src/calc';
import { defaultState, Store } from '../src/store';
import { DashboardPanel } from '../src/presenters/dashboard';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { Script } from 'vm';

const reset = '2026-12-16T05:00:00Z';
const modern = () => ({ goods_version: 2, usages: {
  limit_5h: { used_ratio: 0.3, reset_time: reset },
  limit_month_total: { used_ratio: 0.42, reset_time: reset },
  limit_month_code: { used_ratio: 0.18, reset_time: reset },
} });

describe('Kimi monthly usage', () => {
  afterEach(() => sinon.restore());

  it('parses the official monthly shared and coding pools without inventing a weekly limit', () => {
    expect(parseKimiQuota(modern())).to.include({ windowUsedPct: 30, monthlyUsedPct: 42,
      monthlyCodeUsedPct: 18, monthlyResetAt: Date.parse(reset), monthlyCodeResetAt: Date.parse(reset),
      has5hLimit: true, has7dLimit: false, percentOnly: true });
  });

  it('preserves legacy counts and finds the five-hour window by duration rather than position', () => {
    const payload = { usage: { limit: '100', used: '25', resetTime: reset }, limits: [
      { window: { duration: 10080, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '100', used: '25' } },
      { window: { duration: 300, timeUnit: 'TIME_UNIT_MINUTE' }, detail: { limit: '80', remaining: '60', resetTime: reset } },
    ], usages: { limit_7d: { used_ratio: 0 }, limit_month_total: { used_ratio: 0.5, reset_time: reset } } };
    expect(parseKimiQuota(payload)).to.include({ weeklyUsedPct: 25, windowUsedPct: 25,
      windowUsed: 20, windowRemaining: 60, monthlyUsedPct: 50, percentOnly: false });
    expect(parseKimiQuota({ usage: { limit: 100, used: 5 }, limits: [
      { detail: { limit: 20, used: 2, remaining: 18 } },
    ] })).to.include({ weeklyUsedPct: 5, windowUsedPct: 10, has7dLimit: true });
  });

  it('keeps valid zero values, clamps overages and ignores invalid monthly fields', () => {
    for (const invalid of [null, '', 'broken', -0.1, Infinity, NaN]) {
      const payload: any = modern();
      payload.usages.limit_month_total.used_ratio = invalid;
      expect(parseKimiQuota(payload)?.monthlyUsedPct).to.equal(undefined);
      expect(parseKimiQuota(payload)?.monthlyCodeUsedPct).to.equal(18);
    }
    const payload: any = modern();
    payload.usages.limit_month_total = { used_ratio: '0', reset_time: 'invalid' };
    payload.usages.limit_month_code = { used_ratio: '1.2' };
    expect(parseKimiQuota(payload)).to.include({ monthlyUsedPct: 0, monthlyCodeUsedPct: 100, monthlyResetAt: 0 });
  });

  it('does not confuse a booster spending budget with monthly plan usage', () => {
    const quota = parseKimiQuota({ usages: { limit_5h: { used_ratio: 0.1 } },
      boosterWallet: { monthlyUsed: 50, monthlyChargeLimit: 100 } })!;
    expect(quota.monthlyUsedPct).to.equal(undefined);
    expect(quota.monthlyCodeUsedPct).to.equal(undefined);
    for (const raw of [null, {}, { usages: {} }, { usage: { limit: 0, used: 0 } }]) {
      expect(parseKimiQuota(raw)).to.equal(null);
    }
  });

  it('supports monthly-only responses and clears absent pools on later snapshots', () => {
    const quota = parseKimiQuota({ usages: { limit_month_total: { used_ratio: 0.4 } } })!;
    expect(quota).to.include({ monthlyUsedPct: 40, has5hLimit: false, has7dLimit: false });
    expect(formatProviderStatus({ ...defaultState(), activeProvider: 'kimi', quota }, '', 'Kimi', 'percent')).to.include('40.00%');
    const store = new Store();
    store.dispatch({ type: 'API_SUCCESS', payload: parseKimiQuota(modern())! });
    store.dispatch({ type: 'API_SUCCESS', payload: parseKimiQuota({ usages: { limit_5h: { used_ratio: 0.1 } } })! });
    expect(store.getState().quota?.monthlyUsedPct).to.equal(undefined);
  });

  it('fetches monthly data using the existing token with verified TLS and no redirect', async () => {
    const fetcher = sinon.stub().resolves({ status: 200, ok: true, json: async () => modern() });
    const result = await new KimiApiProvider(fetcher as any).fetchQuota('test-token');
    expect(result.ok).to.equal(true);
    expect(result.data?.monthlyUsedPct).to.equal(42);
    expect(fetcher.firstCall.args[0]).to.equal('https://api.kimi.com/coding/v1/usages');
    expect(fetcher.firstCall.args[1].headers.Authorization).to.equal('Bearer test-token');
    expect(fetcher.firstCall.args[1].redirect).to.equal('error');
    expect(fetcher.firstCall.args[1].agent.options.rejectUnauthorized).to.equal(true);
  });

  it('returns errors without claiming zero quota or exposing private failures', async () => {
    for (const response of [
      { status: 401 }, { status: 403 }, { status: 500 },
      { status: 200, ok: true, json: async () => ({}) },
      { status: 200, ok: true, json: async () => { throw new Error('private-test-token'); } },
    ]) {
      const result = await new KimiApiProvider((async () => response) as any).fetchQuota('private-test-token');
      expect(result.ok).to.equal(false);
      expect(JSON.stringify(result)).not.to.include('private-test-token');
    }
  });

  it('shows both monthly pools in the dashboard and status-bar tooltip', async () => {
    const quota = parseKimiQuota(modern())!;
    const state = { ...defaultState(), activeProvider: 'kimi', quota };
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
    expect(usage.utilizationMonth).to.equal(0.42);
    expect(usage.utilizationCodeMonth).to.equal(0.18);
    expect(usage.hasMonthlyCodeLimit).to.equal(true);
    const html = (DashboardPanel.prototype as any).getHtml.call({ store: { getState: () => state } }, 'nonce', 'en');
    expect(html).to.include('Membership monthly pool');
    expect(html).to.include('Kimi Code monthly pool');
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'kimi' });
    store.dispatch({ type: 'API_SUCCESS', payload: quota });
    const presenter = new StatusBarPresenter(store);
    try {
      const tooltip = (await (presenter as any).buildTooltip(store.getState())).value;
      expect(tooltip).to.include('Membership monthly pool');
      expect(tooltip).to.include('42.00%');
      expect(tooltip).to.include('Kimi Code monthly pool');
      expect(tooltip).to.include('18.00%');
    } finally { presenter.dispose(); }
  });

  it('keeps a visible monthly section when a legacy or cached snapshot has no monthly data', async () => {
    const quota = parseKimiQuota({ usage: { limit: 100, used: 20 },
      limits: [{ detail: { limit: 100, used: 1, remaining: 99 } }] })!;
    const state = { ...defaultState(), activeProvider: 'kimi', quota };
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
    expect(usage.monthlyUnavailableText).to.be.a('string').and.not.to.equal('');
    const html = (DashboardPanel.prototype as any).getHtml.call({ store: { getState: () => state } }, 'nonce', 'en');
    expect(html).to.include('id="row-plan-month" style=""');
    expect(html).to.include('https://www.kimi.com/settings/subscription?tab=quota');
    const nodes = new Map<string, any>();
    const document = { getElementById: (id: string) => {
      if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '' });
      return nodes.get(id);
    } };
    const script = html.slice(html.indexOf("      const weeklyRow ="), html.indexOf("      const fableRow ="));
    new Script(script).runInNewContext({ document, usage });
    expect(nodes.get('row-plan-month').style.display).to.equal('');
    expect(nodes.get('lbl-plan-month').textContent).to.equal('—');
    expect(nodes.get('meta-plan-month').textContent).to.equal(usage.monthlyUnavailableText);
    expect(nodes.get('month-unavailable-link').style.display).to.equal('');
    const available = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, { ...state, quota: parseKimiQuota(modern())! });
    new Script(script).runInNewContext({ document, usage: available });
    expect(nodes.get('lbl-plan-month').textContent).to.equal('42.00%');
    expect(nodes.get('month-unavailable-link').style.display).to.equal('none');
  });
});
