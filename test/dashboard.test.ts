// DESIGN: v2-test-design.md#dashboard-current-usage

import { expect } from 'chai';
import { DashboardPanel } from '../src/presenters/dashboard';
import { defaultState, Store } from '../src/store';
import { AppState, QuotaData } from '../src/types';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { Script } from 'vm';

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

  it('keeps the Fable row visible at 0% after its reset time', () => {
    const expiredQuota = {
      ...quota,
      fableWeeklyResetAt: Date.now() - 1000,
    };
    const usage = buildUsage({ ...defaultState(), activeProvider: 'claude', quota: expiredQuota });

    expect(usage.hasFable7dLimit).to.equal(true);
    expect(usage.utilizationFable7d).to.equal(0);
  });

  it('shows a 0% Fable row for Claude while scoped usage is temporarily unavailable', () => {
    const quotaWithoutFable = { ...quota };
    delete quotaWithoutFable.fableWeeklyUsedPct;
    delete quotaWithoutFable.fableWeeklyResetAt;

    const usage = buildUsage({
      ...defaultState(),
      activeProvider: 'claude',
      quota: quotaWithoutFable,
    });

    expect(usage.hasFable7dLimit).to.equal(true);
    expect(usage.utilizationFable7d).to.equal(0);
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
    expect(html).to.include('id="row-fable-7d" style=""');
  });

  it('lists every provider with separate checkbox and dashboard button', () => {
    const stub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key === 'statusBar.providers' ? ['codex', 'kimi'] : fallback,
    } as any);
    try {
      const html = (DashboardPanel.prototype as any).getHtml.call(
        { store: { getState: () => ({ ...defaultState(), activeProvider: 'kimi' }) } }, 'nonce', 'en',
      );
      expect(html).not.to.include('id="provider-select"');
      for (const id of ['codex', 'kimi', 'claude', 'glm', 'cursor']) {
        expect(html).to.include(`data-provider-check="${id}"`);
        expect(html).to.include(`data-provider-open="${id}"`);
      }
      expect(html).to.match(/data-provider-check="kimi"[^>]* checked/);
      expect(html).not.to.match(/data-provider-check="claude"[^>]* checked/);
      expect(html).to.include('data-provider-open="kimi" aria-pressed="true"');
      for (const match of html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)) {
        expect(() => new Script(match[1])).not.to.throw();
      }
    } finally { stub.restore(); }
  });

  it('serializes rapid checkbox updates and rejects malformed messages', async () => {
    let selected = ['codex'];
    const stub = sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key === 'statusBar.providers' ? selected : fallback,
      update: async (_key: string, value: string[]) => { await Promise.resolve(); selected = value; },
    } as any);
    try {
      const target = { selectionUpdate: Promise.resolve() };
      const send = (msg: any) => (DashboardPanel.prototype as any).handleMessage.call(target, msg);
      send(null);
      send({ type: 'setStatusBarProvider', providerId: 'unknown', checked: true });
      send({ type: 'setStatusBarProvider', providerId: 'kimi', checked: 'yes' });
      send({ type: 'setStatusBarProvider', providerId: 'kimi', checked: true });
      send({ type: 'setStatusBarProvider', providerId: 'claude', checked: true });
      await target.selectionUpdate;
      expect(selected).to.deep.equal(['codex', 'kimi', 'claude']);
      for (const providerId of selected) send({ type: 'setStatusBarProvider', providerId, checked: false });
      await target.selectionUpdate;
      expect(selected).to.deep.equal(['kimi']);
    } finally { stub.restore(); }
  });

  it('unsubscribes the old model when the dashboard switches stores', () => {
    const oldStore = new Store();
    const newStore = new Store();
    newStore.dispatch({ type: 'SET_PROVIDER', payload: 'kimi' });
    DashboardPanel.createOrShow(oldStore);
    const panel = (DashboardPanel as any).instance;
    const update = sinon.stub(panel, 'sendUpdate');
    try {
      DashboardPanel.createOrShow(newStore);
      oldStore.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      expect(update.callCount).to.equal(0);
      newStore.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      expect(update.callCount).to.equal(1);
      expect(update.firstCall.args[0].activeProvider).to.equal('kimi');
    } finally {
      update.restore();
      panel.dispose();
    }
  });
});
