import { expect } from 'chai';
import * as sinon from 'sinon';
import { AuthService } from '../src/services/authService';
import * as utils from '../src/utils';
import { makeContext } from './mocks/vscode';

describe('AuthService', () => {
  let readCliStub: sinon.SinonStub;

  beforeEach(() => {
    (AuthService as any).instance = undefined;
    readCliStub = sinon.stub(utils, 'readKimiCliCredentials').returns(undefined);
  });

  afterEach(() => {
    sinon.restore();
  });

  it('returns undefined when no credentials stored', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    const token = await auth.resolveToken();
    expect(token).to.be.undefined;
  });

  it('returns API key when stored', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('codexStatusPro.apiKey', 'sk-test123');
    const token = await auth.resolveToken();
    expect(token).to.equal('sk-test123');
  });

  it('caches token for 60s', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('codexStatusPro.apiKey', 'sk-test');
    const t1 = await auth.resolveToken();
    await ctx.secrets.store('codexStatusPro.apiKey', 'sk-changed'); // modify storage
    const t2 = await auth.resolveToken(); // should return cached value
    expect(t1).to.equal('sk-test');
    expect(t2).to.equal('sk-test');
  });

  it('invalidate clears cache', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('codexStatusPro.apiKey', 'sk-test');
    await auth.resolveToken();
    auth.invalidate();
    await ctx.secrets.store('codexStatusPro.apiKey', 'sk-new');
    const token = await auth.resolveToken();
    expect(token).to.equal('sk-new');
  });
});
