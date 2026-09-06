// DESIGN: v2-test-design.md#dashboard-current-usage

import { expect } from 'chai';
import { DashboardPanel } from '../src/presenters/dashboard';
import { defaultState } from '../src/store';
import { AppState, QuotaData } from '../src/types';

describe('Dashboard Current Usage', () => {
  const quota: QuotaData = {
    weeklyLimit: 100,
    weeklyUsed: 34,
    weeklyUsedPct: 34,
    weeklyResetAt: Date.now() + 7 * 24 * 3600 * 1000,
    fableWeeklyUsedPct: 56,
    fableWeeklyResetAt: Date.now() + 6 * 24 * 3600 * 1000,
    windowLimit: 100,
    windowUsed: 12,
    windowRemaining: 88,
    windowUsedPct: 12,
    windowResetAt: Date.now() + 5 * 3600 * 1000,
    parallelLimit: 0,
  };

  function buildUsage(state: AppState) {
    return (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
  }

  it('exposes Fable usage only for the Claude provider', () => {
    const claudeState = { ...defaultState(), activeProvider: 'claude', quota };
    const claudeUsage = buildUsage(claudeState);
    expect(claudeUsage.hasFable7dLimit).to.equal(true);
    expect(claudeUsage.utilizationFable7d).to.equal(0.56);

    const codexUsage = buildUsage({ ...claudeState, activeProvider: 'codex' });
    expect(codexUsage.hasFable7dLimit).to.equal(false);
  });

  it('places the Fable progress row below the shared 7d row', () => {
    const state = { ...defaultState(), activeProvider: 'claude', quota };
    const html = (DashboardPanel.prototype as any).getHtml.call(
      { store: { getState: () => state } },
      'test-nonce',
      'en',
    ) as string;

    expect(html.indexOf('id="row-fable-7d"')).to.be.greaterThan(html.indexOf('id="fill-7d"'));
    expect(html).to.include('Fable 5 · 7d window');
  });
});
