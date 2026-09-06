// DESIGN: v2-test-design.md#claude-api

import { expect } from 'chai';
import { ClaudeApiProvider, parseClaudeQuotaHeaders, parseClaudeUsageResponse } from '../src/providers/claude/api';

describe('Claude OAuth usage response', () => {
  it('fetchQuota uses the OAuth usage endpoint so Fable data reaches UnifiedQuota', async () => {
    const calls: Array<{ url: string; method: string | undefined }> = [];
    const fakeFetch = async (url: string, init?: { method?: string }) => {
      calls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          five_hour: { utilization: 12, resets_at: '2026-09-06T05:00:00Z' },
          seven_day: { utilization: 34, resets_at: '2026-09-13T00:00:00Z' },
          limits: [{
            kind: 'weekly_scoped',
            percent: 56,
            resets_at: '2026-09-12T08:30:00Z',
            scope: { model: { display_name: 'Fable' } },
          }],
        }),
      };
    };

    const result = await new ClaudeApiProvider(fakeFetch as any).fetchQuota('oauth-token');

    expect(result.ok).to.equal(true);
    expect(result.data?.fableWeeklyUsedPct).to.equal(56);
    expect(calls).to.deep.equal([{
      url: 'https://api.anthropic.com/api/oauth/usage',
      method: 'GET',
    }]);
  });

  it('reuses a recent OAuth usage response to avoid endpoint rate limits', async () => {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          five_hour: { utilization: 12, resets_at: '2026-09-06T05:00:00Z' },
          seven_day: { utilization: 34, resets_at: '2026-09-13T00:00:00Z' },
          limits: [],
        }),
      };
    };
    const provider = new ClaudeApiProvider(fakeFetch as any);

    await provider.fetchQuota('oauth-token');
    await provider.fetchQuota('oauth-token');

    expect(callCount).to.equal(1);
  });

  it('refetches OAuth usage after its cache is explicitly invalidated', async () => {
    let callCount = 0;
    const fakeFetch = async () => {
      callCount += 1;
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          five_hour: { utilization: 12, resets_at: '2026-09-06T05:00:00Z' },
          seven_day: { utilization: 34, resets_at: '2026-09-13T00:00:00Z' },
          limits: [],
        }),
      };
    };
    const provider = new ClaudeApiProvider(fakeFetch as any);

    await provider.fetchQuota('oauth-token');
    provider.invalidateCache();
    await provider.fetchQuota('oauth-token');

    expect(callCount).to.equal(2);
  });

  it('skips the OAuth-only usage endpoint for API key credentials', async () => {
    const calls: Array<{ url: string; headers: Record<string, string> }> = [];
    const fakeFetch = async (url: string, init?: { headers?: Record<string, string> }) => {
      calls.push({ url, headers: init?.headers ?? {} });
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
      };
    };

    const result = await new ClaudeApiProvider(fakeFetch as any).fetchQuota('api-key', {
      credentialType: 'api-key',
    });

    expect(result.ok).to.equal(true);
    expect(calls).to.have.length(1);
    expect(calls[0].url).to.equal('https://api.anthropic.com/v1/messages');
    expect(calls[0].headers['x-api-key']).to.equal('api-key');
    expect(calls[0].headers.Authorization).to.equal(undefined);
    expect(calls[0].headers['anthropic-beta']).to.equal(undefined);
  });

  it('falls back to the Messages probe when OAuth usage is unavailable', async () => {
    const calls: string[] = [];
    const headerValues: Record<string, string> = {
      'anthropic-ratelimit-unified-5h-utilization': '0.1',
      'anthropic-ratelimit-unified-7d-utilization': '0.2',
    };
    const fakeFetch = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/api/oauth/usage')) {
        return { ok: false, status: 429, text: async () => '' };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name: string) => headerValues[name] ?? null },
        text: async () => '',
      };
    };

    const result = await new ClaudeApiProvider(fakeFetch as any).fetchQuota('oauth-token');

    expect(result.ok).to.equal(true);
    expect(result.data?.windowUsedPct).to.equal(10);
    expect(result.data?.weeklyUsedPct).to.equal(20);
    expect(calls).to.deep.equal([
      'https://api.anthropic.com/api/oauth/usage',
      'https://api.anthropic.com/v1/messages',
    ]);
  });

  it('honors Retry-After after the usage endpoint returns 429', async () => {
    const calls: string[] = [];
    const fakeFetch = async (url: string) => {
      calls.push(url);
      if (url.endsWith('/api/oauth/usage')) {
        return {
          ok: false,
          status: 429,
          headers: { get: (name: string) => name.toLowerCase() === 'retry-after' ? '120' : null },
          text: async () => '',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: async () => '',
      };
    };
    const provider = new ClaudeApiProvider(fakeFetch as any);

    await provider.fetchQuota('oauth-token');
    provider.invalidateCache();
    await provider.fetchQuota('oauth-token');

    expect(calls).to.deep.equal([
      'https://api.anthropic.com/api/oauth/usage',
      'https://api.anthropic.com/v1/messages',
      'https://api.anthropic.com/v1/messages',
    ]);
  });

  it('parses shared windows and the Fable model-scoped weekly limit', () => {
    const quota = parseClaudeUsageResponse({
      five_hour: { utilization: 12.5, resets_at: '2026-09-06T05:00:00Z' },
      seven_day: { utilization: 34.5, resets_at: '2026-09-13T00:00:00Z' },
      limits: [{
        kind: 'weekly_scoped',
        percent: 56.5,
        resets_at: '2026-09-12T08:30:00Z',
        scope: { model: { display_name: 'Claude Fable 5.1' } },
      }],
    });

    expect(quota).to.not.equal(null);
    expect(quota!.windowUsedPct).to.equal(12.5);
    expect(quota!.weeklyUsedPct).to.equal(34.5);
    expect(quota!.fableWeeklyUsedPct).to.equal(56.5);
    expect(quota!.fableWeeklyResetAt).to.equal(Date.parse('2026-09-12T08:30:00Z'));
  });

  it('falls back to limits[] for shared windows', () => {
    const quota = parseClaudeUsageResponse({
      limits: [
        { kind: 'session', percent: 10, resets_at: '2026-09-06T05:00:00Z' },
        { kind: 'weekly_all', percent: 20, resets_at: '2026-09-13T00:00:00Z' },
      ],
    });

    expect(quota?.windowUsedPct).to.equal(10);
    expect(quota?.weeklyUsedPct).to.equal(20);
    expect(quota?.fableWeeklyUsedPct).to.equal(undefined);
  });

  it('treats null utilization as missing and falls back to limits[]', () => {
    const quota = parseClaudeUsageResponse({
      five_hour: { utilization: null, resets_at: '2026-09-06T05:00:00Z' },
      seven_day: { utilization: '', resets_at: '2026-09-13T00:00:00Z' },
      limits: [
        { kind: 'session', percent: 10, resets_at: '2026-09-06T05:00:00Z' },
        { kind: 'weekly_all', percent: 20, resets_at: '2026-09-13T00:00:00Z' },
      ],
    });

    expect(quota?.windowUsedPct).to.equal(10);
    expect(quota?.weeklyUsedPct).to.equal(20);
  });

  it('ignores a Fable limit whose percentage is null even when it has a reset', () => {
    const quota = parseClaudeUsageResponse({
      five_hour: { utilization: 10, resets_at: '2026-09-06T05:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2026-09-13T00:00:00Z' },
      limits: [{
        kind: 'weekly_scoped',
        percent: null,
        resets_at: '2026-09-12T08:30:00Z',
        scope: { model: { display_name: 'Fable' } },
      }],
    });

    expect(quota?.fableWeeklyUsedPct).to.equal(undefined);
  });

  it('rejects payloads without both shared usage windows', () => {
    expect(parseClaudeUsageResponse({ limits: [] })).to.equal(null);
    expect(parseClaudeUsageResponse(null)).to.equal(null);
  });

  it('ignores placeholder Fable limits with zero usage and no reset', () => {
    const quota = parseClaudeUsageResponse({
      five_hour: { utilization: 10, resets_at: '2026-09-06T05:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2026-09-13T00:00:00Z' },
      limits: [{
        kind: 'weekly_scoped',
        percent: 0,
        resets_at: null,
        scope: { model: { display_name: 'Fable' } },
      }],
    });

    expect(quota?.fableWeeklyUsedPct).to.equal(undefined);
  });
});

describe('Claude API quota headers', () => {
  it('parses the separate Fable 5 weekly utilization and reset headers', () => {
    const nowMs = Date.UTC(2026, 8, 6, 0, 0, 0);
    const values: Record<string, string> = {
      'anthropic-ratelimit-unified-5h-utilization': '0.12',
      'anthropic-ratelimit-unified-7d-utilization': '0.34',
      'anthropic-ratelimit-unified-7d_oi-utilization': '0.56',
      'anthropic-ratelimit-unified-5h-reset': '3600',
      'anthropic-ratelimit-unified-7d-reset': '7200',
      'anthropic-ratelimit-unified-7d_oi-reset': '10800',
    };

    const quota = parseClaudeQuotaHeaders({ get: (name: string) => values[name] ?? null }, nowMs);

    expect(quota.weeklyUsedPct).to.equal(34);
    expect(quota.fableWeeklyUsedPct).to.be.closeTo(56, 0.0001);
    expect(quota.fableWeeklyResetAt).to.equal(nowMs + 10_800_000);
  });

  it('leaves the Fable 5 quota absent when Claude does not return its headers', () => {
    const values: Record<string, string> = {
      'anthropic-ratelimit-unified-5h-utilization': '0.12',
      'anthropic-ratelimit-unified-7d-utilization': '0.34',
    };

    const quota = parseClaudeQuotaHeaders({ get: (name: string) => values[name] ?? null }, 0);

    expect(quota.fableWeeklyUsedPct).to.equal(undefined);
    expect(quota.fableWeeklyResetAt).to.equal(undefined);
  });

  it('clamps Fable 5 utilization to the valid percentage range', () => {
    const values: Record<string, string> = {
      'anthropic-ratelimit-unified-7d_oi-utilization': '1.25',
    };

    const quota = parseClaudeQuotaHeaders({ get: (name: string) => values[name] ?? null }, 0);

    expect(quota.fableWeeklyUsedPct).to.equal(100);
  });
});
