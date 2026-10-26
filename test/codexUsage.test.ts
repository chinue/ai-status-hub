// DESIGN: v2-test-design.md#codex-usage
import { expect } from 'chai';
import { codexRateLimitsToQuota, formatProviderStatus, parseCodexUsage } from '../src/calc';
import { CodexLocalParser } from '../src/providers/codex/localParser';
import { CodexPricingProvider } from '../src/providers/codex/pricing';
import { LocalUsageService } from '../src/services/localUsageService';
import { DashboardPanel } from '../src/presenters/dashboard';
import { Scheduler } from '../src/services/scheduler';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { makeT } from '../src/i18n';
import { Store, defaultState } from '../src/store';

describe('Codex weekly-only usage', () => {
  const now = Date.now();
  const weekly = { used_percent: 15, window_minutes: 10080, resets_at: (now + 86400000) / 1000 };
  it('maps a primary weekly window without inventing a five-hour limit', () => {
    const q = codexRateLimitsToQuota({ primary: weekly }, now);
    expect(q.weeklyUsedPct).to.equal(15);
    expect(q.weeklyResetAt).to.equal(weekly.resets_at * 1000);
    expect(q.has5hLimit).to.equal(false);
    expect(q.windowLimit).to.equal(0);
  });
  it('preserves Plus five-hour and weekly windows, including legacy records', () => {
    for (const primary of [{ used_percent: 12, window_minutes: 300 }, { used_percent: 12 }]) {
      const q = codexRateLimitsToQuota({ primary, secondary: weekly }, now);
      expect(q.has5hLimit).to.equal(true);
      expect(q.windowUsedPct).to.equal(12);
      expect(q.weeklyUsedPct).to.equal(15);
    }
  });
  it('does not infer a weekly quota from an unknown explicit window length', () => {
    expect(codexRateLimitsToQuota({ primary: { used_percent: 12, window_minutes: 60 } }, now).weeklyLimit).to.equal(0);
    expect(codexRateLimitsToQuota({}, now).has5hLimit).to.equal(false);
  });
  it('maps weekly-only API usage using the window duration', () => {
    const q = parseCodexUsage({ rate_limit: { primary_window: {
      used_percent: 15, limit_window_seconds: 604800, reset_after_seconds: 86400,
    } } }, now);
    expect(q?.weeklyUsedPct).to.equal(15);
    expect(q?.has5hLimit).to.equal(false);
  });

  it('exposes five-hour row visibility in dashboard updates', () => {
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, {
      ...defaultState(), activeProvider: 'codex', quota: { has5hLimit: false, weeklyLimit: 100 },
    });
    expect(usage.has5hLimit).to.equal(false);
  });
  it('computes nonzero estimated costs from current Codex token events', async () => {
    const parser = new CodexLocalParser();
    const entries = (parser as any).parseText(JSON.stringify({
      type: 'event_msg', timestamp: new Date(now).toISOString(), payload: {
        type: 'token_count', info: { last_token_usage: { input_tokens: 10000, cached_input_tokens: 8000, output_tokens: 1000 } },
      },
    }), now);
    const service = new LocalUsageService();
    service.setProvider({ localUsage: { scanSessions: async () => entries }, pricing: new CodexPricingProvider() } as any);
    const usage = await service.getLocalUsage();
    expect(usage.entries).to.have.length(1);
    expect(usage.costToday).to.be.greaterThan(0);
    expect(usage.cost7d).to.be.greaterThan(0);
  });
});


describe('dashboard cost refresh', () => {
  it('publishes newly scanned cost entries during short ticks', async () => {
    const store = new Store();
    const entries = [{ timestamp: Date.now(), inputOther: 1000, output: 100, inputCacheRead: 0, inputCacheCreation: 0, cost: 0.01, messageId: 'new' }];
    const usage = { entries, cost5h: 0.01, cost7d: 0.01, costToday: 0.01, costThisCycle: 0.01 };
    await (Scheduler.prototype as any).doShortTick.call({
      store, stateWindowAnchors: () => ({}), config: { dataRetentionDays: 365, apiHistoryMaxEntries: 10 },
      localUsageService: { getLocalUsage: async () => usage, getRateLimits: async () => null },
    });
    expect(store.getState().usageEntries).to.deep.equal(entries);
  });
});

it('omits the five-hour status cell for weekly-only quotas', () => {
  const quota = codexRateLimitsToQuota({primary: {used_percent: 15, window_minutes: 10080}}, Date.now());
  const text = formatProviderStatus({...defaultState(), activeProvider: 'codex', quota}, 'X', 'Codex', 'percent');
  expect(text).to.include('15.00%');
  expect(text).not.to.include('5️⃣');
});

describe('weekly-only local statistics', () => {
  it('keeps existing recent costs inside the five-hour analysis window', async () => {
    const now = Date.now();
    const quota = codexRateLimitsToQuota({ primary: { used_percent: 15, window_minutes: 10080 } }, now);
    const service = new LocalUsageService();
    service.setProvider({
      pricing: new CodexPricingProvider(),
      localUsage: { scanSessions: async () => [{ timestamp: now - 3600000, inputOther: 10000, output: 1000, inputCacheRead: 0, inputCacheCreation: 0, cost: 0, messageId: 'recent' }] },
    } as any);
    const usage = await service.getLocalUsage({ windowResetAtMs: quota.windowResetAt });
    expect(usage.cost5h).to.be.greaterThan(0);
  });

  it('uses a rolling analysis window even when old quota anchors are cached', () => {
    const store = new Store();
    const now = Date.now();
    const quota = codexRateLimitsToQuota({ primary: { used_percent: 15, window_minutes: 10080 } }, now);
    store.dispatch({ type: 'API_SUCCESS', payload: quota });
    store.dispatch({ type: 'WINDOW_ANCHORS_SET', payload: {
      providerId: 'codex', window5hStartMs: now, window5hResetAtMs: now + 18000000,
      window7dStartMs: now - 86400000, window7dResetAtMs: now + 6 * 86400000, updatedAt: now, source: 'api',
    } });
    const target = { store, currentProviderId: () => 'codex' };
    const anchors = (Scheduler.prototype as any).stateWindowAnchors.call(target, now);
    expect(anchors.window5hStartMs).to.equal(now - 18000000);
    expect(anchors.window7dStartMs).to.equal(now - 86400000);
    const starts = (DashboardPanel.prototype as any).resolveDashboardWindowStarts.call({}, store.getState(), now);
    expect(starts.window5hStart).to.equal(now - 18000000);
  });

  for (const locale of ['en', 'zh-CN'] as const) {
    it(`hides every five-hour tooltip row while preserving weekly and daily usage (${locale})`, async () => {
      const store = new Store();
      store.dispatch({ type: 'UI_SET_LANGUAGE', payload: locale });
      store.dispatch({ type: 'API_SUCCESS', payload: codexRateLimitsToQuota({ primary: { used_percent: 15, window_minutes: 10080 } }, Date.now()) });
      store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { requests5h: 1, requests7d: 1, cost5h: 1, cost7d: 2, costToday: 1 } });
      const presenter = new StatusBarPresenter(store);
      const t = makeT(locale);
      try {
        const tooltip = await (presenter as any).buildTooltip(store.getState());
        expect(tooltip.value).not.to.include(t('tooltip.window5h'));
        expect(tooltip.value).not.to.include(t('tooltip.table.row.5h'));
        expect(tooltip.value).to.include(t('tooltip.window7d'));
        expect(tooltip.value).to.include(t('tooltip.table.row.7d'));
        expect(tooltip.value).to.include(t('tooltip.table.row.today'));
      } finally { presenter.dispose(); }
    });
  }
});
