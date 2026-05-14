import { expect } from 'chai';
import * as sinon from 'sinon';
import { Scheduler } from '../src/services/scheduler';
import { Store } from '../src/store';
import { IAuthProvider, IQuotaApiProvider, RateLimits } from '../src/providers/base/types';
import { CacheService } from '../src/services/cacheService';
import { LocalUsageService } from '../src/services/localUsageService';
import { ConfigService } from '../src/config';
import { makeContext } from './mocks/vscode';

describe('Scheduler', () => {
  let clock: sinon.SinonFakeTimers;
  let store: Store;
  let auth: IAuthProvider;
  let api: IQuotaApiProvider;
  let cache: CacheService;
  let scheduler: Scheduler;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    store = new Store();
    auth = {
      resolveToken: async () => null, // skip API path in tests, exercise local fallback
      invalidate: () => {},
    };
    api = {
      fetchQuota: async () => ({ ok: false, error: 'not stubbed' }),
    };
    cache = new CacheService();
    const localUsage = LocalUsageService.getInstance();
    scheduler = new Scheduler(store, auth, api, cache, localUsage);
  });

  afterEach(() => {
    scheduler.stop();
    clock.restore();
    sinon.restore();

    (CacheService as any).instance = undefined;
    (LocalUsageService as any).instance = undefined;
  });

  it('tick dispatches LOADING_START -> API_SUCCESS -> LOADING_END', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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

  it('short tick updates local estimate with decimal precision', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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

  it('short tick dispatches full usage detail in LOCAL_ESTIMATE', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

    const rateLimits: RateLimits = {
      secondary: { used_percent: 62, resets_in_seconds: 86400 },
      primary: { used_percent: 25, resets_in_seconds: 18000 },
    };
    const localUsage = LocalUsageService.getInstance();
    sinon.stub(localUsage, 'getRateLimits').resolves(rateLimits);
    sinon.stub(cache, 'write').resolves();

    const getUsageStub = sinon.stub(localUsage, 'getLocalUsage');
    getUsageStub.onFirstCall().resolves({
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
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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

  it('preserves old quota decimal precision when local returns integer and no current estimate', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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

    const le = store.getState().localEstimate;
    expect(le).to.not.be.null;
    // Old quota had 12.1, local returns 12 -> preserve old precision
    expect(le!.weeklyPct).to.equal(12.1);
    // Old quota had 10.4, local returns 10 -> preserve old precision
    expect(le!.windowPct).to.equal(10.4);

    rlStub.restore();
  });

  it('smooth estimate preserved through short tick after long tick', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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

  it('short tick skips dispatch when no local entries exist', async () => {
    const ctx = makeContext();
    await ctx.secrets.store('kimiStatusPro.apiKey', 'sk-test');

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

