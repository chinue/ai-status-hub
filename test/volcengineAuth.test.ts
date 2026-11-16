import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createVolcengineProvider } from '../src/providers/volcengine';
import { MemorySecretStorage, makeContext } from './mocks/vscode';
import { activate, deactivate } from '../src/extension';
import { Scheduler } from '../src/services/scheduler';
import { CacheService } from '../src/services/cacheService';
import { ApiHistoryService } from '../src/services/apiHistoryService';
import { VolcengineAuthProvider } from '../src/providers/volcengine/auth';

const SECRET = 'aiStatusHub.volcengine.apiKey';

describe('Volcengine API key login', () => {
  afterEach(() => sinon.restore());

  it('opens a masked input immediately and securely saves only the trimmed Ark key', async () => {
    const provider = createVolcengineProvider();
    const secrets = new MemorySecretStorage();
    provider.auth.initSecrets!(secrets);
    await secrets.store('aiStatusHub.apiKey', 'other-provider');
    const input = sinon.stub(vscode.window, 'showInputBox').resolves('  ark-test-key  ' as any);
    const info = sinon.stub(vscode.window, 'showInformationMessage').resolves(undefined);
    const api = sinon.spy(provider.api, 'fetchQuota');
    expect(await provider.auth.startLoginFlow!()).to.equal(true);
    expect(input.calledOnce).to.equal(true);
    expect(input.firstCall.args[0]).to.include({ password: true, ignoreFocusOut: true });
    expect(info.calledOnce).to.equal(true);
    expect(String(info.firstCall.args[0])).to.not.include('ark-test-key');
    expect(api.called).to.equal(false);
    expect(await secrets.get(SECRET)).to.equal('ark-test-key');
    expect(await secrets.get('aiStatusHub.apiKey')).to.equal('other-provider');
    expect(await provider.auth.resolveToken()).to.equal('ark-test-key');
    provider.auth.invalidate();
    const restored = createVolcengineProvider();
    restored.auth.initSecrets!(secrets);
    expect(await restored.auth.resolveToken()).to.equal('ark-test-key');
    expect(provider.auth.getCredentialType!()).to.equal('api-key');
  });

  for (const value of [undefined, '', '   ']) {
    it(`preserves the previous key when input is ${JSON.stringify(value)}`, async () => {
      const provider = createVolcengineProvider();
      const secrets = new MemorySecretStorage();
      provider.auth.initSecrets!(secrets);
      await secrets.store(SECRET, 'previous');
      sinon.stub(vscode.window, 'showInputBox').resolves(value as any);
      expect(await provider.auth.startLoginFlow!()).to.equal(false);
      expect(await provider.auth.resolveToken()).to.equal('previous');
    });
  }

  it('handles unavailable storage and storage failures without exposing private errors', async () => {
    const provider = createVolcengineProvider();
    sinon.stub(vscode.window, 'showInputBox').resolves('private-test-key' as any);
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    expect(await provider.auth.startLoginFlow!()).to.equal(false);
    const secrets = new MemorySecretStorage();
    provider.auth.initSecrets!(secrets);
    sinon.stub(secrets, 'store').rejects(new Error('private-test-key'));
    expect(await provider.auth.startLoginFlow!()).to.equal(false);
    expect(error.calledTwice).to.equal(true);
    expect(error.getCalls().every(call => !String(call.args[0]).includes('private-test-key'))).to.equal(true);
    sinon.stub(secrets, 'get').rejects(new Error('private-test-key'));
    expect(await provider.auth.resolveToken()).to.equal(undefined);
  });

  it('deletes only its own credential on sign out and reports deletion failure', async () => {
    const provider = createVolcengineProvider();
    const secrets = new MemorySecretStorage();
    provider.auth.initSecrets!(secrets);
    await secrets.store(SECRET, 'ark-key');
    await secrets.store('aiStatusHub.glm.apiKey', 'glm-key');
    expect(await provider.auth.signOut!()).to.equal(true);
    expect(await provider.auth.resolveToken()).to.equal(undefined);
    expect(await secrets.get('aiStatusHub.glm.apiKey')).to.equal('glm-key');
    sinon.stub(secrets, 'delete').rejects(new Error('private-delete-error'));
    const error = sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
    expect(await provider.auth.signOut!()).to.equal(false);
    expect(String(error.firstCall.args[0])).not.to.include('private-delete-error');
  });

  it('connects the login and logout commands to the Ark dialog and private credential', async () => {
    const callbacks = new Map<string, Function>();
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => key === 'provider' ? 'volcengine'
        : key === 'statusBar.providers' ? ['volcengine'] : fallback,
    } as any);
    sinon.stub(vscode.commands, 'registerCommand').callsFake((name: string, callback: any) => {
      callbacks.set(name, callback); return { dispose() {} };
    });
    sinon.stub(Scheduler.prototype, 'start');
    const force = sinon.stub(Scheduler.prototype, 'force');
    sinon.stub(CacheService.prototype, 'read').resolves(null);
    sinon.stub(ApiHistoryService.prototype, 'readFromDisk').resolves([]);
    const input = sinon.stub(vscode.window, 'showInputBox').resolves('ark-command-key' as any);
    const context = makeContext();
    await context.secrets.store('aiStatusHub.apiKey', 'unrelated');
    try {
      await activate(context as any);
      await callbacks.get('aiStatusHub.signIn')!('volcengine');
      expect(input.calledOnce).to.equal(true);
      expect(await context.secrets.get(SECRET)).to.equal('ark-command-key');
      expect(force.calledOnce).to.equal(true);
      expect((force.firstCall.thisValue as any).store.getState().authStatus).to.equal('authenticated');
      const deletion = sinon.stub(context.secrets, 'delete').rejects(new Error('private-delete-error'));
      await callbacks.get('aiStatusHub.signOut')!('volcengine');
      expect(await context.secrets.get(SECRET)).to.equal('ark-command-key');
      expect((force.firstCall.thisValue as any).store.getState().authStatus).to.equal('authenticated');
      deletion.restore();
      await callbacks.get('aiStatusHub.signOut')!('volcengine');
      expect(await context.secrets.get(SECRET)).to.equal(undefined);
      expect(await context.secrets.get('aiStatusHub.apiKey')).to.equal('unrelated');
    } finally {
      for (const item of context.subscriptions) item.dispose();
      await deactivate();
    }
  });
});

describe('Volcengine Coding Plan credentials', () => {
  afterEach(() => sinon.restore());

  it('guides an existing API-key user to enter and verify separate AK/SK credentials', async () => {
    const secrets = new MemorySecretStorage();
    await secrets.store(SECRET, 'inference-key');
    const fetchQuota = sinon.stub().resolves({ ok: true, data: { weeklyUsedPct: 12 } });
    const auth = new VolcengineAuthProvider({ fetchQuota });
    auth.initSecrets(secrets);
    const info = sinon.stub(vscode.window, 'showInformationMessage');
    info.onFirstCall().resolves('Connect Coding Plan quota' as any);
    const input = sinon.stub(vscode.window, 'showInputBox');
    input.onFirstCall().resolves(' test-access ' as any);
    input.onSecondCall().resolves(' test-secret ' as any);
    expect(await auth.startLoginFlow()).to.equal(true);
    expect(input.firstCall.args[0]).to.include({ password: true });
    expect(input.secondCall.args[0]).to.include({ password: true });
    const expected = JSON.stringify({ accessKeyId: 'test-access', secretAccessKey: 'test-secret' });
    expect(fetchQuota.calledOnceWithExactly(expected)).to.equal(true);
    expect(await auth.resolveToken()).to.equal(expected);
    expect(auth.getCredentialType()).to.equal('access-key');
    expect(await secrets.get(SECRET)).to.equal('inference-key');
    const restored = new VolcengineAuthProvider({ fetchQuota });
    restored.initSecrets(secrets);
    expect(await restored.resolveToken()).to.equal(expected);
    expect(await restored.signOut()).to.equal(true);
    expect(await restored.resolveToken()).to.equal(undefined);
  });

  for (const cancel of [true, false]) {
    it(`preserves previous query credentials when ${cancel ? 'input is cancelled' : 'verification fails'}`, async () => {
      const secrets = new MemorySecretStorage();
      await secrets.store(SECRET, 'inference-key');
      const old = JSON.stringify({ accessKeyId: 'old-access', secretAccessKey: 'old-secret' });
      await secrets.store('aiStatusHub.volcengine.quotaCredentials', old);
      const fetchQuota = sinon.stub().resolves({ ok: false, error: 'Access denied' });
      const auth = new VolcengineAuthProvider({ fetchQuota });
      auth.initSecrets(secrets);
      sinon.stub(vscode.window, 'showInformationMessage').resolves('Connect Coding Plan quota' as any);
      const input = sinon.stub(vscode.window, 'showInputBox');
      input.onFirstCall().resolves('new-access' as any);
      input.onSecondCall().resolves(cancel ? undefined : 'new-secret' as any);
      sinon.stub(vscode.window, 'showErrorMessage').resolves(undefined);
      expect(await auth.startLoginFlow()).to.equal(false);
      expect(fetchQuota.called).to.equal(!cancel);
      expect(await auth.resolveToken()).to.equal(old);
    });
  }
});
