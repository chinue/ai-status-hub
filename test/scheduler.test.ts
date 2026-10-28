import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { Scheduler } from '../src/services/scheduler';
import { Store } from '../src/store';
import { IAuthProvider, IQuotaApiProvider, RateLimits } from '../src/providers/base/types';
import { CacheService } from '../src/services/cacheService';
import { LocalUsageService } from '../src/services/localUsageService';
import { ConfigService } from '../src/config';
import { makeContext } from './mocks/vscode';
import { QuotaData, WindowAnchorData } from '../src/types';
import { codexRateLimitsToQuota, resolveWeeklyPct } from '../src/calc';

describe('Scheduler', () => {
  let clock: sinon.SinonFakeTimers;
  let store: Store;
  let auth: IAuthProvider;
  let api: IQuotaApiProvider;
  let cache: CacheService;
  let scheduler: Scheduler;
  let tempDir: string;

  beforeEach(async () => {
    clock = sinon.useFakeTimers();
    tempDir = path.join(os.tmpdir(), `ai-status-hub-scheduler-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    await fs.mkdir(tempDir, { recursive: true });
    store = new Store();
    auth = {
      resolveToken: async () => null, // skip API path in tests, exercise local fallback
      invalidate: () => {},
    };
    api = {
      fetchQuota: async () => ({ ok: false, error: 'not stubbed' }),
    };
    cache = new CacheService(path.join(tempDir, 'cache.json'));
    sinon.stub(cache, 'readWindowAnchors').resolves(null);
    sinon.stub(cache, 'writeWindowAnchors').resolves();
    const localUsage = LocalUsageService.getInstance();
    scheduler = new Scheduler(store, auth, api, cache, localUsage);
  });

  afterEach(async () => {
    scheduler.stop();
    clock.restore();
    sinon.restore();
    await fs.rm(tempDir, { recursive: true, force: true });

    (CacheService as any).instance = undefined;
    (LocalUsageService as any).instance = undefined;
  });

  it('coalesces forced refreshes while a tick is pending', async () => {
    let complete!: () => void;
    const work = sinon.stub(scheduler as any, 'doLongTick');
    work.onFirstCall().returns(new Promise<void>(resolve => { complete = resolve; }));
    work.resolves();
    scheduler.start();
    await clock.tickAsync(1);
    scheduler.force();
    scheduler.force();
    await clock.tickAsync(100);
    expect(work.callCount).to.equal(1);
    complete();
    await clock.tickAsync(100);
    expect(work.callCount).to.equal(2);
  });

  it('waits for a short tick before refreshing and invalidates the completed request cache', async () => {
    const long = sinon.stub(scheduler as any, 'doLongTick').resolves();
    let complete!: () => void;
    sinon.stub(scheduler as any, 'doShortTick')
      .returns(new Promise<void>(resolve => { complete = resolve; }));
    const invalidate = sinon.spy();
    api.invalidateCache = invalidate;
    scheduler.start();
    await clock.tickAsync(5_001);
    scheduler.force();
    await clock.tickAsync(100);
    expect(long.callCount).to.equal(1);
    expect(invalidate.callCount).to.equal(0);
    complete();
    await clock.tickAsync(100);
    expect(long.callCount).to.equal(2);
    expect(invalidate.callCount).to.equal(1);
  });

  it('recovers after a failed tick without leaking its watchdog', async () => {
    const work = sinon.stub(scheduler as any, 'doLongTick');
    work.onFirstCall().rejects(new Error('network failure'));
    work.resolves();
    scheduler.start();
    await clock.tickAsync(10);
    expect(work.callCount).to.equal(2);
    scheduler.stop();
    expect(clock.countTimers()).to.equal(0);
  });

  it('does not overlap timed-out work and clears the watchdog after completion', async () => {
    let complete!: () => void;
    const work = sinon.stub(scheduler as any, 'doLongTick');
    work.onFirstCall().returns(new Promise<void>(resolve => { complete = resolve; }));
    work.resolves();
    scheduler.start();
    await clock.tickAsync(60_001);
    scheduler.force();
    await clock.tickAsync(100);
    expect(work.callCount).to.equal(1);
    complete();
    await clock.tickAsync(100);
    expect(work.callCount).to.equal(2);
    scheduler.stop();
    expect(clock.countTimers()).to.equal(0);
  });

  it('does not restart scheduling after stop while a tick is pending', async () => {
    let complete!: () => void;
    const work = sinon.stub(scheduler as any, 'doLongTick')
      .returns(new Promise<void>(resolve => { complete = resolve; }));
    scheduler.start();
    await clock.tickAsync(1);
    scheduler.force();
    scheduler.stop();
    complete();
    await clock.tickAsync(100);
    expect(work.callCount).to.equal(1);
    expect(clock.countTimers()).to.equal(0);
  });

  it('tick dispatches LOADING_START -> API_SUCCESS -> LOADING_END', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 25, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(localUsage, 'getLocalUsage').resolves({
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    });
    sinon.stub(cache, 'write').resolves();

    let loadingEndSeen = false;
    store.subscribe((s) => {
      if (!s.isLoading && s.quota !== null) {
        loadingEndSeen = true;
      }
    });

    scheduler.start();
    await clock.tickAsync(100); // trigger first tick
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(loadingEndSeen || store.getState().quota !== null).to.be.true;
    expect(store.getState().quota).to.not.be.null;

    rlStub.restore();
  });

  it('pauses tick when isPaused is true', async () => {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    scheduler.start();
    await clock.tickAsync(100);
    expect(store.getState().dataSource).to.equal('no-data');
  });

  it('keeps an official early reset after short ticks and stale local fallback', async () => {
    const local = LocalUsageService.getInstance();
    sinon.stub(local, 'getLocalUsage').resolves({
      costThisCycle: 0.2, cost5h: 0.1, cost7d: 0.2, costToday: 0.2,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 0, inputCacheRead: 0, inputCacheCreation: 0, cost: 0.2 }],
    } as any);
    sinon.stub(local, 'getRateLimits').resolves({ primary: { used_percent: 90, window_minutes: 10080 } });
    sinon.stub(cache, 'write').resolves();
    sinon.stub(auth, 'resolveToken').resolves('fixture');
    let quota = codexRateLimitsToQuota({ primary: { used_percent: 90, window_minutes: 10080, resets_at: 604800 } }, Date.now());
    const request = sinon.stub(api, 'fetchQuota').callsFake(async () => ({ ok: true, data: quota }));
    scheduler.start();
    await clock.tickAsync(100);
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 0.2 } });
    quota = { ...quota, weeklyUsed: 0, weeklyUsedPct: 0 };
    scheduler.force();
    await clock.tickAsync(100);
    expect(resolveWeeklyPct(store.getState())).to.equal(0);
    await (scheduler as any).doShortTick();
    expect(store.getState().localEstimate!.weeklyPct).to.equal(0);
    expect(resolveWeeklyPct(store.getState())).to.equal(0);
    request.resolves({ ok: false, error: 'offline', networkError: true });
    sinon.stub(cache, 'read').resolves({ quota: { ...quota, weeklyUsed: 90, weeklyUsedPct: 90 }, fetchedAt: 0 });
    await (scheduler as any).doLongTick();
    expect(store.getState().quota!.weeklyUsedPct).to.equal(0);
    expect(store.getState().usageEntries).to.have.length(1);
  });

  it('drops old smoothing when the official reset window changes at the same integer percentage', async () => {
    const local = LocalUsageService.getInstance();
    sinon.stub(local, 'getLocalUsage').resolves({ costThisCycle: 20, cost5h: 2, cost7d: 20, entries: [] } as any);
    sinon.stub(cache, 'write').resolves();
    const old = codexRateLimitsToQuota({ primary: { used_percent: 10, window_minutes: 10080, resets_at: 604800 } }, Date.now());
    store.dispatch({ type: 'API_SUCCESS', payload: old });
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 10.4 } });
    await (scheduler as any).processQuotaData({ ...old, weeklyResetAt: old.weeklyResetAt + 86400000 }, Date.now(), 'api');
    expect(store.getState().localEstimate!.weeklyPct).to.equal(10);
  });

  it('stores official 5h and 7d window anchors when API succeeds', async () => {
    auth.resolveToken = async () => 'token';
    const quota = makeQuotaAt(18_000_000, 604_800_000);
    api.fetchQuota = async () => ({ ok: true, data: quota });
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(cache, 'write').resolves();
    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage').resolves(makeLocalUsage());

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    const anchors = store.getState().windowAnchors!;
    expect(anchors.source).to.equal('api');
    expect(anchors.window5hResetAtMs).to.equal(quota.windowResetAt);
    expect(anchors.window5hStartMs).to.equal(0);
    expect(anchors.window7dResetAtMs).to.equal(quota.weeklyResetAt);
    expect(anchors.window7dStartMs).to.equal(0);
    expect(getUsageStub.firstCall.args[0]).to.include({
      windowResetAtMs: quota.windowResetAt,
      weeklyResetAtMs: quota.weeklyResetAt,
    });

    const writeAnchorsStub = cache.writeWindowAnchors as sinon.SinonStub;
    expect(writeAnchorsStub.calledOnce).to.be.true;
    expect(writeAnchorsStub.firstCall.args[0]).to.equal('codex');
    expect(writeAnchorsStub.firstCall.args[1].window5hStartMs).to.equal(0);
    expect(writeAnchorsStub.firstCall.args[1].window7dStartMs).to.equal(0);
  });

  it('preserves an unexpired cached Fable window when the API fallback omits it', async () => {
    store.dispatch({ type: 'SET_PROVIDER', payload: 'claude' });
    store.dispatch({
      type: 'CACHE_LOADED',
      payload: {
        ...makeQuotaAt(18_000_000, 604_800_000),
        fableWeeklyUsedPct: 56,
        fableWeeklyResetAt: 500_000_000,
      },
    });
    auth.resolveToken = async () => 'token';
    api.fetchQuota = async () => ({ ok: true, data: makeQuotaAt(18_000_000, 604_800_000) });
    sinon.stub(cache, 'write').resolves();
    sinon.stub(LocalUsageService.getInstance(), 'getLocalUsage').resolves(makeLocalUsage());

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    expect(store.getState().quota?.fableWeeklyUsedPct).to.equal(56);
    expect(store.getState().quota?.fableWeeklyResetAt).to.equal(500_000_000);
  });

  it('keeps an expired cached Fable window visible at 0% when the API omits it', async () => {
    const now = 700_000_000;
    const expiredReset = now - 1000;
    clock.setSystemTime(now);
    store.dispatch({ type: 'SET_PROVIDER', payload: 'claude' });
    store.dispatch({
      type: 'CACHE_LOADED',
      payload: {
        ...makeQuotaAt(now + 18_000_000, now + 604_800_000),
        fableWeeklyUsedPct: 56,
        fableWeeklyResetAt: expiredReset,
      },
    });
    auth.resolveToken = async () => 'token';
    api.fetchQuota = async () => ({
      ok: true,
      data: makeQuotaAt(now + 18_000_000, now + 604_800_000),
    });
    sinon.stub(cache, 'write').resolves();
    sinon.stub(LocalUsageService.getInstance(), 'getLocalUsage').resolves(makeLocalUsage());

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    expect(store.getState().quota?.fableWeeklyUsedPct).to.equal(0);
    expect(store.getState().quota?.fableWeeklyResetAt).to.equal(expiredReset + 604_800_000);
  });

  it('restores window anchors from disk when API fails', async () => {
    const diskAnchors = makeAnchors('codex', 1_000_000_000);
    (cache.readWindowAnchors as sinon.SinonStub).resolves({ ...diskAnchors, source: 'disk' });
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(localUsage, 'getRateLimits').resolves(null);
    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage').resolves(makeLocalUsage({
      entries: [makeUsageEntry(diskAnchors.window7dStartMs + 1000)],
    }));

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    const anchors = store.getState().windowAnchors!;
    expect(anchors.source).to.equal('disk');
    expect(anchors.window5hStartMs).to.equal(diskAnchors.window5hStartMs);
    expect(anchors.window7dStartMs).to.equal(diskAnchors.window7dStartMs);
    expect(getUsageStub.firstCall.args[0]).to.include({
      windowResetAtMs: diskAnchors.window5hResetAtMs,
      weeklyResetAtMs: diskAnchors.window7dResetAtMs,
    });
  });

  it('keeps Codex local rate_limits reset windows when API fails but rate_limits exist', async () => {
    const windowResetAt = 3_000_000_000;
    const weeklyResetAt = 3_600_000_000;
    const rateLimits: RateLimits = {
      primary: { used_percent: 25, resets_at: windowResetAt / 1000 },
      secondary: { used_percent: 50, resets_at: weeklyResetAt / 1000 },
    };
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage').resolves(makeLocalUsage());

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    const anchors = store.getState().windowAnchors!;
    expect(anchors.window5hResetAtMs).to.equal(windowResetAt);
    expect(anchors.window5hStartMs).to.equal(windowResetAt - 5 * 3600 * 1000);
    expect(anchors.window7dResetAtMs).to.equal(weeklyResetAt);
    expect(anchors.window7dStartMs).to.equal(weeklyResetAt - 7 * 24 * 3600 * 1000);
    expect(getUsageStub.firstCall.args[0]).to.include({
      windowResetAtMs: windowResetAt,
      weeklyResetAtMs: weeklyResetAt,
    });
  });

  it('falls back to now minus the period when API and disk anchors fail', async () => {
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(localUsage, 'getRateLimits').resolves(null);
    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage').resolves(makeLocalUsage({
      entries: [makeUsageEntry(Date.now())],
    }));

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    const anchors = store.getState().windowAnchors!;
    expect(anchors.source).to.equal('fallback');
    expect(anchors.window5hStartMs).to.equal(anchors.window5hResetAtMs - 5 * 3600 * 1000);
    expect(anchors.window7dStartMs).to.equal(anchors.window7dResetAtMs - 7 * 24 * 3600 * 1000);
    expect(getUsageStub.firstCall.args[0]).to.include({
      windowResetAtMs: anchors.window5hResetAtMs,
      weeklyResetAtMs: anchors.window7dResetAtMs,
    });
  });

  it('uses anchors for Claude local JSONL usage when API and local rate_limits are unavailable', async () => {
    store.dispatch({ type: 'SET_PROVIDER', payload: 'claude' });
    cache.setProviderId('claude');
    const diskAnchors = makeAnchors('claude', 2_000_000_000);
    (cache.readWindowAnchors as sinon.SinonStub).resolves({ ...diskAnchors, source: 'disk' });
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(localUsage, 'getRateLimits').resolves(null);
    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage').resolves(makeLocalUsage({
      tokensIn5h: 100,
      tokensIn7d: 200,
      entries: [makeUsageEntry(diskAnchors.window7dStartMs + 1000, 'claude-sonnet-4')],
    }));

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    expect(store.getState().windowAnchors?.providerId).to.equal('claude');
    expect(store.getState().windowAnchors?.source).to.equal('disk');
    expect(store.getState().usageEntries.length).to.equal(1);
    expect(store.getState().localEstimate?.tokensIn7d).to.equal(200);
    expect(getUsageStub.firstCall.args[0]).to.include({
      windowResetAtMs: diskAnchors.window5hResetAtMs,
      weeklyResetAtMs: diskAnchors.window7dResetAtMs,
    });
  });

  it('short tick updates local estimate with decimal precision', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    // Local rate limits: 62% weekly, 25% window
    const rateLimits: RateLimits = {
      secondary: { used_percent: 62, resets_in_seconds: 86400 },
      primary: { used_percent: 25, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    // Initial local usage: costThisCycle=10, cost5h=5
    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage');
    getUsageStub.onFirstCall().resolves({
      tokensToday: 25_000_000, costToday: 10, requestsToday: 5,
      tokensIn5h: 25_000_000, tokensOut5h: 5_000_000, tokensCacheRead5h: 1_000, tokensCacheCreate5h: 500,
      requests5h: 5,
      tokensIn7d: 25_000_000, tokensOut7d: 5_000_000, tokensCacheRead7d: 1_000, tokensCacheCreate7d: 500,
      cost7d: 10, requests7d: 5,
      cost5h: 5,
      tokensThisCycle: 25_000_000, costThisCycle: 10, requestsThisCycle: 5,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });
    // After 5s: cost increases slightly (costThisCycle=10.4, cost5h=5.2)
    getUsageStub.onSecondCall().resolves({
      tokensToday: 26_000_000, costToday: 10.4, requestsToday: 6,
      tokensIn5h: 26_000_000, tokensOut5h: 5_200_000, tokensCacheRead5h: 1_100, tokensCacheCreate5h: 520,
      requests5h: 6,
      tokensIn7d: 26_000_000, tokensOut7d: 5_200_000, tokensCacheRead7d: 1_100, tokensCacheCreate7d: 520,
      cost7d: 10.4, requests7d: 6,
      cost5h: 5.2,
      tokensThisCycle: 26_000_000, costThisCycle: 10.4, requestsThisCycle: 6,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });

    scheduler.start();
    // First tick = long tick (local quota read + calibration)
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const stateAfterLong = store.getState();
    expect(stateAfterLong.quota).to.not.be.null;
    expect(stateAfterLong.localEstimate).to.not.be.null;
    expect(stateAfterLong.localEstimate!.weeklyPct).to.equal(62); // local integer

    // Advance 5 seconds -> short tick
    await clock.tickAsync(5000);
    await Promise.resolve();
    await Promise.resolve();

    const stateAfterShort = store.getState();
    expect(stateAfterShort.localEstimate).to.not.be.null;
    // Linear model: k = 62 / 10 = 6.2
    // New estimate = 62 + 6.2 * (10.4 - 10) = 64.48% -> not an integer
    expect(stateAfterShort.localEstimate!.weeklyPct).to.be.greaterThan(62);
    expect(stateAfterShort.localEstimate!.weeklyPct).to.be.lessThan(65);
    // Verify it has decimal precision (not exactly an integer)
    expect(stateAfterShort.localEstimate!.weeklyPct % 1).to.not.equal(0);

    rlStub.restore();
  });

  it('force() triggers a long tick (local quota read) even when short tick is due', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 25, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();
    sinon.stub(localUsage, 'getLocalUsage').resolves({
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    });

    scheduler.start();
    await clock.tickAsync(100); // first long tick
    await Promise.resolve();

    expect(store.getState().quota).to.not.be.null;
    expect(rlStub.callCount).to.equal(1);

    // Advance 5s -> normally this would be a short tick
    await clock.tickAsync(5000);
    await Promise.resolve();

    // Without force, short tick should NOT call getRateLimits again
    expect(rlStub.callCount).to.equal(1);

    // Now call force()
    scheduler.force();
    await clock.tickAsync(100);
    await Promise.resolve();

    // force() must trigger another long tick -> local quota read
    expect(rlStub.callCount).to.equal(2);

    rlStub.restore();
  });

  it('force() invalidates provider API caches before the forced long tick', () => {
    let invalidations = 0;
    api.invalidateCache = () => { invalidations += 1; };

    scheduler.start();
    scheduler.force();
    scheduler.stop();

    expect(invalidations).to.equal(1);
  });

  it('short tick dispatches full usage detail in LOCAL_ESTIMATE', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    const rateLimits: RateLimits = {
      secondary: { used_percent: 62, resets_in_seconds: 86400 },
      primary: { used_percent: 25, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage');
    getUsageStub.onFirstCall().resolves({
      tokensOutToday: 10, tokensCacheReadToday: 20, tokensCacheCreateToday: 30,
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 2_000_000, tokensOut5h: 500_000, tokensCacheRead5h: 100, tokensCacheCreate5h: 50,
      requests5h: 4,
      tokensIn7d: 10_000_000, tokensOut7d: 2_000_000, tokensCacheRead7d: 500, tokensCacheCreate7d: 200,
      cost7d: 25, requests7d: 10,
      cost5h: 3,
      tokensThisCycle: 25_000_000, costThisCycle: 50, requestsThisCycle: 20,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });
    getUsageStub.onSecondCall().resolves({
      tokensOutToday: 110, tokensCacheReadToday: 220, tokensCacheCreateToday: 330,
      tokensToday: 1_100_000, costToday: 5.5, requestsToday: 4,
      tokensIn5h: 2_100_000, tokensOut5h: 550_000, tokensCacheRead5h: 110, tokensCacheCreate5h: 55,
      requests5h: 5,
      tokensIn7d: 10_100_000, tokensOut7d: 2_100_000, tokensCacheRead7d: 510, tokensCacheCreate7d: 210,
      cost7d: 26, requests7d: 11,
      cost5h: 3.5,
      tokensThisCycle: 26_000_000, costThisCycle: 52, requestsThisCycle: 21,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });

    scheduler.start();
    await clock.tickAsync(100); // long tick
    await Promise.resolve();
    await Promise.resolve();

    // Advance 5s -> short tick
    await clock.tickAsync(5000);
    await Promise.resolve();
    await Promise.resolve();

    const le = store.getState().localEstimate;
    expect(le).to.not.be.null;
    // Verify full detail is present (presenters must NOT touch disk)
    expect(le!.tokensOutToday).to.equal(110);
    expect(le!.tokensCacheReadToday).to.equal(220);
    expect(le!.tokensCacheCreateToday).to.equal(330);
    expect(le!.tokensToday).to.equal(1_100_000);
    expect(le!.tokensIn5h).to.equal(2_100_000);
    expect(le!.tokensOut5h).to.equal(550_000);
    expect(le!.tokensCacheRead5h).to.equal(110);
    expect(le!.tokensCacheCreate5h).to.equal(55);
    expect(le!.cost5h).to.equal(3.5);
    expect(le!.requests5h).to.equal(5);
    expect(le!.tokensIn7d).to.equal(10_100_000);
    expect(le!.tokensOut7d).to.equal(2_100_000);
    expect(le!.tokensCacheRead7d).to.equal(510);
    expect(le!.tokensCacheCreate7d).to.equal(210);
    expect(le!.requests7d).to.equal(11);
    expect(le!.tokensThisCycle).to.equal(26_000_000);
    expect(le!.costThisCycle).to.equal(52);
    expect(le!.requestsThisCycle).to.equal(21);

    // Verify getLocalUsage was called on short tick (no force param in incremental mode)
    const secondCall = getUsageStub.getCall(1);
    expect(secondCall).to.not.be.null;
  });

  it('long tick preserves smooth estimate when rounded value matches local integer', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    // Local rate limits return integer 25, but local estimate is 25.3 (smooth)
    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 10, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    sinon.stub(localUsage, 'getLocalUsage').resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 2_000_000, tokensOut5h: 500_000, tokensCacheRead5h: 100, tokensCacheCreate5h: 50,
      requests5h: 4,
      tokensIn7d: 10_000_000, tokensOut7d: 2_000_000, tokensCacheRead7d: 500, tokensCacheCreate7d: 200,
      cost7d: 25, requests7d: 10,
      cost5h: 3,
      tokensThisCycle: 25_000_000, costThisCycle: 50, requestsThisCycle: 20,
      entries: [],
    });

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    // Simulate short tick creating a smooth decimal estimate
    store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct: 25.3,
        windowPct: 10.4,
        cost5h: 3,
        cost7d: 25,
        costToday: 5,
        requestsToday: 3,
        tokensToday: 1_000_000,
        tokensIn5h: 2_000_000, tokensOut5h: 500_000, tokensCacheRead5h: 100, tokensCacheCreate5h: 50,
        requests5h: 4,
        tokensIn7d: 10_000_000, tokensOut7d: 2_000_000, tokensCacheRead7d: 500, tokensCacheCreate7d: 200,
        requests7d: 10,
        tokensThisCycle: 25_000_000, costThisCycle: 50, requestsThisCycle: 20,
      },
    });

    // Force immediate long tick (avoids intermediate short ticks overwriting the estimate)
    scheduler.force();
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    const le = store.getState().localEstimate;
    expect(le).to.not.be.null;
    // Math.round(25.3) === 25 (local value) -> preserve smooth estimate
    expect(le!.weeklyPct).to.equal(25.3);
    // Math.round(10.4) === 10 (local value) -> preserve smooth estimate
    expect(le!.windowPct).to.equal(10.4);

    rlStub.restore();
  });

  it('long tick forces local integer when rounded estimate differs', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    // Local rate limits return integer 25, but local estimate drifted to 25.6 (rounds to 26)
    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 10, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    sinon.stub(localUsage, 'getLocalUsage').resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 2_000_000, tokensOut5h: 500_000, tokensCacheRead5h: 100, tokensCacheCreate5h: 50,
      requests5h: 4,
      tokensIn7d: 10_000_000, tokensOut7d: 2_000_000, tokensCacheRead7d: 500, tokensCacheCreate7d: 200,
      cost7d: 25, requests7d: 10,
      cost5h: 3,
      tokensThisCycle: 25_000_000, costThisCycle: 50, requestsThisCycle: 20,
      entries: [],
    });

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    // Simulate estimate drifted above the local integer
    store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct: 25.6,
        windowPct: 10.6,
        cost5h: 3,
        cost7d: 25,
        costToday: 5,
        requestsToday: 3,
        tokensToday: 1_000_000,
        tokensIn5h: 2_000_000, tokensOut5h: 500_000, tokensCacheRead5h: 100, tokensCacheCreate5h: 50,
        requests5h: 4,
        tokensIn7d: 10_000_000, tokensOut7d: 2_000_000, tokensCacheRead7d: 500, tokensCacheCreate7d: 200,
        requests7d: 10,
        tokensThisCycle: 25_000_000, costThisCycle: 50, requestsThisCycle: 20,
      },
    });

    // Force immediate long tick (avoids intermediate short ticks overwriting the estimate)
    scheduler.force();
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    const le = store.getState().localEstimate;
    expect(le).to.not.be.null;
    // Math.round(25.6) === 26 !== 25 (local value) -> force local integer
    expect(le!.weeklyPct).to.equal(25);
    // Math.round(10.6) === 11 !== 10 (local value) -> force local integer
    expect(le!.windowPct).to.equal(10);

    rlStub.restore();
  });

  it('preserves authoritative quota decimals instead of adopting a local fallback', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    // Seed old quota with 12.1% precision (e.g. from a previous response)
    store.dispatch({
      type: 'API_SUCCESS',
      payload: {
        weeklyLimit: 100_000_000, weeklyUsed: 12_100_000, weeklyUsedPct: 12.1, weeklyResetAt: Date.now() + 86400000,
        windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 10.4, windowResetAt: Date.now() + 18000000,
        parallelLimit: 30,
      },
    });
    // No localEstimate yet
    expect(store.getState().localEstimate).to.be.null;

    // Next local read returns integer 12 (rounded down from 12.1)
    const rateLimits: RateLimits = {
      secondary: { used_percent: 12, resets_in_seconds: 86400 },
      primary: { used_percent: 10, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    sinon.stub(localUsage, 'getLocalUsage').resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 2_000_000, tokensOut5h: 500_000, tokensCacheRead5h: 100, tokensCacheCreate5h: 50,
      requests5h: 4,
      tokensIn7d: 10_000_000, tokensOut7d: 2_000_000, tokensCacheRead7d: 500, tokensCacheCreate7d: 200,
      cost7d: 25, requests7d: 10,
      cost5h: 3,
      tokensThisCycle: 25_000_000, costThisCycle: 50, requestsThisCycle: 20,
      entries: [],
    });

    scheduler.start();
    // First tick is long tick (force)
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    // A failed API read must retain official values, not recalibrate from old logs.
    expect(store.getState().quota!.weeklyUsedPct).to.equal(12.1);
    expect(store.getState().quota!.windowUsedPct).to.equal(10.4);

    rlStub.restore();
  });

  it('smooth estimate preserved through short tick after long tick', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    // Local rate limits return integer 25
    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 10, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage');
    // First long tick: costThisCycle=10, cost5h=5
    getUsageStub.onCall(0).resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 25_000_000, tokensOut5h: 5_000_000, tokensCacheRead5h: 1_000, tokensCacheCreate5h: 500,
      requests5h: 5,
      tokensIn7d: 25_000_000, tokensOut7d: 5_000_000, tokensCacheRead7d: 1_000, tokensCacheCreate7d: 500,
      cost7d: 10, requests7d: 5,
      cost5h: 5,
      tokensThisCycle: 25_000_000, costThisCycle: 10, requestsThisCycle: 5,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });
    // Short tick: cost increases slightly -> creates smooth estimate
    getUsageStub.onCall(1).resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 25_300_000, tokensOut5h: 5_000_000, tokensCacheRead5h: 1_000, tokensCacheCreate5h: 500,
      requests5h: 5,
      tokensIn7d: 25_300_000, tokensOut7d: 5_000_000, tokensCacheRead7d: 1_000, tokensCacheCreate7d: 500,
      cost7d: 10, requests7d: 5,
      cost5h: 5.06,
      tokensThisCycle: 25_300_000, costThisCycle: 10.12, requestsThisCycle: 5,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });
    // Second long tick: API still 25%, local cost same as short tick
    getUsageStub.onCall(2).resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 25_300_000, tokensOut5h: 5_000_000, tokensCacheRead5h: 1_000, tokensCacheCreate5h: 500,
      requests5h: 5,
      tokensIn7d: 25_300_000, tokensOut7d: 5_000_000, tokensCacheRead7d: 1_000, tokensCacheCreate7d: 500,
      cost7d: 10, requests7d: 5,
      cost5h: 5.06,
      tokensThisCycle: 25_300_000, costThisCycle: 10.12, requestsThisCycle: 5,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });
    // Short tick after second long tick: same usage
    getUsageStub.onCall(3).resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 25_300_000, tokensOut5h: 5_000_000, tokensCacheRead5h: 1_000, tokensCacheCreate5h: 500,
      requests5h: 5,
      tokensIn7d: 25_300_000, tokensOut7d: 5_000_000, tokensCacheRead7d: 1_000, tokensCacheCreate7d: 500,
      cost7d: 10, requests7d: 5,
      cost5h: 5.06,
      tokensThisCycle: 25_300_000, costThisCycle: 10.12, requestsThisCycle: 5,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });

    scheduler.start();
    // First long tick
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().localEstimate!.weeklyPct).to.equal(25);

    // Short tick -> smooth estimate (k = 25 / 10 = 2.5; 25 + 2.5 * 0.12 = 25.3)
    await clock.tickAsync(5000);
    await Promise.resolve();
    await Promise.resolve();

    const afterShort = store.getState().localEstimate;
    expect(afterShort!.weeklyPct).to.be.greaterThan(25);
    expect(afterShort!.weeklyPct).to.be.lessThan(26);

    // Second long tick -> should preserve smooth estimate
    await clock.tickAsync(60000);
    await Promise.resolve();
    await Promise.resolve();

    const afterLong = store.getState().localEstimate;
    // Math.round(25.3) === 25 (local value) -> preserve smooth estimate
    expect(afterLong!.weeklyPct).to.be.greaterThan(25);
    expect(afterLong!.weeklyPct).to.be.lessThan(26);

    // Short tick after long tick -> should NOT overwrite back to 25
    await clock.tickAsync(5000);
    await Promise.resolve();
    await Promise.resolve();

    const afterSecondShort = store.getState().localEstimate;
    expect(afterSecondShort!.weeklyPct).to.be.greaterThan(25);
    expect(afterSecondShort!.weeklyPct).to.be.lessThan(26);
    // Should be very close to the previous smooth estimate
    expect(afterSecondShort!.weeklyPct).to.be.closeTo(afterLong!.weeklyPct, 0.01);

    rlStub.restore();
  });

  it('respects custom refreshIntervalSeconds for long tick', async () => {
    sinon.stub(ConfigService.prototype, 'refreshIntervalSeconds').value(120);

    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 25, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();
    sinon.stub(localUsage, 'getLocalUsage').resolves({
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    });

    scheduler.start();
    // First tick is immediate long tick
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    expect(rlStub.callCount).to.equal(1);

    // Advance 60 seconds -> should still be short tick (not long)
    await clock.tickAsync(60000);
    await Promise.resolve();
    await Promise.resolve();

    expect(rlStub.callCount).to.equal(1);

    // Advance another 60 seconds -> total 120s -> long tick
    await clock.tickAsync(60000);
    await Promise.resolve();
    await Promise.resolve();

    expect(rlStub.callCount).to.equal(2);

    rlStub.restore();
  });

  it('Promise.race timeout works with fake timers', async () => {
    const never = new Promise(() => {});
    const timeout = new Promise<void>((_, reject) => {
      setTimeout(() => reject(new Error('timed out')), 5000);
    });
    const p = Promise.race([never, timeout]);
    await clock.tickAsync(5000);
    await Promise.resolve();
    try {
      await p;
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as Error).message).to.equal('timed out');
    }
  });

  it('short tick skips dispatch when no local entries exist', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    const rateLimits: RateLimits = {
      secondary: { used_percent: 25, resets_in_seconds: 86400 },
      primary: { used_percent: 10, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    const rlStub = sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage');
    // First long tick: normal usage with entries
    getUsageStub.onCall(0).resolves({
      tokensToday: 1_000_000, costToday: 5, requestsToday: 3,
      tokensIn5h: 25_000_000, tokensOut5h: 5_000_000, tokensCacheRead5h: 1_000, tokensCacheCreate5h: 500,
      requests5h: 5,
      tokensIn7d: 25_000_000, tokensOut7d: 5_000_000, tokensCacheRead7d: 1_000, tokensCacheCreate7d: 500,
      cost7d: 10, requests7d: 5,
      cost5h: 5,
      tokensThisCycle: 25_000_000, costThisCycle: 10, requestsThisCycle: 5,
      entries: [{ timestamp: Date.now(), inputOther: 100, output: 50, inputCacheRead: 10, inputCacheCreation: 5, cost: 0.01, messageId: null }],
    });
    // Short tick: no local cache files (entries empty)
    getUsageStub.onCall(1).resolves({
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    });

    scheduler.start();
    // First long tick
    await clock.tickAsync(100);
    await Promise.resolve();
    await Promise.resolve();

    const afterLong = store.getState();
    expect(afterLong.localEstimate).to.not.be.null;
    expect(afterLong.localEstimate!.weeklyPct).to.equal(25);

    // Short tick with no entries -> should NOT overwrite local percentage
    await clock.tickAsync(5000);
    await Promise.resolve();
    await Promise.resolve();

    const afterShort = store.getState();
    expect(afterShort.localEstimate).to.not.be.null;
    expect(afterShort.localEstimate!.weeklyPct).to.equal(25);

    rlStub.restore();
  });
});

function makeQuotaAt(windowResetAt: number, weeklyResetAt: number): QuotaData {
  return {
    weeklyLimit: 100,
    weeklyUsed: 10,
    weeklyUsedPct: 10,
    weeklyResetAt,
    windowLimit: 100,
    windowUsed: 20,
    windowRemaining: 80,
    windowUsedPct: 20,
    windowResetAt,
    parallelLimit: 0,
  };
}

function makeAnchors(providerId: string, resetAt: number): WindowAnchorData {
  return {
    providerId,
    window5hStartMs: resetAt - 5 * 3600 * 1000,
    window5hResetAtMs: resetAt,
    window7dStartMs: resetAt - 7 * 24 * 3600 * 1000,
    window7dResetAtMs: resetAt,
    updatedAt: resetAt,
    source: 'api',
  };
}

function makeUsageEntry(timestamp: number, model = 'claude-haiku'): any {
  return {
    timestamp,
    inputOther: 100,
    output: 50,
    inputCacheRead: 10,
    inputCacheCreation: 5,
    cost: 0.01,
    messageId: null,
    model,
  };
}

function makeLocalUsage(overrides: Record<string, any> = {}): any {
  return {
    tokensToday: 0,
    costToday: 0,
    requestsToday: 0,
    tokensIn5h: 0,
    tokensOut5h: 0,
    tokensCacheRead5h: 0,
    tokensCacheCreate5h: 0,
    requests5h: 0,
    tokensIn7d: 0,
    tokensOut7d: 0,
    tokensCacheRead7d: 0,
    tokensCacheCreate7d: 0,
    cost7d: 0,
    requests7d: 0,
    cost5h: 0,
    tokensThisCycle: 0,
    tokensOutThisCycle: 0,
    tokensCacheReadThisCycle: 0,
    tokensCacheCreateThisCycle: 0,
    costThisCycle: 0,
    requestsThisCycle: 0,
    entries: [],
    ...overrides,
  };
}
