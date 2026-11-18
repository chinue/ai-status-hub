// DESIGN: v2-test-design.md#deepseek-official
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as calc from '../src/calc';
import { getProvider } from '../src/providers/registry';
import { ConfigService } from '../src/config';
import { Store, defaultState } from '../src/store';
import { DashboardPanel } from '../src/presenters/dashboard';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { MemorySecretStorage } from './mocks/vscode';
import { Script } from 'vm';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeLocalParser } from '../src/providers/claude/localParser';
import { LocalUsageService } from '../src/services/localUsageService';
import { Scheduler } from '../src/services/scheduler';
import { CacheService } from '../src/services/cacheService';
import { HistoryService } from '../src/services/historyService';

const balance = () => ({ is_available: true, balance_infos: [
  { currency: 'CNY', total_balance: '110.00', granted_balance: '10.00', topped_up_balance: '100.00' },
  { currency: 'USD', total_balance: '12.00', granted_balance: '2.00', topped_up_balance: '10.00' },
] });
const parse = (raw: unknown, currency = 'CNY') => (calc as any).parseDeepseekBalance(raw, currency);
describe('DeepSeek official', () => {
  afterEach(() => sinon.restore());
  it('keeps local seven-day history when the account API returns balance without a weekly quota', async () => {
    const now = Date.now(), day = 86400000;
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'deepseek' });
    const provider = getProvider('deepseek')!;
    provider.localUsage = { scanSessions: async () => [1, 6, 8].map((age, index) => ({
      timestamp: now - age * day, inputOther: 100, output: 20, inputCacheRead: 0,
      inputCacheCreation: 0, cost: 0, model: 'deepseek-flash', messageId: String(index),
    })), getRateLimits: async () => null, invalidate() {} };
    const local = new LocalUsageService([]);
    local.setProvider(provider);
    const scheduler = new Scheduler(store, provider.auth, provider.api, new CacheService(), local);
    await (scheduler as any).processQuotaData(parse(balance()), now, 'api', false);
    expect(store.getState().localEstimate?.requests7d).to.equal(2);
    expect(store.getState().localEstimate?.cost7d).to.be.greaterThan(0);
    expect(store.getState().windowAnchors?.window7dStartMs).to.equal(now - 7 * day);
    const later = (scheduler as any).stateWindowAnchors(now + day);
    expect(later.window7dStartMs).to.equal(now - 6 * day);
    expect(later.window7dResetAtMs).to.equal(now + day);
    // Old state/cache anchors used refresh time as the start; the dashboard must repair that too.
    for (const windowAnchors of [null, { providerId: 'deepseek', window5hStartMs: now,
      window5hResetAtMs: now + 18000000, window7dStartMs: now, window7dResetAtMs: now + 7 * day,
      updatedAt: now, source: 'disk' }]) {
      const state = { ...store.getState(), windowAnchors };
      const starts = (DashboardPanel.prototype as any).resolveDashboardWindowStarts.call({}, state, now);
      expect(starts.window7dStart).to.equal(now - 7 * day);
      const offline = (DashboardPanel.prototype as any).resolveDashboardWindowStarts.call({}, { ...state, quota: null }, now);
      expect(offline.window7dStart).to.equal(now - 7 * day);
    }
    const old = { providerId: 'deepseek', window5hStartMs: now, window5hResetAtMs: now + 18000000,
      window7dStartMs: now, window7dResetAtMs: now + 7 * day, updatedAt: now, source: 'disk' as const };
    const restoredStore = new Store();
    restoredStore.dispatch({ type: 'SET_PROVIDER', payload: 'deepseek' });
    restoredStore.dispatch({ type: 'API_SUCCESS', payload: parse(balance()) });
    const cache = new CacheService();
    sinon.stub(cache, 'readWindowAnchors').resolves(old);
    const restored = await (new Scheduler(restoredStore, provider.auth, provider.api, cache, local) as any)
      .resolveWindowAnchorsFromFallbackChain(now);
    expect(restored.window7dStartMs).to.equal(now - 7 * day);
    expect(restored.window7dResetAtMs).to.equal(now);
  });
  it('registers an independent provider, currency and status bar option', () => {
    expect(getProvider('deepseek')?.displayName).to.equal('DeepSeek');
    expect(calc.normalizeStatusBarProviders(['deepseek', 'volcengine'])).to.deep.equal(['deepseek', 'volcengine']);
    expect(ConfigService.getInstance().currencyForProvider('deepseek').code).to.equal('CNY');
  });
  it('keeps official names and Ark economy or explicit namespaces separate', () => {
    for (const model of ['deepseek-flash', 'deepseek-v4.1-flash-1017', 'deepseek-v4-pro', 'deepseek/deepseek-flash']) {
      expect(calc.resolveClaudeLogProvider(model, null, {}, {}), model).to.equal('deepseek');
    }
    for (const model of ['deepseek-v4-1-flash-economy', 'deepseek-v4.1-flash-economy', 'ark/deepseek-flash']) {
      expect(calc.resolveClaudeLogProvider(model, null, {}, {}), model).to.equal('volcengine');
    }
    expect(calc.resolveClaudeLogProvider('deepseek-flash', 's', { s: 'volcengine' }, {})).to.equal('volcengine');
    expect(calc.resolveClaudeLogProvider('deepseek-flash', null, {}, { 'deepseek-flash': 'volcengine' })).to.equal('volcengine');
  });
  it('parses balance with its actual currency without inventing quota windows', () => {
    expect(parse(balance())).to.include({ has5hLimit: false, has7dLimit: false });
    expect(parse(balance()).balance).to.deep.equal({ currency: 'CNY', total: 110, granted: 10, toppedUp: 100, isAvailable: true });
    expect(parse(balance(), 'USD').balance.total).to.equal(12);
    expect(parse({ is_available: false, balance_infos: [{ currency: 'USD', total_balance: '0', granted_balance: '0', topped_up_balance: '0' }] }).balance)
      .to.include({ currency: 'USD', total: 0, isAvailable: false });
    for (const raw of [null, {}, { is_available: true, balance_infos: [] },
      { is_available: 'true', balance_infos: balance().balance_infos },
      { is_available: true, balance_infos: [{ currency: 'CNY', total_balance: '', granted_balance: '0', topped_up_balance: '0' }] }]) {
      expect(parse(raw)).to.equal(null);
    }
  });
  it('aggregates official and Ark requests from the same Claude file exactly once per provider', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'deepseek-routing-'));
    const clock = sinon.useFakeTimers({ now: Date.parse('2026-11-16T11:00:00Z'), toFake: ['Date'] });
    try {
      const rows = ['deepseek-flash', 'deepseek-v4-1-flash-economy', 'ark/deepseek-v4-pro', 'deepseek-v4-pro']
        .map((model, id) => ({ type: 'assistant', timestamp: new Date().toISOString(), sessionId: 'mixed',
          message: { id: String(id), model, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 } } }));
      fs.writeFileSync(path.join(root, 'usage.jsonl'), [...rows, rows[0]].map(row => JSON.stringify(row)).join('\n'));
      for (const [id, expected] of [['deepseek', ['0', '3']], ['volcengine', ['1', '2']]] as const) {
        const provider = getProvider(id)!;
        provider.localUsage = new ClaudeLocalParser(id, root);
        const local = new LocalUsageService([]);
        local.setProvider(provider);
        const usage = await local.getLocalUsage();
        expect(usage.entries.map(entry => entry.messageId)).to.have.members([...expected]);
        expect(usage.requestsToday).to.equal(2);
        expect(usage.costToday).to.be.greaterThan(0);
      }
    } finally { clock.restore(); fs.rmSync(root, { recursive: true, force: true }); }
  });
  it('uses a read-only balance endpoint with verified TLS and no redirect', async () => {
    const fetcher = sinon.stub().resolves({ status: 200, ok: true, json: async () => balance() });
    const { DeepseekApiProvider } = require('../src/providers/deepseek/api');
    const result = await new DeepseekApiProvider(fetcher).fetchQuota('private-test-key');
    expect(result.data.balance.total).to.equal(110);
    const [url, options] = fetcher.firstCall.args;
    expect(url).to.equal('https://api.deepseek.com/user/balance');
    expect(options.method).to.equal('GET');
    expect(options.headers.Authorization).to.equal('Bearer private-test-key');
    expect(options.redirect).to.equal('error');
    expect(options.agent.options.rejectUnauthorized).to.equal(true);
  });
  it('rejects authentication, malformed and network failures without exposing credentials', async () => {
    const { DeepseekApiProvider } = require('../src/providers/deepseek/api');
    for (const status of [401, 403, 429, 500]) {
      const result = await new DeepseekApiProvider(async () => ({ status })).fetchQuota('private-test-key');
      expect(result.ok).to.equal(false);
      expect(!!result.authFailed).to.equal(status === 401 || status === 403);
      expect(JSON.stringify(result)).not.to.include('private-test-key');
    }
    for (const fetcher of [async () => { throw new Error('private-test-key'); },
      async () => ({ status: 200, ok: true, json: async () => ({}) })]) {
      expect((await new DeepseekApiProvider(fetcher).fetchQuota('private-test-key')).ok).to.equal(false);
    }
  });
  it('validates and securely saves only its own key and signs out in isolation', async () => {
    const { DeepseekAuthProvider } = require('../src/providers/deepseek/auth');
    const api = { fetchQuota: sinon.stub().resolves({ ok: true, data: parse(balance()) }) };
    const auth = new DeepseekAuthProvider(api);
    const secrets = new MemorySecretStorage();
    await secrets.store('aiStatusHub.apiKey', 'kimi-fixture');
    auth.initSecrets(secrets);
    sinon.stub(vscode.window, 'showInputBox').resolves(' official-key ' as any);
    expect(await auth.startLoginFlow()).to.equal(true);
    expect(api.fetchQuota.firstCall.args[0]).to.equal('official-key');
    expect(await secrets.get('aiStatusHub.deepseek.apiKey')).to.equal('official-key');
    expect(await auth.resolveToken()).to.equal('official-key');
    expect(await auth.signOut()).to.equal(true);
    expect(await secrets.get('aiStatusHub.deepseek.apiKey')).to.equal(undefined);
    expect(await secrets.get('aiStatusHub.apiKey')).to.equal('kimi-fixture');
  });
  it('preserves the previous key on cancellation or failed verification', async () => {
    const { DeepseekAuthProvider } = require('../src/providers/deepseek/auth');
    const auth = new DeepseekAuthProvider({ fetchQuota: async () => ({ ok: false }) });
    const secrets = new MemorySecretStorage();
    await secrets.store('aiStatusHub.deepseek.apiKey', 'previous');
    auth.initSecrets(secrets);
    const input = sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
    expect(await auth.startLoginFlow()).to.equal(false);
    input.resolves('invalid' as any);
    expect(await auth.startLoginFlow()).to.equal(false);
    expect(await secrets.get('aiStatusHub.deepseek.apiKey')).to.equal('previous');
  });
  it('handles storage failures without signing out or leaking private error text', async () => {
    const { DeepseekAuthProvider } = require('../src/providers/deepseek/auth');
    const auth = new DeepseekAuthProvider({ fetchQuota: async () => ({ ok: true, data: parse(balance()) }) });
    auth.initSecrets({ get: async () => { throw new Error('private-fixture'); },
      store: async () => { throw new Error('private-fixture'); }, delete: async () => { throw new Error('private-fixture'); } });
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showInputBox').resolves('key' as any);
    expect(await auth.resolveToken()).to.equal(undefined);
    expect(await auth.startLoginFlow()).to.equal(false);
    expect(await auth.signOut()).to.equal(false);
    expect(JSON.stringify(error.args)).not.to.include('private-fixture');
  });
  it('aborts stalled balance requests and clears its timeout', async () => {
    const { DeepseekApiProvider } = require('../src/providers/deepseek/api');
    const clock = sinon.useFakeTimers();
    try {
      const fetcher = (_url: string, options: any) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
      const pending = new DeepseekApiProvider(fetcher).fetchQuota('fixture-key');
      await clock.tickAsync(15_000);
      expect(await pending).to.include({ ok: false, networkError: true });
      expect(clock.countTimers()).to.equal(0);
    } finally { clock.restore(); }
  });
  it('prices official Flash and Pro independently from Ark and supports custom overrides', () => {
    const p = getProvider('deepseek')!.pricing;
    const idle = Date.parse('2026-11-16T11:00:00Z');
    const peak = Date.parse('2026-11-16T02:00:00Z');
    expect(p.getPricing('deepseek-flash', idle)).to.include({ inputPerMillion: 1, outputPerMillion: 4, cacheReadPerMillion: 0.02 });
    expect(p.getPricing('deepseek-v4.1-flash-1017', peak).inputPerMillion).to.equal(2);
    expect(p.getPricing('deepseek-v4-flash', idle).outputPerMillion).to.equal(4);
    expect(p.getPricing('deepseek-v4-pro', idle).outputPerMillion).to.equal(13.5);
    expect(p.getPricing('deepseek-v4-pro', peak).outputPerMillion).to.equal(27);
    expect(p.getPricing('deepseek-v4-1-flash-economy', idle).inputPerMillion).to.equal(0);
    expect(p.getPricing('unknown', idle).outputPerMillion).to.equal(0);
    sinon.stub(vscode.workspace, 'getConfiguration').returns({ get: (key: string, fallback: unknown) =>
      key === 'pricing.deepseek.models.deepseekFlash.inputPerMillion' ? 7 : fallback } as any);
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(7);
  });
  it('uses automatic DeepSeek rates with VS Code registered defaults while honoring explicit zero and null overrides', () => {
    const properties = require('../package.json').contributes.configuration.properties;
    const overrides: Record<string, unknown> = {};
    sinon.stub(vscode.workspace, 'getConfiguration').returns({ get: (key: string, fallback: unknown) => {
      if (Object.prototype.hasOwnProperty.call(overrides, key)) return overrides[key];
      const property = properties['aiStatusHub.' + key];
      if (!property) return fallback;
      if (Object.prototype.hasOwnProperty.call(property, 'default')) return property.default;
      return property.type === 'number' ? 0 : fallback;
    } } as any);
    const p = getProvider('deepseek')!.pricing;
    const idle = Date.parse('2026-11-17T12:00:00Z');
    const peak = Date.parse('2026-11-17T02:00:00Z');
    expect(p.getPricing('deepseek-flash', idle)).to.include({ inputPerMillion: 1, outputPerMillion: 4, cacheReadPerMillion: 0.02 });
    expect(p.getPricing('deepseek-v4-pro', peak).outputPerMillion).to.equal(27);
    overrides['pricing.deepseek.models.deepseekFlash.inputPerMillion'] = 0;
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(0);
    overrides['pricing.deepseek.models.deepseekFlash.inputPerMillion'] = null;
    overrides['pricing.models.deepseekFlash.inputPerMillion'] = 7;
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(7);
    overrides['pricing.models.deepseekFlash.inputPerMillion'] = null;
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(1);
    overrides.currency = 'USD';
    expect(p.getPricing('deepseek-flash', idle).outputPerMillion).to.equal(0.6);
  });
  it('ignores implicit zero defaults in the host registry but keeps explicitly scoped DeepSeek prices', () => {
    const values: Record<string, any> = {};
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key.startsWith('pricing.') && key !== 'pricing.customModels' ? 0 : fallback,
      inspect: (key: string) => ({ key, defaultValue: 0, ...(values[key] ?? {}) }),
    } as any);
    const p = getProvider('deepseek')!.pricing;
    const idle = Date.parse('2026-11-17T12:00:00Z');
    const key = 'pricing.deepseek.models.deepseekFlash.inputPerMillion';
    expect(p.getPricing('deepseek-flash', idle)).to.include({ inputPerMillion: 1, outputPerMillion: 4, cacheReadPerMillion: 0.02 });
    values[key] = { globalValue: 7 };
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(7);
    values[key] = { globalValue: 7, workspaceValue: 0 };
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(0);
    values[key] = { globalValue: 7, workspaceValue: 0, workspaceFolderValue: 3 };
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(3);
    values[key].workspaceFolderLanguageValue = 9;
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(9);
    values[key].workspaceFolderLanguageValue = null;
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(1);
    values['pricing.models.deepseekFlash.inputPerMillion'] = { globalValue: 2.5 };
    expect(p.getPricing('deepseek-flash', idle).inputPerMillion).to.equal(2.5);
  });
  it('falls back to automatic DeepSeek prices when inspection fails or configured values are invalid', () => {
    const inspect = sinon.stub().throws(new Error('synthetic configuration failure'));
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key.startsWith('pricing.') && key !== 'pricing.customModels' ? 0 : fallback, inspect,
    } as any);
    const p = getProvider('deepseek')!.pricing;
    const time = Date.parse('2026-11-17T12:00:00Z');
    expect(p.getPricing('deepseek-flash', time).inputPerMillion).to.equal(1);
    for (const value of [undefined, null, -1, NaN, Infinity, '0']) {
      inspect.resetBehavior();
      inspect.returns(value === undefined ? undefined : { globalValue: value });
      expect(p.getPricing('deepseek-flash', time).inputPerMillion).to.equal(1);
    }
  });
  it('feeds nonzero DeepSeek costs to day totals, cost curves and heatmaps under registered setting defaults', async () => {
    const properties = require('../package.json').contributes.configuration.properties;
    sinon.stub(vscode.workspace, 'getConfiguration').returns({ get: (key: string, fallback: unknown) => {
      if (key.startsWith('pricing.') && key !== 'pricing.customModels') return 0;
      const property = properties['aiStatusHub.' + key];
      if (!property) return fallback;
      return Object.prototype.hasOwnProperty.call(property, 'default') ? property.default : property.type === 'number' ? 0 : fallback;
    }, inspect: (key: string) => ({ key, defaultValue: 0 }) } as any);
    const now = Date.parse('2026-11-17T12:00:00Z');
    const clock = sinon.useFakeTimers(now);
    try {
      const provider = getProvider('deepseek')!;
      sinon.stub(provider.localUsage, 'scanSessions').resolves([{ timestamp: now - 60000, inputOther: 1000000,
        output: 1000000, inputCacheRead: 1000000, inputCacheCreation: 0,
        cost: 0, model: 'deepseek-flash', messageId: 'deepseek-pricing-regression' }]);
      const service = new LocalUsageService([]); service.setProvider(provider);
      const usage = await service.getLocalUsage({ windowResetAtMs: now, weeklyResetAtMs: now });
      expect(usage.cost5h).to.be.closeTo(5.02, 1e-9);
      const history = HistoryService.getInstance();
      const dashboard = history.buildDashboardAggregates(usage.entries, { todayStartMs: now - 3600000,
        monthStartMs: now - 86400000, window5hStartMs: now - 18000000,
        window7dStartMs: now - 604800000, window30dStartMs: now - 2592000000 });
      expect(dashboard.today?.totalCost).to.be.closeTo(5.02, 1e-9);
      expect(history.buildHeatmapData(usage.entries).daily.reduce((sum, day) => sum + day.cost, 0)).to.be.closeTo(5.02, 1e-9);
      const curve = history.buildCostCurve(usage.entries, '5h', now - 18000000, now);
      expect(Math.max(...curve.map(point => point.cumulativeRmb ?? 0))).to.be.closeTo(5.02, 1e-9);
    } finally { clock.restore(); }
  });
  it('honors holidays, weekends, exact peak boundaries and USD rates', () => {
    const p = getProvider('deepseek')!.pricing;
    for (const time of ['2026-11-16T00:59:59Z', '2026-11-16T04:00:00Z', '2026-11-16T10:00:00Z',
      '2026-11-15T02:00:00Z', '2026-10-01T02:00:00Z']) expect(p.getPricing('deepseek-flash', Date.parse(time)).inputPerMillion, time).to.equal(1);
    sinon.stub(vscode.workspace, 'getConfiguration').returns({ get: (key: string, fallback: unknown) => key === 'currency' ? 'USD' : fallback } as any);
    expect(p.getPricing('deepseek-flash', Date.parse('2026-11-16T02:00:00Z'))).to.include({ inputPerMillion: 0.3, outputPerMillion: 1.2, cacheReadPerMillion: 0.006 });
  });
  it('shows balance in status, tooltip and dashboard without fake rate windows', async () => {
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'deepseek' });
    store.dispatch({ type: 'API_SUCCESS', payload: parse(balance()) });
    const state = store.getState();
    const text = calc.formatProviderStatus(state, '🐋', 'DeepSeek', 'absolute');
    expect(text).to.include('\uD83D\uDCB0\u00a5110.00');
    expect(text).not.to.include('Balance');
    expect(text).not.to.include('%');
    const presenter = new StatusBarPresenter(store, getProvider('deepseek'));
    try { expect((await (presenter as any).buildTooltip(state)).value).to.include('110.00'); }
    finally { presenter.dispose(); }
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
    expect(usage.balanceText).to.include('110.00');
    expect(usage.has5hLimit).to.equal(false);
    expect(usage.weeklyQuotaAvailable).to.equal(false);
    const html = (DashboardPanel.prototype as any).getHtml.call({ store }, 'nonce', 'en');
    const nodes = new Map<string, any>();
    const document = { getElementById(id: string) {
      if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '' });
      return nodes.get(id);
    } };
    const source = html.slice(html.indexOf('    function renderCurrentUsage('), html.indexOf('      // Memory breakdown')) + '\n}';
    const sandbox: any = { document, labels: {}, CURRENCY_SYMBOL: '¥' };
    new Script(source + '\nglobalThis.render = renderCurrentUsage;').runInNewContext(sandbox);
    sandbox.render(usage, 'percent');
    expect(nodes.get('row-balance').style.display).to.equal('');
    expect(nodes.get('account-available').textContent).to.include('110.00');
    expect(nodes.get('row-5h').style.display).to.equal('none');
    expect(nodes.get('row-7d').style.display).to.equal('none');
    const missing = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, { ...defaultState(), activeProvider: 'deepseek' });
    sandbox.render(missing, 'percent');
    expect(nodes.get('account-available').textContent).not.to.include('110.00');
  });
  it('shows a failed balance query instead of leaving an empty account spinning', () => {
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'deepseek' });
    store.dispatch({ type: 'API_ERROR', payload: { error: 'Balance query failed', networkError: true } });
    const presenter = new StatusBarPresenter(store, getProvider('deepseek'));
    try {
      expect((presenter as any).itemWeekly.text).to.include('Balance unavailable');
      expect((presenter as any).itemWeekly.text).not.to.include('sync~spin');
    } finally { presenter.dispose(); }
  });
});
