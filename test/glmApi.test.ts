import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createGlmProvider } from '../src/providers/glm';
import { GlmAuthProvider } from '../src/providers/glm/auth';
import { MemorySecretStorage } from './mocks/vscode';
import * as calc from '../src/calc';
import { GlmApiProvider } from '../src/providers/glm/api';
import { Store } from '../src/store';
import { DashboardPanel } from '../src/presenters/dashboard';
import { StatusBarPresenter } from '../src/presenters/statusBar';

const response = (type = 'CREDIT_LIMIT') => ({ code: 200, success: true, data: { limits: [
  { type, unit: 3, number: 5, percentage: 12, usage: 2000, currentValue: 240, remaining: 1760, nextResetTime: 2000000000000 },
  { type, unit: 6, number: 1, percentage: 34, usage: 10000, currentValue: 3400, remaining: 6600, nextResetTime: 2000100000000 },
  { type: 'TIME_LIMIT', percentage: 99, usage: 1000, currentValue: 990 },
] } });

describe('GLM quota API', () => {
  afterEach(() => sinon.restore());
  function create(fetcher: any) {
    return new GlmApiProvider(fetcher);
  }
  it('queries the official read-only endpoint using raw Authorization', async () => {
    const fetcher = sinon.stub().resolves({ status: 200, text: async () => JSON.stringify(response()) });
    const result = await create(fetcher).fetchQuota('fixture-key');
    expect(result.ok).to.equal(true);
    expect(result.data).to.include({ weeklyUsedPct: 34, windowUsedPct: 12, windowRemaining: 1760 });
    expect(fetcher.firstCall.args[0]).to.equal('https://open.bigmodel.cn/api/monitor/usage/quota/limit');
    expect(fetcher.firstCall.args[1].method).to.equal('GET');
    expect(fetcher.firstCall.args[1].headers.Authorization).to.equal('fixture-key');
    expect(fetcher.firstCall.args[1].body).to.equal(undefined);
    expect(createGlmProvider().api.constructor.name).to.equal('GlmApiProvider');
  });
  it('supports old TOKENS_LIMIT and current CREDIT_LIMIT windows without confusing MCP monthly usage', () => {
    for (const type of ['TOKENS_LIMIT', 'CREDIT_LIMIT']) {
      const result = calc.parseGlmQuota(response(type))!;
      expect(result).to.include({ weeklyUsedPct: 34, windowUsedPct: 12, has5hLimit: true, has7dLimit: true });
      expect(result.weeklyResetAt).to.equal(2000100000000);
    }
  });
  it('accepts true zero usage, computes omitted percentages, and marks missing weekly quota', () => {
    const raw = { limits: [{ type: 'TOKENS_LIMIT', percentage: 0 }] };
    const result = calc.parseGlmQuota(raw);
    expect(result).to.include({ windowUsedPct: 0, has5hLimit: true, has7dLimit: false });
    const computed = calc.parseGlmQuota({ limits: [
      { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 100, currentValue: 25, nextResetTime: 2000000000 },
    ] });
    expect(computed).to.include({ weeklyUsedPct: 25, weeklyResetAt: 2000000000000, has5hLimit: false });
  });
  it('rejects malformed or unsuccessful payloads instead of reporting a false zero', () => {
    for (const value of [null, {}, { limits: [] }, { success: false, data: response().data },
      { code: 401, data: response().data }, { limits: [{ type: 'TIME_LIMIT', percentage: 1 }] },
      { limits: [{ type: 'TOKENS_LIMIT', percentage: -1 }] },
      { limits: [{ type: 'TOKENS_LIMIT', unit: 3, number: 24, percentage: 1 }] }]) {
      expect(calc.parseGlmQuota(value)).to.equal(null);
    }
  });
  it('classifies HTTP and business-level authentication errors without leaking response bodies', async () => {
    for (const status of [401, 403]) {
      const result = await create(async () => ({ status })).fetchQuota('secret');
      expect(result.authFailed).to.equal(true);
      expect(result.error).not.to.include('secret');
    }
    const result = await create(async () => ({ status: 200, text: async () => JSON.stringify({ code: 401,
      success: false, msg: 'secret must not be echoed' }) })).fetchQuota('secret');
    expect(result.authFailed).to.equal(true);
    expect(result.error).not.to.include('secret');
  });
  it('distinguishes missing personal-plan quota from network and parse failures', async () => {
    const missing = await create(async () => ({ status: 200, text: async () => '{"success":true,"data":{"limits":[]}}' })).fetchQuota('key');
    expect(missing.authFailed).not.to.equal(true);
    expect(missing.error).to.include('Coding Plan');
    for (const fetcher of [async () => { throw new Error('private request details'); },
      async () => ({ status: 200, text: async () => '{bad' })]) {
      const result = await create(fetcher).fetchQuota('secret');
      expect(result.ok).to.equal(false);
      expect(result.error).not.to.include('private');
    }
  });
  it('reports rate limiting and server failures as retryable without invalidating the key', async () => {
    for (const status of [429, 500]) {
      const result = await create(async () => ({ status })).fetchQuota('key');
      expect(result.networkError).to.equal(true);
      expect(result.authFailed).not.to.equal(true);
      expect(result.error).to.include(String(status));
    }
  });
  it('preserves numeric-string counts and caps over-quota percentages', () => {
    const result = calc.parseGlmQuota({ code: '200', limits: [
      { type: 'CREDIT_LIMIT', unit: '6', number: '1', usage: '100', currentValue: '110', nextResetTime: '2000000000000' },
    ] });
    expect(result).to.include({ weeklyLimit: 100, weeklyUsed: 110, weeklyUsedPct: 100 });
    for (const percentage of [null, '', NaN, Infinity, 'bad']) {
      expect(calc.parseGlmQuota({ limits: [{ type: 'TOKENS_LIMIT', percentage }] })).to.equal(null);
    }
  });
  it('aborts a stalled quota read and releases its timeout after successful requests', async () => {
    const clock = sinon.useFakeTimers();
    try {
      expect((await create(async () => ({ status: 200, text: async () => JSON.stringify(response()) })).fetchQuota('key')).ok).to.equal(true);
      expect(clock.countTimers()).to.equal(0);
      const pending = create(async (_url: string, opts: any) => new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })).fetchQuota('key');
      await clock.tickAsync(15000);
      expect((await pending).networkError).to.equal(true);
      expect(clock.countTimers()).to.equal(0);
    } finally { clock.restore(); }
  });
});

describe('GLM verified login', () => {
  afterEach(() => sinon.restore());
  it('validates before saving and rejects an invalid key without replacing the previous one', async () => {
    const secrets = new MemorySecretStorage();
    await secrets.store('aiStatusHub.glm.apiKey', 'previous-key');
    const fetchQuota = sinon.stub().resolves({ ok: false, authFailed: true, error: 'Invalid key' });
    const auth = new GlmAuthProvider({ fetchQuota });
    auth.initSecrets(secrets);
    sinon.stub(vscode.window, 'showInformationMessage').resolves('Enter API Key' as any);
    sinon.stub(vscode.window, 'showInputBox').resolves('invalid-key' as any);
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    expect(await auth.startLoginFlow()).to.equal(false);
    expect(error.firstCall.args[0]).to.equal('Invalid key');
    expect(await secrets.get('aiStatusHub.glm.apiKey')).to.equal('previous-key');
    fetchQuota.resolves({ ok: true, data: {} });
    expect(await auth.startLoginFlow()).to.equal(true);
    expect(await auth.resolveToken()).to.equal('invalid-key');
  });
  it('prefers the explicitly entered key over an older environment key', async () => {
    const secrets = new MemorySecretStorage();
    await secrets.store('aiStatusHub.glm.apiKey', 'entered-key');
    const previous = process.env.GLM_API_KEY;
    process.env.GLM_API_KEY = 'old-environment-key';
    try {
      const auth = new GlmAuthProvider();
      auth.initSecrets(secrets);
      expect(await auth.resolveToken()).to.equal('entered-key');
    } finally {
      if (previous === undefined) delete process.env.GLM_API_KEY;
      else process.env.GLM_API_KEY = previous;
    }
  });
});

describe('GLM quota display', () => {
  it('does not invent a weekly percentage for five-hour-only plans', async () => {
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'glm' });
    const quota = calc.parseGlmQuota({ limits: [{ type: 'TOKENS_LIMIT', percentage: 12 }] })!;
    store.dispatch({ type: 'API_SUCCESS', payload: quota });
    const text = calc.formatProviderStatus(store.getState(), 'G', 'GLM', 'percent');
    expect(text).to.include('5️⃣ 12.00%');
    expect(text).not.to.include('GLM:0.00%');
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, store.getState());
    expect(usage.weeklyQuotaAvailable).to.equal(false);
    const presenter = new StatusBarPresenter(store, createGlmProvider());
    try {
      const tooltip = (await (presenter as any).buildTooltip(store.getState())).value;
      expect(tooltip).not.to.include('0.00%');
    } finally { presenter.dispose(); }
  });
  it('shows the query failure instead of spinning indefinitely without local records', async () => {
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'glm' });
    store.dispatch({ type: 'AUTH_STATUS', payload: 'authenticated' });
    store.dispatch({ type: 'API_ERROR', payload: { error: 'No personal Coding Plan quota', authFailed: false, networkError: false } });
    const presenter = new StatusBarPresenter(store, createGlmProvider());
    try {
      expect((presenter as any).itemWeekly.text).not.to.include('sync~spin');
      const tooltip = (await (presenter as any).buildTooltip(store.getState())).value;
      expect(tooltip).to.include('No personal Coding Plan quota');
      const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, store.getState());
      expect(usage.quotaError).to.equal('No personal Coding Plan quota');
    } finally { presenter.dispose(); }
  });
});
