import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { activate, deactivate } from '../src/extension';
import { Scheduler } from '../src/services/scheduler';
import { CacheService } from '../src/services/cacheService';
import { ApiHistoryService } from '../src/services/apiHistoryService';
import { DashboardPanel } from '../src/presenters/dashboard';
import { ConfigService } from '../src/config';
import { makeContext } from './mocks/vscode';

describe('multiple provider status bars', () => {
  afterEach(() => { sinon.restore(); });

  it('keeps selected providers independent and opens the clicked provider dashboard', async () => {
    const callbacks = new Map<string, Function>();
    const settings: Record<string, unknown> = { provider: 'codex', 'statusBar.providers': ['codex', 'kimi'] };
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => settings[key] ?? fallback,
      update: async (key: string, value: unknown) => { settings[key] = value; },
    } as any);
    sinon.stub(vscode.commands, 'registerCommand').callsFake((name: string, callback: any) => {
      callbacks.set(name, callback); return { dispose() {} };
    });
    const start = sinon.stub(Scheduler.prototype, 'start');
    const stop = sinon.spy(Scheduler.prototype, 'stop');
    let configChanged: (event: any) => void;
    sinon.stub(vscode.workspace, 'onDidChangeConfiguration').callsFake((listener: any) => {
      configChanged = listener; return { dispose() {} };
    });
    sinon.stub(CacheService.prototype, 'read').resolves(null);
    sinon.stub(ApiHistoryService.prototype, 'readFromDisk').resolves([]);
    const show = sinon.stub(DashboardPanel, 'createOrShow');
    const context = makeContext();
    await activate(context as any);
    try {
      expect(start.callCount).to.equal(2);
      const stores = start.getCalls().map(call => (call.thisValue as any).store);
      expect((start.firstCall.thisValue as any).cacheService).to.not.equal((start.secondCall.thisValue as any).cacheService);
      expect((start.firstCall.thisValue as any).localUsageService).to.not.equal((start.secondCall.thisValue as any).localUsageService);
      expect(stores.map(store => store.getState().activeProvider)).to.have.members(['codex', 'kimi']);
      stores[0].dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      expect(stores[1].getState().authStatus).to.equal('unknown');
      await callbacks.get('aiStatusHub.showDashboard')!('kimi');
      expect(show.lastCall.args[0].getState().activeProvider).to.equal('kimi');
      expect(start.callCount).to.equal(2);
      await callbacks.get('aiStatusHub.showDashboard')!('not-a-provider');
      expect(start.callCount).to.equal(2);
      settings['statusBar.providers'] = [];
      configChanged!({ affectsConfiguration: (name: string) => name === 'aiStatusHub' || name === 'aiStatusHub.statusBar.providers' });
      await callbacks.get('aiStatusHub.showDashboard')!();
      expect(stop.getCalls().some(call => (call.thisValue as any).store.getState().activeProvider === 'codex')).to.equal(true);
      expect(start.callCount).to.equal(2);
    } finally {
      for (const disposable of context.subscriptions) disposable.dispose();
      await deactivate();
    }
  });

  it('resolves each provider price without changing the dashboard context', () => {
    const config = ConfigService.getInstance();
    config.setActiveProviderId('codex');
    const values: Record<string, number> = {
      'pricing.kimi.models.k3.inputPerMillion': 20,
      'pricing.codex.models.k3.inputPerMillion': 99,
    };
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => values[key] ?? fallback,
    } as any);
    expect(config.getPricing('kimi-k3', 'kimi').inputPerMillion).to.equal(20);
    expect(config.currency.code).to.equal('USD');
  });

  it('follows the active model only until an explicit selection is saved', () => {
    const config = ConfigService.getInstance();
    config.setActiveProviderId('kimi');
    let globalValue: string[] | undefined;
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: () => globalValue ?? [],
      inspect: () => ({ defaultValue: [], globalValue }),
    } as any);
    expect(config.statusBarProviders).to.deep.equal(['kimi']);
    globalValue = [];
    expect(config.statusBarProviders).to.deep.equal([]);
    globalValue = ['codex', 'kimi'];
    expect(config.statusBarProviders).to.deep.equal(['codex', 'kimi']);
    config.setActiveProviderId('codex');
  });

  it('keeps checkbox multi-selection and starts status bars when configuration registration is stale', async () => {
    const callbacks = new Map<string, Function>();
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key === 'provider' ? 'codex' : fallback,
      inspect: () => undefined,
      update: async () => { throw new Error('aiStatusHub.statusBar.providers is not a registered configuration'); },
    } as any);
    sinon.stub(console, 'error');
    sinon.stub(vscode.commands, 'registerCommand').callsFake((name: string, callback: any) => {
      callbacks.set(name, callback); return { dispose() {} };
    });
    sinon.stub(vscode.commands, 'executeCommand').callsFake(async (name: string, ...args: any[]) => callbacks.get(name)?.(...args));
    const start = sinon.stub(Scheduler.prototype, 'start');
    sinon.stub(CacheService.prototype, 'read').resolves(null);
    sinon.stub(ApiHistoryService.prototype, 'readFromDisk').resolves([]);
    const show = sinon.stub(DashboardPanel, 'createOrShow');
    const context = makeContext();
    await activate(context as any);
    try {
      const target = { selectionUpdate: Promise.resolve() };
      const send = (providerId: string, checked: boolean) => (DashboardPanel.prototype as any).handleMessage.call(target, {
        type: 'setStatusBarProvider', providerId, checked,
      });
      send('kimi', true);
      send('claude', true);
      await target.selectionUpdate;
      expect(ConfigService.getInstance().statusBarProviders).to.deep.equal(['codex', 'kimi', 'claude']);
      expect(start.callCount).to.equal(3);
      expect(show.called).to.equal(false);
      await callbacks.get('aiStatusHub.showDashboard')!('kimi');
      expect(ConfigService.getInstance().statusBarProviders).to.deep.equal(['codex', 'kimi', 'claude']);
      expect(show.lastCall.args[0].getState().activeProvider).to.equal('kimi');
      for (const id of ['codex', 'kimi', 'claude']) send(id, false);
      await target.selectionUpdate;
      expect(ConfigService.getInstance().statusBarProviders).to.deep.equal([]);
      expect(context.globalState.get('aiStatusHub.statusBar.providers')).to.deep.equal([]);
    } finally {
      for (const disposable of context.subscriptions) disposable.dispose();
      await deactivate();
    }
  });

  it('restores fallback selections and clears them after settings writes recover', async () => {
    const config = ConfigService.getInstance();
    const storage = makeContext({ 'aiStatusHub.statusBar.providers': ['codex', 'kimi'] }).globalState;
    let configured: string[] | undefined;
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: () => configured,
      inspect: () => configured === undefined ? undefined : { globalValue: configured },
      update: async (_key: string, ids: string[]) => { configured = ids; },
    } as any);
    config.initializeSelectionStorage(storage as any);
    try {
      config.setActiveProviderId('claude');
      expect(config.statusBarProviders).to.deep.equal(['codex', 'kimi']);
      expect(await config.setStatusBarProviders(['kimi', 'claude'])).to.equal(true);
      expect(storage.get('aiStatusHub.statusBar.providers')).to.equal(undefined);
      expect(config.statusBarProviders).to.deep.equal(['kimi', 'claude']);
    } finally {
      config.initializeSelectionStorage();
      config.setActiveProviderId('codex');
    }
  });

  it('reports a failed save when neither settings nor extension storage can be written', async () => {
    const config = ConfigService.getInstance();
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (_key: string, fallback: unknown) => fallback,
      update: async () => { throw new Error('unregistered configuration'); },
    } as any);
    sinon.stub(console, 'error');
    config.initializeSelectionStorage({
      get: () => undefined,
      update: async () => { throw new Error('storage unavailable'); },
    } as any);
    try {
      expect(await config.setStatusBarProviders(['kimi'])).to.equal(false);
      expect(config.statusBarProviders).to.deep.equal(['codex']);
    } finally { config.initializeSelectionStorage(); }
  });
});
