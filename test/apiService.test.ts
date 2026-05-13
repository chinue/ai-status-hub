import { expect } from 'chai';
import * as sinon from 'sinon';
import * as nodeFetch from 'node-fetch';
import { ApiService } from '../src/services/apiService';

describe('ApiService', () => {
  let api: ApiService;

  beforeEach(() => {
    api = ApiService.getInstance();
  });

  afterEach(() => {
    sinon.restore();
    (ApiService as any).instance = undefined;
  });

  it('parses real Kimi API shape correctly', async () => {
    sinon.stub(nodeFetch, 'default').resolves({
      ok: true, status: 200,
      json: async () => ({
        usage: {
          limit: '10000',
          used: '2500',
          remaining: '7500',
          resetTime: new Date(Date.now() + 86400000).toISOString(),
        },
        limits: [
          {
            detail: {
              limit: '2000',
              used: '500',
              remaining: '1500',
              resetTime: new Date(Date.now() + 18000000).toISOString(),
            },
          },
        ],
        parallel: { limit: '30' },
      }),
    } as any);

    const result = await api.fetchQuota('sk-test');
    expect(result.ok).to.be.true;
    expect(result.data).to.not.be.undefined;
    expect(result.data!.weeklyLimit).to.equal(10000);
    expect(result.data!.weeklyUsed).to.equal(2500);
    expect(result.data!.weeklyUsedPct).to.equal(25); // 2500/10000*100
    expect(result.data!.windowLimit).to.equal(2000);
    expect(result.data!.windowUsed).to.equal(500);
    expect(result.data!.windowUsedPct).to.equal(25); // 500/2000*100
    expect(result.data!.windowRemaining).to.equal(1500);
    expect(result.data!.parallelLimit).to.equal(30);

    // Verify User-Agent header
    const stub = nodeFetch.default as unknown as sinon.SinonStub;
    const callArgs = stub.getCall(0).args[1];
    expect(callArgs.headers['User-Agent']).to.equal('KimiCLI/1.6');
  });

  it('uses API-provided used_pct when present', async () => {
    sinon.stub(nodeFetch, 'default').resolves({
      ok: true, status: 200,
      json: async () => ({
        usage: {
          limit: '1000',
          used: '300',
          used_pct: 33.3,
        },
        limits: [
          {
            detail: {
              limit: '200',
              used: '50',
              used_pct: 25.5,
            },
          },
        ],
      }),
    } as any);

    const result = await api.fetchQuota('sk-test');
    expect(result.ok).to.be.true;
    expect(result.data!.weeklyUsedPct).to.equal(33.3);
    expect(result.data!.windowUsedPct).to.equal(25.5);
  });

  it('returns authFailed on 401', async () => {
    sinon.stub(nodeFetch, 'default').resolves({
      ok: false, status: 401,
      json: async () => ({}),
    } as any);

    const result = await api.fetchQuota('bad-token');
    expect(result.ok).to.be.false;
    expect(result.authFailed).to.be.true;
  });

  it('returns networkError on timeout', async () => {
    sinon.stub(nodeFetch, 'default').rejects(new Error('ETIMEDOUT'));

    const result = await api.fetchQuota('sk-test');
    expect(result.ok).to.be.false;
    expect(result.networkError).to.be.true;
  });
});
