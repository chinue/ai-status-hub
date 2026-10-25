import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { KimiAuthProvider } from '../src/providers/kimi/auth';
import { CacheService } from '../src/services/cacheService';
import { MemorySecretStorage } from './mocks/vscode';

describe('Kimi shared login', () => {
  afterEach(() => sinon.restore());

  it('prefers current shared credentials over a stale private login and rereads changes', async () => {
    let token = 'shared-one';
    sinon.stub(CacheService.prototype as any, 'readKimiCredentials').callsFake(async () => [{
      access_token: token, expires_at: Date.now() + 3600_000,
    }]);
    const fetcher = sinon.stub().rejects(new Error('network must not be needed'));
    const auth = new KimiAuthProvider(fetcher as any);
    const secrets = new MemorySecretStorage();
    await secrets.store('aiStatusHub.oauthCredentials', JSON.stringify({ accessToken: 'stale', expiresAt: 1 }));
    auth.initSecrets(secrets as any);
    expect(await auth.resolveToken()).to.equal('shared-one');
    token = 'shared-two';
    expect(await auth.resolveToken()).to.equal('shared-two');
    expect(fetcher.called).to.equal(false);
  });

  it('skips expired or malformed shared files and supports legacy seconds', async () => {
    sinon.stub(CacheService.prototype as any, 'readKimiCredentials').resolves([
      { access_token: 'expired', expires_at: 1 }, { access_token: 123 },
      { access_token: 'legacy', expires_at: Date.now() / 1000 + 3600 },
    ]);
    expect(await new KimiAuthProvider().resolveToken()).to.equal('legacy');
  });

  it('reuses the existing login without starting browser authorization', async () => {
    sinon.stub(CacheService.prototype as any, 'readKimiCredentials').resolves([
      { access_token: 'shared', expires_at: Date.now() / 1000 + 3600 },
    ]);
    const fetcher = sinon.stub().rejects(new Error('unexpected network'));
    const info = sinon.spy(vscode.window, 'showInformationMessage');
    expect(await new KimiAuthProvider(fetcher as any).startLoginFlow()).to.equal(true);
    expect(fetcher.called).to.equal(false);
    expect(info.called).to.equal(true);
  });

  it('shows progress and catches authorization polling failures', async () => {
    sinon.stub(CacheService.prototype as any, 'readKimiCredentials').resolves([]);
    const fetcher = sinon.stub();
    fetcher.onFirstCall().resolves({ status: 200, text: async () => JSON.stringify({
      device_code: 'test-device', user_code: 'TEST', verification_uri: 'https://auth.kimi.com/test',
      expires_in: 60, interval: 1,
    }) });
    fetcher.onSecondCall().rejects(new Error('test connection failed'));
    const auth = new KimiAuthProvider(fetcher as any);
    auth.initSecrets(new MemorySecretStorage() as any);
    const error = sinon.spy(vscode.window, 'showErrorMessage');
    const info = sinon.spy(vscode.window, 'showInformationMessage');
    sinon.stub(vscode.env as any, 'openExternal').resolves(true);
    const clock = sinon.useFakeTimers();
    try {
      const result = auth.startLoginFlow();
      await clock.tickAsync(1100);
      expect(await result).to.equal(false);
      expect(info.called).to.equal(true);
      expect(error.called).to.equal(true);
    } finally { clock.restore(); }
  });

  it('saves a successful browser login and makes its token available', async () => {
    sinon.stub(CacheService.prototype as any, 'readKimiCredentials').resolves([]);
    const fetcher = sinon.stub();
    fetcher.onFirstCall().resolves({ status: 200, text: async () => JSON.stringify({
      device_code: 'device', user_code: 'CODE', verification_uri: 'https://auth.kimi.com/test', expires_in: 60, interval: 1,
    }) });
    fetcher.onSecondCall().resolves({ status: 200, text: async () => JSON.stringify({
      access_token: 'new-fixture-token', refresh_token: 'new-fixture-refresh', expires_in: 3600,
    }) });
    const secrets = new MemorySecretStorage();
    const auth = new KimiAuthProvider(fetcher as any);
    auth.initSecrets(secrets as any);
    const clock = sinon.useFakeTimers();
    try {
      const result = auth.startLoginFlow();
      await clock.tickAsync(1100);
      expect(await result).to.equal(true);
      expect(await auth.resolveToken()).to.equal('new-fixture-token');
      expect(JSON.parse((await secrets.get('aiStatusHub.oauthCredentials'))!).refreshToken).to.equal('new-fixture-refresh');
    } finally { clock.restore(); }
  });

  it('reports browser launch failure without polling or leaving a rejected promise', async () => {
    sinon.stub(CacheService.prototype as any, 'readKimiCredentials').resolves([]);
    const fetcher = sinon.stub().resolves({ status: 200, text: async () => JSON.stringify({
      device_code: 'device', user_code: 'CODE', verification_uri: 'https://auth.kimi.com/test', expires_in: 60,
    }) });
    sinon.stub(vscode.env, 'openExternal').resolves(false);
    const error = sinon.spy(vscode.window, 'showErrorMessage');
    const auth = new KimiAuthProvider(fetcher as any);
    auth.initSecrets(new MemorySecretStorage() as any);
    expect(await auth.startLoginFlow()).to.equal(false);
    expect(fetcher.calledOnce).to.equal(true);
    expect(error.calledOnce).to.equal(true);
  });
});
