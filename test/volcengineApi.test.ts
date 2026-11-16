import { expect } from 'chai';
import * as sinon from 'sinon';
import { VolcengineApiProvider } from '../src/providers/volcengine/api';
import { signVolcengineQuotaRequest } from '../src/providers/volcengine/signing';
import { parseVolcengineCodingQuota, formatProviderStatus, fmtReportedResetTime } from '../src/calc';
import { defaultState, Store } from '../src/store';
import { DashboardPanel } from '../src/presenters/dashboard';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { createServer } from 'https';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch';

const credentials = { accessKeyId: 'test-access', secretAccessKey: 'test-secret' };
const token = JSON.stringify(credentials);
const response = () => ({ Result: { Status: 'Running', QuotaUsage: [
  { Level: 'session', Percent: 12.5, ResetTimestamp: 1794816000 },
  { Level: 'weekly', Percent: 23.75, ResetTimestamp: 1795363200 },
  { Level: 'monthly', Percent: 40.125, ResetTimestamp: 1797436800 },
] } });

describe('Volcengine Coding Plan API', () => {
  afterEach(() => sinon.restore());

  it('parses the three windows without inventing absolute request quotas', () => {
    const quota = parseVolcengineCodingQuota(response())!;
    expect(quota).to.include({ windowUsedPct: 12.5, weeklyUsedPct: 23.75,
      monthlyUsedPct: 40.125, monthlyResetAt: 1797436800000, percentOnly: true });
    expect(quota.windowResetAt).to.equal(1794816000000);
    expect(quota.has5hLimit).to.equal(true);
    expect(quota.has7dLimit).to.equal(true);
    const raw = response();
    raw.Result.QuotaUsage[0].Percent = 0;
    raw.Result.QuotaUsage[0].ResetTimestamp = 0;
    expect(parseVolcengineCodingQuota(raw)).to.include({ windowUsedPct: 0, windowResetAt: 0 });
  });

  it('rejects missing or invalid quota data instead of reporting zero usage', () => {
    for (const raw of [null, {}, { Result: { QuotaUsage: [] } },
      { ResponseMetadata: { Error: { Code: 'AccessDenied' } }, ...response() },
      { Result: { QuotaUsage: [{ Level: 'session', Percent: null }] } },
      { Result: { QuotaUsage: [{ Level: 'unknown', Percent: 5 }] } }]) {
      expect(parseVolcengineCodingQuota(raw)).to.equal(null);
    }
    expect(parseVolcengineCodingQuota({ Result: { QuotaUsage: [
      { Level: 'weekly', Percent: '110.5', ResetTimestamp: -1 },
    ] } })).to.include({ weeklyUsedPct: 100, weeklyResetAt: 0, has5hLimit: false });
  });

  it('signs the fixed read-only request with the official V4 scope', () => {
    const request = signVolcengineQuotaRequest(credentials, new Date('2026-11-16T07:00:00Z'));
    expect(request.url).to.equal('https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01');
    expect(request.body).to.equal('{}');
    expect(request.headers['X-Date']).to.equal('20261116T070000Z');
    expect(request.headers.Authorization).to.equal('HMAC-SHA256 Credential=test-access/20261116/cn-beijing/ark/request, SignedHeaders=host;x-content-sha256;x-date, Signature=556fab29a17938b2876b4336d03c2346c147cf29c300f0e0511a968eb7153a71');
    expect(JSON.stringify(request)).not.to.include('test-secret');
  });

  it('uses the signed control plane and returns parsed quota', async () => {
    const fetcher = sinon.stub().resolves({ status: 200, text: async () => JSON.stringify(response()) });
    const result = await new VolcengineApiProvider(fetcher as any).fetchQuota(token);
    expect(result.ok).to.equal(true);
    expect(result.data?.weeklyUsedPct).to.equal(23.75);
    const [url, options] = fetcher.firstCall.args;
    expect(url).to.include('Action=GetCodingPlanUsage');
    expect(options).to.include({ method: 'POST', body: '{}', redirect: 'error' });
    expect(options.headers.Authorization).to.include('Credential=test-access/');
    expect(options.headers.Authorization).not.to.include('Bearer');
  });

  it('does not send an inference API key as a quota credential', async () => {
    const fetcher = sinon.stub();
    const result = await new VolcengineApiProvider(fetcher as any).fetchQuota('ark-inference-key');
    expect(result.ok).to.equal(false);
    expect(result.error).to.include('AccessKey');
    expect(fetcher.called).to.equal(false);
  });

  it('forces certificate validation even when the process disables TLS verification', async () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    const fetcher = sinon.stub().resolves({ status: 200, text: async () => JSON.stringify(response()) });
    try {
      expect((await new VolcengineApiProvider(fetcher as any).fetchQuota(token)).ok).to.equal(true);
      expect(fetcher.firstCall.args[1].agent.options.rejectUnauthorized).to.equal(true);
    } finally {
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
  });

  it('rejects an untrusted server before sending the signed HTTP request', async () => {
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    let requests = 0;
    // Public test-only fixture: this private key is never an application credential.
    const server = createServer({
      key: fs.readFileSync(path.join(__dirname, 'fixtures/tls/localhost-test-key.pem')),
      cert: fs.readFileSync(path.join(__dirname, 'fixtures/tls/localhost-test-cert.pem')),
    }, (_req, res) => { requests++; res.end(JSON.stringify(response())); });
    try {
      await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
      const port = (server.address() as any).port;
      const localFetch = (_url: string, options: any) => fetch(`https://127.0.0.1:${port}/`, options);
      const result = await new VolcengineApiProvider(localFetch as any).fetchQuota(token);
      expect(result.ok).to.equal(false);
      expect(result.networkError).to.equal(true);
      expect(result.authFailed).not.to.equal(true);
      expect(result.error).to.include('certificate');
      expect(requests).to.equal(0);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
  });

  it('handles API errors, malformed JSON and network failures without exposing private data', async () => {
    for (const reply of [
      { status: 401, text: async () => 'test-secret' },
      { status: 403, text: async () => 'test-secret' },
      { status: 429, text: async () => 'test-secret' },
      { status: 500, text: async () => 'test-secret' },
      { status: 200, text: async () => '{bad' },
      { status: 200, text: async () => JSON.stringify({ ResponseMetadata: { Error: { Code: 'AccessDenied', Message: 'test-secret' } } }) },
      { status: 200, text: async () => '{}' },
    ]) {
      const result = await new VolcengineApiProvider((async () => reply) as any).fetchQuota(token);
      expect(result.ok).to.equal(false);
      expect(JSON.stringify(result)).not.to.include('test-secret');
    }
    const failure = await new VolcengineApiProvider((async () => { throw new Error('test-secret'); }) as any).fetchQuota(token);
    expect(failure.networkError).to.equal(true);
    expect(failure.error).not.to.include('test-secret');
  });

  it('aborts a stalled request and releases timeout timers', async () => {
    const clock = sinon.useFakeTimers();
    const api = new VolcengineApiProvider((async (_url: string, opts: any) => new Promise((_resolve, reject) => {
      opts.signal.addEventListener('abort', () => reject(new Error('aborted')));
    })) as any);
    const pending = api.fetchQuota(token);
    await clock.tickAsync(15000);
    expect((await pending).networkError).to.equal(true);
    expect(clock.countTimers()).to.equal(0);
  });

  it('shows monthly quota and percentages even in absolute display mode', async () => {
    const quota = parseVolcengineCodingQuota(response())!;
    quota.windowResetAt = Date.now() + 3600000;
    quota.weeklyResetAt = Date.now() + 86400000;
    quota.monthlyResetAt = Date.now() + 10 * 86400000;
    const state = { ...defaultState(), activeProvider: 'volcengine', quota };
    const usage = (DashboardPanel.prototype as any).buildKimiUsageData.call({}, state);
    expect(usage.percentOnly).to.equal(true);
    expect(usage.utilizationMonth).to.equal(0.40125);
    expect(usage.hasMonthlyLimit).to.equal(true);
    const html = (DashboardPanel.prototype as any).getHtml.call({ store: { getState: () => state } }, 'nonce', 'en');
    expect(html).to.include('id="row-plan-month"');
    expect(formatProviderStatus(state, '', 'Ark', 'absolute')).to.include('23.75%');
    expect(formatProviderStatus(state, '', 'Ark', 'absolute')).not.to.include('/100');
    expect(fmtReportedResetTime(0)).to.equal('—');
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: 'volcengine' });
    store.dispatch({ type: 'API_SUCCESS', payload: quota });
    const presenter = new StatusBarPresenter(store);
    try {
      const tip = (await (presenter as any).buildTooltip(store.getState())).value;
      expect(tip).to.include('Subscription month');
      expect(tip).to.include('40.13%');
    } finally { presenter.dispose(); }
  });
});
