import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { Store } from '../src/store';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { DashboardPanel } from '../src/presenters/dashboard';
import { LocalUsageService } from '../src/services/localUsageService';
import { createGlmProvider } from '../src/providers/glm';
import { createKimiProvider } from '../src/providers/kimi';
import { MemorySecretStorage } from './mocks/vscode';
import { GlmApiProvider } from '../src/providers/glm/api';
import { Script } from 'vm';

describe('Local usage without remote quota', () => {
  it('keeps local costs visible when login is missing or expired', async () => {
    for (const auth of ['missing', 'expired', 'failed'] as const) {
      const store = new Store();
      store.dispatch({ type: 'SET_PROVIDER', payload: 'glm' });
      store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { costToday: 1.25, tokensToday: 1200,
        requests5h: 1, requests7d: 1, requestsThisCycle: 1 } });
      store.dispatch({ type: 'AUTH_STATUS', payload: auth });
      const presenter = new StatusBarPresenter(store, createGlmProvider());
      try {
        const item = (presenter as any).itemWeekly;
        expect(item.text).to.include('1.25');
        expect(item.text).not.to.include('%');
        const tooltip = (await (presenter as any).buildTooltip(store.getState())).value;
        expect(tooltip).to.include('1.25');
        expect(tooltip).to.include('command:aiStatusHub.signIn');
        expect(tooltip).not.to.include('<svg');
      } finally { presenter.dispose(); }
    }
  });
  it('reports unavailable quotas separately from local dashboard totals', () => {
    const store = new Store();
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { costToday: 1.25, tokensToday: 1200 } });
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, store.getState());
    expect(usage.quotaAvailable).to.equal(false);
    expect(usage.costDay).to.equal(1.25);
    expect(usage.tokensInDay).to.equal(1200);
  });
  it('renders unavailable quota warnings without losing local window costs', () => {
    const html = (DashboardPanel.prototype as any).getHtml.call(
      { store: { getState: () => new Store().getState() } }, 'nonce', 'en') as string;
    const elements = new Map<string, any>();
    const document = { getElementById(id: string) {
      if (!elements.has(id)) elements.set(id, { style: {}, textContent: '', className: '' });
      return elements.get(id);
    } };
    const source = html.slice(html.indexOf('    function renderCurrentUsage('), html.indexOf('      // Memory breakdown')) + '\n}';
    const sandbox: any = { document, labels: { cost: 'Cost ', estimate: 'Estimate' }, CURRENCY_SYMBOL: '¥' };
    new Script(source + '\nglobalThis.render = renderCurrentUsage;').runInNewContext(sandbox);
    sandbox.render({ quotaAvailable: false, cost5h: 1.25, cost7d: 2.5 }, 'percent');
    expect(document.getElementById('lbl-7d').textContent).not.to.include('%');
    expect(document.getElementById('lbl-7d').style.color).to.equal('var(--vscode-errorForeground)');
    expect(document.getElementById('cost-7d').textContent).to.include('2.50');
    expect(document.getElementById('quota-warning').style.display).to.equal('');
    sandbox.render({ quotaAvailable: true, utilization5h: 0.25, utilization7d: 0.5 }, 'percent');
    expect(document.getElementById('lbl-7d').textContent).to.equal('50.00%');
    expect(document.getElementById('lbl-7d').style.color).to.equal('');
  });
});

describe('GLM login guidance', () => {
  beforeEach(() => sinon.stub(GlmApiProvider.prototype, 'fetchQuota').resolves({ ok: true, data: {} as any }));
  afterEach(() => sinon.restore());
  it('offers a manual link and stores the supplied key in SecretStorage', async () => {
    const auth = createGlmProvider().auth;
    auth.initSecrets!(new MemorySecretStorage() as any);
    const info = sinon.stub(vscode.window, 'showInformationMessage').resolves('Open login page' as any);
    const browser = sinon.stub(vscode.env, 'openExternal').resolves(true);
    sinon.stub(vscode.window, 'showInputBox').resolves(' test-key ' as any);
    expect(await auth.startLoginFlow!()).to.equal(true);
    expect(info.firstCall.args.join(' ')).to.include('https://bigmodel.cn/');
    expect(browser.calledOnce).to.equal(true);
    auth.invalidate();
    expect(await auth.resolveToken()).to.equal('test-key');
    expect(auth.getCredentialType!()).to.equal('api-key');
  });
  it('does not authenticate when key entry is cancelled or storage fails', async () => {
    const auth = createGlmProvider().auth;
    auth.initSecrets!(new MemorySecretStorage() as any);
    sinon.stub(vscode.window, 'showInformationMessage').resolves('Enter API Key' as any);
    const input = sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
    expect(await auth.startLoginFlow!()).to.equal(false);
    input.resolves('key' as any);
    auth.initSecrets!({ store: async () => { throw new Error('unavailable'); } } as any);
    expect(await auth.startLoginFlow!()).to.equal(false);
  });
  it('keeps a manual URL visible if the browser cannot open', async () => {
    const auth = createGlmProvider().auth;
    auth.initSecrets!(new MemorySecretStorage() as any);
    sinon.stub(vscode.window, 'showInformationMessage').resolves('Open login page' as any);
    sinon.stub(vscode.env, 'openExternal').rejects(new Error('no browser'));
    const warning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
    sinon.stub(vscode.window, 'showInputBox').resolves(undefined);
    expect(await auth.startLoginFlow!()).to.equal(false);
    expect(warning.firstCall.args[0]).to.include('https://bigmodel.cn/');
  });
});

describe('Cline usage aggregation', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-usage-')); });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
  it('uses timestamped model metadata for legacy messages and respects retention', async () => {
    const dir = path.join(root, 'tasks', 'legacy');
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now() - 1000;
    fs.writeFileSync(path.join(dir, 'task_metadata.json'), JSON.stringify({ model_usage: [
      { ts: ts - 100, model_id: 'kimi-k2.6' }, { ts: ts + 10, model_id: 'glm-4' },
    ] }));
    fs.writeFileSync(path.join(dir, 'ui_messages.json'), JSON.stringify([
      { ts, say: 'api_req_started', text: JSON.stringify({ tokensIn: 100 }) },
      { ts: ts + 20, say: 'api_req_started', text: JSON.stringify({ tokensIn: 300 }) },
      { ts: ts - 3 * 86400000, say: 'api_req_started', modelInfo: { modelId: 'glm-4' }, text: JSON.stringify({ tokensIn: 999 }) },
    ]));
    for (const [provider, expected] of [[createGlmProvider(), 300], [createKimiProvider(), 100]] as const) {
      provider.localUsage = { scanSessions: async () => [], getRateLimits: async () => null, invalidate() {} };
      const service = new LocalUsageService([root]);
      service.setProvider(provider);
      const usage = await service.getLocalUsage({ dataRetentionDays: 1 });
      expect(usage.entries).to.have.length(1);
      expect(usage.tokensToday).to.equal(expected);
    }
  });
  it('routes request models and skips ambiguous, broken and other-provider records', async () => {
    const dir = path.join(root, 'tasks', 'task-1');
    fs.mkdirSync(dir, { recursive: true });
    const ts = Date.now();
    fs.writeFileSync(path.join(dir, 'ui_messages.json'), JSON.stringify([
      { ts, say: 'api_req_started', modelInfo: { modelId: 'glm-4', providerId: 'zai' }, text: JSON.stringify({ tokensIn: 100, tokensOut: 20, cacheReads: 5, cacheWrites: 3 }) },
      { ts: ts + 1, say: 'api_req_started', text: JSON.stringify({ model: 'kimi-k2.6', tokensIn: 200, tokensOut: 30 }) },
      { ts: ts + 2, say: 'api_req_started', text: '{broken' },
      { ts: ts + 3, say: 'api_req_started', text: JSON.stringify({ tokensIn: 999 }) },
      { ts: ts + 4, say: 'api_req_started', text: JSON.stringify({ model: 'claude-sonnet-4', tokensIn: 999 }) },
    ]));
    for (const [provider, expected] of [[createGlmProvider(), 100], [createKimiProvider(), 200]] as const) {
      provider.localUsage = { scanSessions: async () => [], getRateLimits: async () => null, invalidate() {} };
      const service = new LocalUsageService([root]);
      service.setProvider(provider);
      const usage = await service.getLocalUsage();
      expect(usage.entries).to.have.length(1);
      expect(usage.tokensToday).to.equal(expected);
      expect(usage.costToday).to.be.greaterThan(0);
      expect((await service.getLocalUsage()).entries).to.have.length(1);
    }
    fs.unlinkSync(path.join(dir, 'ui_messages.json'));
    const service = new LocalUsageService([root]);
    const provider = createGlmProvider();
    provider.localUsage = { scanSessions: async () => [], getRateLimits: async () => null, invalidate() {} };
    service.setProvider(provider);
    expect((await service.getLocalUsage()).entries).to.have.length(0);
  });
});
