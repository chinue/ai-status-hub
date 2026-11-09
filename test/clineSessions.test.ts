import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as sinon from 'sinon';
import { LocalUsageService } from '../src/services/localUsageService';
import { createGlmProvider } from '../src/providers/glm';
import { createKimiProvider } from '../src/providers/kimi';
import { HistoryService } from '../src/services/historyService';
import * as calc from '../src/calc';

describe('Cline session-file usage', () => {
  let root: string;
  let clock: sinon.SinonFakeTimers;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'cline-sessions-'));
    clock = sinon.useFakeTimers({ now: new Date('2026-11-09T12:00:00').getTime(), toFake: ['Date'] });
  });
  afterEach(() => {
    clock.restore();
    fs.rmSync(root, { recursive: true, force: true });
  });
  function write(relative: string, value: unknown) {
    const file = path.join(root, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(value));
    return file;
  }
  function message(id: string, model = 'glm-5.3', ts = Date.now()) {
    return { id, ts, role: 'assistant', modelInfo: { id: model, provider: 'openai-compatible' },
      metrics: { inputTokens: 1000, outputTokens: 20, cacheReadTokens: 800, cacheWriteTokens: 0 } };
  }
  async function usage(provider = createGlmProvider(), opts = {}) {
    provider.localUsage = { scanSessions: async () => [], getRateLimits: async () => null, invalidate() {} };
    const service = new LocalUsageService([root]);
    service.setProvider(provider);
    return { service, result: await service.getLocalUsage(opts) };
  }

  it('discovers the standalone Cline sessions directory by default', () => {
    expect((LocalUsageService as any).defaultClineRoots()).to.include(path.join(os.homedir(), '.cline', 'data', 'sessions'));
  });
  it('reads copied session messages and separates cache from inclusive prompt tokens', async () => {
    const file = write('sessions/copied/copied.messages.json', { sessionId: 'copied', messages: [message('a')] });
    write('sessions/copied/copied.json', { model: 'glm-5.3', metadata: { tokensIn: 999999 } });
    // File copy time must not replace the original request timestamp.
    fs.utimesSync(file, new Date(0), new Date(0));
    const { result } = await usage();
    expect(result.entries).to.have.length(1);
    expect(result).to.include({ tokensToday: 200, tokensOutToday: 20, tokensCacheReadToday: 800, requestsToday: 1 });
    expect(result.tokensToday + result.tokensOutToday + result.tokensCacheReadToday).to.equal(1020);
  });
  it('routes each message model and ignores unknown, user and unfinished messages', async () => {
    write('sessions/mixed/mixed.messages.json', { sessionId: 'mixed', messages: [message('g'),
      message('k', 'kimi-k2.6'), message('c', 'claude-sonnet-4'),
      { ...message('u'), role: 'user' }, { ...message('partial'), partial: true },
      { ...message('unknown'), modelInfo: {} }, { id: 'incomplete', role: 'assistant' },
    ] });
    expect((await usage()).result.entries.map(e => e.model)).to.deep.equal(['glm-5.3']);
    expect((await usage(createKimiProvider())).result.entries.map(e => e.model)).to.deep.equal(['kimi-k2.6']);
  });
  it('supports nested SDK metrics and clamps cached prompt counts', async () => {
    write('sessions/sdk/sdk.messages.json', { sessionId: 'sdk', messages: [
      { id: 'sdk', role: 'assistant', ts: Date.now(), modelInfo: { modelId: 'glm-5.3' },
        metrics: { tokens: { prompt: 100, completion: 10, cached: 120 } } },
    ] });
    const { result } = await usage();
    expect(result.entries[0]).to.include({ inputOther: 0, inputCacheRead: 100, output: 10 });
  });
  it('isolates malformed session documents and preserves zero, cache-write and ISO timestamps', () => {
    for (const value of [null, 42, {}, { messages: null }]) {
      expect(calc.parseClineSessionUsage(value, 'fallback')).to.deep.equal([]);
    }
    const ts = new Date().toISOString();
    const entries = calc.parseClineSessionUsage({ messages: [
      null, { ...message('zero'), metrics: { inputTokens: 0, outputTokens: 0 } },
      { ...message('bad'), metrics: { inputTokens: Infinity, outputTokens: -1, cacheReadTokens: '100' } },
      { ...message('iso'), id: undefined, ts, metrics: { inputTokens: 100, outputTokens: 0, cacheReadTokens: 30, cacheWriteTokens: 20 } },
    ] }, 'fallback');
    expect(entries).to.have.length(1);
    expect(entries[0]).to.include({ timestamp: Date.parse(ts), inputOther: 50, output: 0,
      inputCacheRead: 30, inputCacheCreation: 20, messageId: `cline:fallback:${Date.parse(ts)}` });
  });
  it('uses original timestamps for today and five-hour windows and applies retention', async () => {
    const now = Date.now();
    const today = new Date().setHours(0, 0, 0, 0);
    write('sessions/time/time.messages.json', { sessionId: 'time', messages: [
      message('recent', 'glm-5.3', now - 1000), message('yesterday', 'glm-5.3', today - 1000),
      message('expired', 'glm-5.3', now - 3 * 86400000),
      { ...message('bad'), ts: 'invalid' },
    ] });
    const { result } = await usage(createGlmProvider(), { dataRetentionDays: 2, windowResetAtMs: now - 3600000 + 5 * 3600000 });
    expect(result.entries).to.have.length(2);
    expect(result.requestsToday).to.equal(1);
    expect(result.requests5h).to.equal(1);
  });
  it('deduplicates copied sessions, rereads edits and handles deletion or malformed files', async () => {
    const data = { sessionId: 'original', messages: [message('a')] };
    const file = write('sessions/a/a.messages.json', data);
    write('sessions/b/b.messages.json', data);
    write('sessions/b/b.json', { metadata: { usage: { inputTokens: 99999 } } });
    const { service, result } = await usage();
    expect(result.entries).to.have.length(1);
    fs.writeFileSync(file, JSON.stringify({ ...data, messages: [...data.messages, message('b', 'glm-5.3', Date.now() + 1)] }));
    expect((await service.getLocalUsage()).entries).to.have.length(2);
    fs.writeFileSync(file, '{broken');
    expect((await service.getLocalUsage()).entries).to.have.length(1);
    fs.unlinkSync(path.join(root, 'sessions/b/b.messages.json'));
    expect((await service.getLocalUsage()).entries).to.have.length(0);
  });
  it('preserves the copied-session totals without adding their summaries twice', async () => {
    const now = Date.now();
    write('sessions/one/one.messages.json', { sessionId: 'one', messages: [
      { ...message('a', 'glm-5.3', now), metrics: { inputTokens: 6724, outputTokens: 265, cacheReadTokens: 5632 } },
    ] });
    write('sessions/two/two.messages.json', { sessionId: 'two', messages: [
      { ...message('b', 'glm-5.3', now), metrics: { inputTokens: 4209072, outputTokens: 8893, cacheReadTokens: 4064960 } },
    ] });
    const { result } = await usage();
    expect(result.tokensToday).to.equal(145204);
    expect(result.tokensCacheReadToday).to.equal(4070592);
    expect(result.tokensOutToday).to.equal(9158);
    expect(result.tokensToday + result.tokensCacheReadToday + result.tokensOutToday).to.equal(4224954);
    const agg = HistoryService.getInstance().buildDashboardAggregates(result.entries, {
      todayStartMs: new Date().setHours(0, 0, 0, 0), window5hStartMs: now - 5 * 3600000,
      window7dStartMs: now - 7 * 86400000, window30dStartMs: now - 30 * 86400000,
      monthStartMs: new Date().setDate(1),
    });
    expect((agg.today as any).totalTokens).to.equal(4224954);
  });
});
