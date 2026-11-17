// DESIGN: v2-test-design.md#kimi-web-membership
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as calc from '../src/calc';
import { KimiApiProvider } from '../src/providers/kimi/api';
import { KimiAuthProvider } from '../src/providers/kimi/auth';
import { MemorySecretStorage, makeContext } from './mocks/vscode';
import { activate, deactivate } from '../src/extension';
import { Scheduler } from '../src/services/scheduler';
import { CacheService } from '../src/services/cacheService';
import { ApiHistoryService } from '../src/services/apiHistoryService';
import { DashboardPanel } from '../src/presenters/dashboard';
import { defaultState } from '../src/store';
import { Script } from 'vm';

const snapshot = () => ({ subscription_balance: { amount_used_ratio: 0.8317,
  kimi_code_used_ratio: 0.5053, expire_time: '2026-12-01T00:00:00Z' } });
const legacy = () => ({ usage: { limit: 100, used: 20 }, limits: [{ detail: { limit: 100, used: 1 } }] });
const response = (data: unknown) => ({ status: 200, ok: true, json: async () => data });

describe('Kimi web membership', () => {
  afterEach(() => sinon.restore());
  it('parses the website total and Code share without adding them or inventing empty values', () => {
    const parse = (calc as any).parseKimiMembershipUsage;
    const result = parse(snapshot());
    expect(result.monthlyUsedPct).to.be.closeTo(83.17, 1e-6);
    expect(result.monthlyCodeUsedPct).to.be.closeTo(50.53, 1e-6);
    expect(result).to.include({ monthlyFromMembership: true, monthlyCodeIsShared: true,
      monthlyResetAt: Date.parse('2026-12-01T00:00:00Z') });
    expect(parse({ subscriptionBalance: { amountUsedRatio: 0, kimiCodeUsedRatio: 0 } }))
      .to.include({ monthlyUsedPct: 0, monthlyCodeUsedPct: 0 });
    for (const raw of [null, {}, { subscription_balance: {} }, { subscription_balance: { amount_used_ratio: -1 } }]) {
      expect(parse(raw)).to.equal(null);
    }
  });
  it('queries the actual website RPC with validated TLS and a fixed read-only body', async () => {
    const { KimiMembershipApi } = require('../src/providers/kimi/membershipApi');
    const fetcher = sinon.stub().resolves(response(snapshot()));
    expect((await new KimiMembershipApi(fetcher).fetchMonthly('web-fixture')).ok).to.equal(true);
    const [url, options] = fetcher.firstCall.args;
    expect(url).to.equal('https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats');
    expect(options.headers.Authorization).to.equal('Bearer web-fixture');
    expect(JSON.parse(options.body)).to.deep.equal({ mute_notice: false });
    expect(options.redirect).to.equal('error');
    expect(options.agent.options.rejectUnauthorized).to.equal(true);
  });
  it('supplements missing monthly data using a separately stored web token, leaving coding credentials isolated', async () => {
    const fetcher = sinon.stub().onFirstCall().resolves(response(legacy())).onSecondCall().resolves(response(snapshot()));
    const api = new (KimiApiProvider as any)(fetcher, async () => 'web-fixture');
    const result = await api.fetchQuota('coding-fixture');
    expect(result.data).to.include({ weeklyUsedPct: 20, windowUsedPct: 1 });
    expect(result.data.monthlyUsedPct).to.be.closeTo(83.17, 1e-6);
    expect(fetcher.firstCall.args[1].headers.Authorization).to.equal('Bearer coding-fixture');
    expect(fetcher.secondCall.args[1].headers.Authorization).to.equal('Bearer web-fixture');
  });
  it('tries the current authorized token when no extra web token is configured', async () => {
    const fetcher = sinon.stub().onFirstCall().resolves(response(legacy())).onSecondCall().resolves(response(snapshot()));
    const result = await new KimiApiProvider(fetcher as any).fetchQuota('coding-fixture');
    expect(result.data?.monthlyUsedPct).to.be.closeTo(83.17, 1e-6);
    expect(fetcher.secondCall.args[1].headers.Authorization).to.equal('Bearer coding-fixture');
  });
  it('keeps valid coding quota when the website rejects authorization and avoids extra calls for complete monthly data', async () => {
    const fetcher = sinon.stub().onFirstCall().resolves(response(legacy())).onSecondCall().resolves({ status: 401 });
    const result = await new KimiApiProvider(fetcher as any).fetchQuota('coding-fixture');
    expect(result.ok).to.equal(true);
    expect(result.authFailed).not.to.equal(true);
    expect(result.data?.monthlyUsedPct).to.equal(undefined);
    expect(fetcher.calledTwice).to.equal(true);
    const complete = sinon.stub().resolves(response({ usages: { limit_month_total: { used_ratio: 0.3 } } }));
    expect((await new KimiApiProvider(complete as any).fetchQuota('coding-fixture')).data?.monthlyUsedPct).to.equal(30);
    expect(complete.calledOnce).to.equal(true);
  });
  it('validates the web token before private storage and preserves the old token on cancellation or failed checks', async () => {
    const auth = new KimiAuthProvider(sinon.stub().resolves(response(snapshot())) as any) as any;
    const secrets = new MemorySecretStorage();
    await secrets.store('aiStatusHub.apiKey', 'coding-fixture');
    auth.initSecrets(secrets);
    sinon.stub(vscode.window, 'showInformationMessage').resolves('Enter web token' as any);
    const input = sinon.stub(vscode.window, 'showInputBox').resolves(' web-fixture ' as any);
    expect(await auth.startMembershipLoginFlow()).to.equal(true);
    expect(await auth.resolveWebToken()).to.equal('web-fixture');
    expect(await secrets.get('aiStatusHub.apiKey')).to.equal('coding-fixture');
    expect(input.firstCall.args[0]?.password).to.equal(true);
    input.resolves(undefined);
    expect(await auth.startMembershipLoginFlow()).to.equal(false);
    expect(await auth.resolveWebToken()).to.equal('web-fixture');
    const denied = new KimiAuthProvider((async () => ({ status: 401 })) as any) as any;
    denied.initSecrets(secrets);input.resolves('invalid' as any);
    expect(await denied.startMembershipLoginFlow()).to.equal(false);
    expect(await auth.resolveWebToken()).to.equal('web-fixture');
  });
  it('labels Code as a share of the member pool and shows a connection action when monthly data is absent', () => {
    const monthly = (calc as any).parseKimiMembershipUsage(snapshot());
    const quota = { ...calc.parseKimiQuota(legacy())!, ...monthly };
    const state = { ...defaultState(), activeProvider: 'kimi', quota };
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
    expect(usage.monthlyCodeLabel).to.include('share');
    const html = (DashboardPanel.prototype as any).getHtml.call({ store: { getState: () => state } }, 'nonce', 'en');
    expect(html).to.include('id="btn-kimi-membership"');
    const nodes = new Map<string, any>();
    const document = { getElementById(id: string) {
      if (!nodes.has(id)) nodes.set(id, { style: {}, textContent: '' });
      return nodes.get(id);
    } };
    const messages: any[] = [];
    const source = html.slice(html.indexOf('    function renderCurrentUsage('), html.indexOf('      // Memory breakdown')) + '\n}';
    const sandbox: any = { document, labels: {}, CURRENCY_SYMBOL: '¥', vscode: { postMessage: (m: any) => messages.push(m) } };
    new Script(source + '\nglobalThis.render = renderCurrentUsage;').runInNewContext(sandbox);
    sandbox.render(usage, 'percent');
    expect(nodes.get('label-code-month').textContent).to.include('share');
    const missing = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, { ...state, quota: calc.parseKimiQuota(legacy()) });
    sandbox.render(missing, 'percent');
    expect(nodes.get('btn-kimi-membership').style.display).to.equal('');
    nodes.get('btn-kimi-membership').onclick();
    expect(messages[0].type).to.equal('connectKimiMembership');
  });
  it('contains web network, JSON and storage failures without exposing tokens', async () => {
    const { KimiMembershipApi } = require('../src/providers/kimi/membershipApi');
    for (const fetcher of [async () => { throw new Error('private-web-fixture'); },
      async () => response({}), async () => ({ status: 200, ok: true, json: async () => { throw new Error('private-web-fixture'); } })]) {
      const result = await new KimiMembershipApi(fetcher).fetchMonthly('private-web-fixture');
      expect(result.ok).to.equal(false);
      expect(JSON.stringify(result)).not.to.include('private-web-fixture');
    }
    const auth = new KimiAuthProvider(sinon.stub().resolves(response(snapshot())) as any) as any;
    auth.initSecrets({ get: async () => { throw new Error('private-web-fixture'); },
      store: async () => { throw new Error('private-web-fixture'); } });
    expect(await auth.resolveWebToken()).to.equal(undefined);
    sinon.stub(vscode.window, 'showInformationMessage').resolves('Enter web token' as any);
    sinon.stub(vscode.window, 'showInputBox').resolves('private-web-fixture' as any);
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    expect(await auth.startMembershipLoginFlow()).to.equal(false);
    expect(JSON.stringify(error.args)).not.to.include('private-web-fixture');
  });
  it('aborts a stalled membership query and clears its timer', async () => {
    const { KimiMembershipApi } = require('../src/providers/kimi/membershipApi');
    const clock = sinon.useFakeTimers();
    try {
      const fetcher = (_url: string, options: any) => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      });
      const pending = new KimiMembershipApi(fetcher).fetchMonthly('fixture');
      await clock.tickAsync(15_000);
      expect((await pending).ok).to.equal(false);
      expect(clock.countTimers()).to.equal(0);
    } finally { clock.restore(); }
  });
  it('connects the membership command to Kimi refresh and removes the web credential on Kimi sign out', async () => {
    const commands = new Map<string, Function>();
    sinon.stub(vscode.workspace, 'getConfiguration').returns({ get: (key: string, fallback: unknown) => key === 'provider' ? 'kimi' : fallback } as any);
    sinon.stub(vscode.commands, 'registerCommand').callsFake((name: string, callback: any) => {
      commands.set(name, callback); return { dispose() {} };
    });
    sinon.stub(Scheduler.prototype, 'start');
    const force = sinon.stub(Scheduler.prototype, 'force');
    sinon.stub(CacheService.prototype, 'read').resolves(null);
    sinon.stub(ApiHistoryService.prototype, 'readFromDisk').resolves([]);
    const login = sinon.stub(KimiAuthProvider.prototype, 'startMembershipLoginFlow').resolves(true);
    const context = makeContext();
    await context.secrets.store('aiStatusHub.kimi.membershipWebToken', 'fixture-web');
    await context.secrets.store('aiStatusHub.volcengine.apiKey', 'fixture-ark');
    try {
      await activate(context as any);
      await commands.get('aiStatusHub.kimiConnectMembership')!();
      expect(login.calledOnce).to.equal(true);
      expect(force.calledOnce).to.equal(true);
      await commands.get('aiStatusHub.signOut')!('kimi');
      expect(await context.secrets.get('aiStatusHub.kimi.membershipWebToken')).to.equal(undefined);
      expect(await context.secrets.get('aiStatusHub.volcengine.apiKey')).to.equal('fixture-ark');
    } finally { for (const item of context.subscriptions) item.dispose(); await deactivate(); }
  });
});
