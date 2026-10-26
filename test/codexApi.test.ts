import { expect } from 'chai';
import * as sinon from 'sinon';
import { CodexApiProvider } from '../src/providers/codex/api';
import { CacheService } from '../src/services/cacheService';
import { parseCodexUsage } from '../src/calc';

describe('Codex authoritative usage', () => {
  afterEach(() => sinon.restore());
  const payload = (used: number) => ({ rate_limit: {
    primary_window: { used_percent: used, limit_window_seconds: 604800, reset_at: 2000000000 },
  } });

  it('reads current usage with GET and accepts an early reset without creating a model request', async () => {
    sinon.stub(CacheService.prototype as any, 'readCodexAccountId').resolves('fixture-account');
    let used = 90;
    const fetcher = sinon.stub().callsFake(async () => ({ status: 200, text: async () => JSON.stringify(payload(used)) }));
    const provider = new CodexApiProvider(fetcher as any);
    expect((await provider.fetchQuota('fixture-token')).data?.weeklyUsedPct).to.equal(90);
    used = 0;
    expect((await provider.fetchQuota('fixture-token')).data?.weeklyUsedPct).to.equal(0);
    expect(fetcher.callCount).to.equal(2);
    expect(fetcher.firstCall.args[0]).to.equal('https://chatgpt.com/backend-api/wham/usage');
    expect(fetcher.firstCall.args[1].method).to.equal('GET');
    expect(fetcher.firstCall.args[1].body).to.equal(undefined);
    expect(fetcher.firstCall.args[1].headers['chatgpt-account-id']).to.equal('fixture-account');
  });

  it('parses zero usage and both official quota windows', () => {
    const result = parseCodexUsage({ rate_limit: {
      primary_window: { used_percent: 0, limit_window_seconds: 18000, reset_after_seconds: 0 },
      secondary_window: { used_percent: 12, limit_window_seconds: 604800, reset_at: 2000000000 },
    } }, 1000);
    expect(result?.windowUsedPct).to.equal(0);
    expect(result?.has5hLimit).to.equal(true);
    expect(result?.weeklyUsedPct).to.equal(12);
    expect(result?.weeklyResetAt).to.equal(2000000000000);
  });

  it('does not turn missing or malformed usage into a successful zero reset', () => {
    for (const value of [null, {}, { rate_limit: null }, { rate_limit: { primary_window: { used_percent: '0' } } }]) {
      expect(parseCodexUsage(value, 1000)).to.equal(null);
    }
  });

  it('reports auth errors and invalid JSON without exposing credentials', async () => {
    sinon.stub(CacheService.prototype as any, 'readCodexAccountId').resolves(undefined);
    const denied = new CodexApiProvider((async () => ({ status: 401 })) as any);
    expect((await denied.fetchQuota('fixture')).authFailed).to.equal(true);
    const corrupt = new CodexApiProvider((async () => ({ status: 200, text: async () => 'broken JSON' })) as any);
    expect((await corrupt.fetchQuota('fixture')).ok).to.equal(false);
  });
});
