import { expect } from 'chai';
import { normalizeStatusBarProviders } from '../src/calc';

describe('normalizeStatusBarProviders', () => {
  it('selects Kimi when the selection is absent, empty or invalid', () => {
    for (const value of [undefined, null, [], ['unknown'], [null, 42, ''], 'codex']) {
      expect(normalizeStatusBarProviders(value)).to.deep.equal(['kimi']);
    }
  });

  it('preserves valid selections and removes duplicates and unknown entries', () => {
    expect(normalizeStatusBarProviders(['claude', 'codex', 'claude', 'unknown'])).to.deep.equal(['claude', 'codex']);
    expect(normalizeStatusBarProviders(['kimi', 'glm', 'cursor'])).to.deep.equal(['kimi', 'glm', 'cursor']);
  });
});
import {
  computeUtilization, buildBar, buildMiniBar, formatPercent, fmtHours, fmtDuration, calculateCost, parseCustomPricing, pricingModelKey,
  createLinearEstimator, ILinearEstimator, fmtCurrency,
  resolveWeeklyPct, resolveWindowPct, resolveFableWeeklyPct,
  resolveAuthDisplayMode, buildIndicatorSuffix,
  resolveResetTime, fmtResetTime,
  estimateStateMemory, formatMemorySize,
} from '../src/calc';
import { QuotaData, TokenPricing, AppState } from '../src/types';
import { defaultState } from '../src/store';
import { formatProviderStatus, remainingQuotaColor } from '../src/calc';

describe('combined provider status', () => {
  it('formats percent and absolute quota windows together', () => {
    const state = defaultState();
    state.quota = {
      weeklyLimit: 100, weeklyUsed: 4.12, weeklyUsedPct: 4.12, weeklyResetAt: Date.now() + 86400000,
      windowLimit: 200, windowUsed: 10.64, windowUsedPct: 5.32, windowRemaining: 189.36,
      windowResetAt: Date.now() + 18000000, parallelLimit: 0,
    };
    state.dataSource = 'api';
    expect(formatProviderStatus(state, '$(openai)', 'Codex', 'percent')).to.equal('$(openai) Codex:4.12% | 5️⃣ 5.32% 🌐');
    expect(formatProviderStatus(state, '$(openai)', 'Codex', 'absolute')).to.equal('$(openai) Codex:4.12/100 | 5️⃣ 10.64/200 🌐');
    expect(formatProviderStatus(defaultState(), 'X', 'Test', 'absolute')).to.include('Test:0.00% | 5️⃣ 0.00%');
  });

  it('keeps API data fresh throughout the default five-minute polling interval', () => {
    const now = Date.now();
    const state = { ...defaultState(), activeProvider: 'kimi', quota: makeQuota(),
      dataSource: 'api' as const, lastSuccessfulFetchAt: now - 300_000 };
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now)).not.to.include('💤');
  });

  it('marks API data stale only after the polling interval plus two minutes', () => {
    const now = Date.now();
    const state = { ...defaultState(), quota: makeQuota(), lastSuccessfulFetchAt: now - 420_000 };
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now)).not.to.include('💤');
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now + 1)).to.include('💤');
  });

  it('honors custom polling intervals in status text', () => {
    const now = Date.now();
    const state = { ...defaultState(), quota: makeQuota(), lastSuccessfulFetchAt: now - 600_000 };
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now, 600)).not.to.include('💤');
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now + 120_001, 600)).to.include('💤');
    state.lastSuccessfulFetchAt = now - 150_000;
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now, 30)).not.to.include('💤');
    expect(formatProviderStatus(state, 'K', 'Kimi', 'percent', now + 1, 30)).to.include('💤');
  });

  it('uses weekly remaining quota with the existing threshold colors', () => {
    const colors = ['white', 'yellow', 'green', 'purple', 'red'];
    for (const [remaining, color] of [[100, 'white'], [81, 'white'], [80, 'yellow'], [60, 'green'], [40, 'purple'], [20, 'red'], [0, 'red'], [-1, 'red'], [101, 'white'], [NaN, 'white']] as const) {
      expect(remainingQuotaColor(remaining, colors)).to.equal(color);
    }
  });
});

describe('calc', () => {
  describe('computeUtilization', () => {
    it('returns zero for null quota', () => {
      const r = computeUtilization(null);
      expect(r.weeklyPct).to.equal(0);
      expect(r.windowPct).to.equal(0);
    });

    it('computes percentages correctly', () => {
      const r = computeUtilization(makeQuota({ weeklyUsed: 250, weeklyLimit: 1000, weeklyUsedPct: 25, windowUsed: 100, windowLimit: 200, windowUsedPct: 50 }));
      expect(r.weeklyUtil).to.equal(0.25);
      expect(r.windowUtil).to.equal(0.5);
      expect(r.weeklyPct).to.equal(25);
      expect(r.windowPct).to.equal(50);
    });

    it('caps at 100%', () => {
      const r = computeUtilization(makeQuota({ weeklyUsed: 1500, weeklyLimit: 1000, weeklyUsedPct: 150 }));
      expect(r.weeklyPct).to.equal(100);
    });

    it('handles zero limit gracefully', () => {
      const r = computeUtilization(makeQuota({ weeklyLimit: 0, windowLimit: 0 }));
      expect(r.weeklyUtil).to.equal(0);
      expect(r.windowUtil).to.equal(0);
    });
  });

  describe('buildBar', () => {
    it('renders full bar at 100%', () => {
      expect(buildBar(1, 10)).to.equal('\u25B0'.repeat(10));
    });
    it('renders empty bar at 0%', () => {
      expect(buildBar(0, 10)).to.equal('\u25B1'.repeat(10));
    });
    it('renders partial bar', () => {
      expect(buildBar(0.25, 10)).to.equal('\u25B0\u25B0\u25B0\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1\u25B1');
    });
  });

  describe('buildMiniBar', () => {
    it('renders 5-char mini bar', () => {
      expect(buildMiniBar(0.4, 5)).to.equal('\u25B0\u25B0\u25B1\u25B1\u25B1');
    });
  });

  describe('calculateCost', () => {
    it('calculates cost from tokens and pricing', () => {
      const pricing: TokenPricing = {
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheCreatePerMillion: 3.75,
      };
      const cost = calculateCost(
        { inputOther: 1_000_000, output: 500_000, inputCacheRead: 0, inputCacheCreation: 0 },
        pricing,
      );
      expect(cost).to.equal(10.5); // 3 + 7.5
    });

    it('calculates Claude Fable cost (1M of each token type)', () => {
      const pricing: TokenPricing = {
        inputPerMillion: 10,
        outputPerMillion: 50,
        cacheReadPerMillion: 1,
        cacheCreatePerMillion: 12.5,
      };
      const cost = calculateCost(
        { inputOther: 1_000_000, output: 1_000_000, inputCacheRead: 1_000_000, inputCacheCreation: 1_000_000 },
        pricing,
      );
      expect(cost).to.equal(73.5); // 10 + 50 + 1 + 12.5
    });
  });

  describe('pricingModelKey', () => {
    it('maps Claude Opus 5.5 to its own key before the generic opus family', () => {
      expect(pricingModelKey('claude-opus-5-5')).to.equal('claudeOpus5_5');
      expect(pricingModelKey('Claude Opus 5.5')).to.equal('claudeOpus5_5');
      expect(pricingModelKey('claude-opus-5-5[1m]')).to.equal('claudeOpus5_5');
      expect(pricingModelKey('claude-opus-5')).to.equal('claudeOpus');
      expect(pricingModelKey('claude-opus-4-8')).to.equal('claudeOpus');
    });

    it('maps other Claude families', () => {
      expect(pricingModelKey('claude-fable-5-1')).to.equal('claudeFable5_1');
      expect(pricingModelKey('claude-sonnet-5')).to.equal('claudeSonnet5');
      expect(pricingModelKey('claude-haiku-4-5')).to.equal('claudeHaiku');
    });

    it('maps GPT-6 variants, defaulting to Astra', () => {
      expect(pricingModelKey('gpt-6-astra')).to.equal('gpt6Astra');
      expect(pricingModelKey('gpt-6-sol')).to.equal('gpt6Sol');
      expect(pricingModelKey('GPT-6 Luna')).to.equal('gpt6Luna');
      expect(pricingModelKey('gpt-6')).to.equal('gpt6Astra');
    });

    it('keeps Kimi mapping and strips punctuation for others', () => {
      expect(pricingModelKey('kimi-k3')).to.equal('k3');
      expect(pricingModelKey('kimi-k2.6')).to.equal('k2_6');
      expect(pricingModelKey('gpt-5')).to.equal('gpt5');
    });
  });

  describe('parseCustomPricing', () => {
    it('parses "input,output,cacheRead,cacheWrite" string', () => {
      expect(parseCustomPricing('10,50,1,12.5')).to.deep.equal({
        inputPerMillion: 10,
        outputPerMillion: 50,
        cacheReadPerMillion: 1,
        cacheCreatePerMillion: 12.5,
      });
    });

    it('tolerates whitespace around numbers', () => {
      expect(parseCustomPricing(' 3 , 15 , 0.3 , 3.75 ')).to.deep.equal({
        inputPerMillion: 3,
        outputPerMillion: 15,
        cacheReadPerMillion: 0.3,
        cacheCreatePerMillion: 3.75,
      });
    });

    it('accepts full-width (Chinese) commas', () => {
      expect(parseCustomPricing('10，50，1，12.5')).to.deep.equal({
        inputPerMillion: 10,
        outputPerMillion: 50,
        cacheReadPerMillion: 1,
        cacheCreatePerMillion: 12.5,
      });
    });

    it('accepts zero prices', () => {
      expect(parseCustomPricing('0,0,0,0')).to.deep.equal({
        inputPerMillion: 0,
        outputPerMillion: 0,
        cacheReadPerMillion: 0,
        cacheCreatePerMillion: 0,
      });
    });

    it('returns null for too few values', () => {
      expect(parseCustomPricing('10,50,1')).to.equal(null);
    });

    it('returns null for too many values', () => {
      expect(parseCustomPricing('10,50,1,12.5,99')).to.equal(null);
    });

    it('returns null for negative values', () => {
      expect(parseCustomPricing('10,-50,1,12.5')).to.equal(null);
    });

    it('returns null for non-numeric values', () => {
      expect(parseCustomPricing('10,abc,1,12.5')).to.equal(null);
    });

    it('returns null for empty string', () => {
      expect(parseCustomPricing('')).to.equal(null);
    });

    it('returns null for empty segments', () => {
      expect(parseCustomPricing('10,,1,12.5')).to.equal(null);
    });
  });

  describe('fmtHours', () => {
    it('formats seconds', () => {
      expect(fmtHours(0.0083)).to.equal('30s'); // ~30 seconds
    });
    it('formats minutes and seconds', () => {
      expect(fmtHours(0.5)).to.equal('30m00s');
    });
    it('formats hours and minutes', () => {
      expect(fmtHours(2.5)).to.equal(' 2h30m');
    });
    it('formats days and hours', () => {
      expect(fmtHours(50)).to.equal(' 2d02h');
    });
    it('pads single digits correctly', () => {
      expect(fmtHours(0.0167)).to.equal(' 1m00s'); // ~1 minute
      expect(fmtHours(1)).to.equal(' 1h00m');
      expect(fmtHours(24)).to.equal(' 1d00h');
    });
    it('pads seconds with space for single digit', () => {
      expect(fmtDuration(7)).to.equal(' 7s');
      expect(fmtDuration(0)).to.equal(' 0s');
    });
  });

  describe('createLinearEstimator', () => {
    it('updates k when apiPct > 5% and localCost > 0', () => {
      const est = createLinearEstimator();
      est.update(62, 10);
      expect(est.k).to.be.closeTo(6.2, 0.001);
      expect(est.P).to.equal(62);
      expect(est.C).to.equal(10);
    });

    it('does not update k when apiPct <= 5%', () => {
      const est = createLinearEstimator();
      est.update(62, 10); // establish initial k
      const oldK = est.k;
      est.update(3, 5);
      expect(est.k).to.equal(oldK); // k unchanged
      expect(est.P).to.equal(3);    // P always updated
      expect(est.C).to.equal(5);    // C always updated
    });

    it('does not update k when localCost <= 0', () => {
      const est = createLinearEstimator();
      est.update(62, 10);
      const oldK = est.k;
      est.update(10, 0);
      expect(est.k).to.equal(oldK);
    });

    it('estimates correctly with valid k', () => {
      const est = createLinearEstimator();
      est.update(62, 10); // k = 6.2
      // cost increases by 2 -> pct increases by 6.2 * 2 = 12.4
      expect(est.estimate(12)).to.be.closeTo(74.4, 0.001);
    });

    it('falls back to currentCost when k = 0', () => {
      const est = createLinearEstimator();
      expect(est.estimate(5)).to.equal(5);
      expect(est.estimate(0)).to.equal(0);
    });

    it('clamps estimate to [0, 100]', () => {
      const est = createLinearEstimator();
      est.update(62, 10); // k = 6.2
      expect(est.estimate(-100)).to.equal(0);
      expect(est.estimate(200)).to.equal(100);
    });

    it('preserves k when P <= 5% and estimates with old k', () => {
      const est = createLinearEstimator();
      est.update(62, 10); // k = 6.2
      est.update(3, 5);   // P=3, C=5, k stays 6.2
      // p = 3 + 6.2 * (7 - 5) = 3 + 12.4 = 15.4
      expect(est.estimate(7)).to.be.closeTo(15.4, 0.001);
    });

    it('handles cost decrease gracefully', () => {
      const est = createLinearEstimator();
      est.update(62, 10); // k = 6.2
      // cost decreases by 3 -> pct decreases by 18.6
      expect(est.estimate(7)).to.be.closeTo(43.4, 0.001);
    });
  });

  describe('resolveWeeklyPct', () => {
    it('returns API quota value when local estimate is stale', () => {
      const state = makeState({
        quota: { weeklyUsedPct: 62, windowUsedPct: 89 },
        localEstimate: { weeklyPct: 2, windowPct: 46, calibratedAt: Date.now() },
      });
      expect(resolveWeeklyPct(state)).to.equal(62);
      expect(resolveWindowPct(state)).to.equal(89);
    });

    it('preserves local decimal precision when rounded value matches API', () => {
      const state = makeState({
        quota: { weeklyUsedPct: 62, windowUsedPct: 89 },
        localEstimate: { weeklyPct: 62.3, windowPct: 89.1, calibratedAt: Date.now() },
      });
      expect(resolveWeeklyPct(state)).to.equal(62.3);
      expect(resolveWindowPct(state)).to.equal(89.1);
    });

    it('falls back to local estimate when no API quota exists', () => {
      const state = makeState({
        quota: null,
        localEstimate: { weeklyPct: 46, windowPct: 2, calibratedAt: Date.now() },
      });
      expect(resolveWeeklyPct(state)).to.equal(46);
      expect(resolveWindowPct(state)).to.equal(2);
    });

    it('returns 0 when no data exists', () => {
      const state = makeState({ quota: null, localEstimate: null });
      expect(resolveWeeklyPct(state)).to.equal(0);
      expect(resolveWindowPct(state)).to.equal(0);
    });

    it('returns API value even when local estimate has no calibration', () => {
      const state = makeState({
        quota: { weeklyUsedPct: 62, windowUsedPct: 89 },
        localEstimate: { weeklyPct: 2, windowPct: 46, calibratedAt: null },
      });
      expect(resolveWeeklyPct(state)).to.equal(62);
      expect(resolveWindowPct(state)).to.equal(89);
    });

    it('returns 0 when resetAt has expired', () => {
      const past = Date.now() - 3600 * 1000;
      const state = makeState({
        quota: { weeklyUsedPct: 62, windowUsedPct: 89, weeklyResetAt: past, windowResetAt: past },
      });
      expect(resolveWeeklyPct(state)).to.equal(0);
      expect(resolveWindowPct(state)).to.equal(0);
    });
  });

  describe('resolveFableWeeklyPct', () => {
    it('returns 0 after the Fable reset while keeping the limit available', () => {
      const now = Date.now();
      const state = makeState({
        quota: {
          weeklyUsedPct: 62,
          windowUsedPct: 89,
          fableWeeklyUsedPct: 56,
          fableWeeklyResetAt: now - 1000,
        },
      });

      expect(resolveFableWeeklyPct(state, now)).to.equal(0);
    });

    it('returns undefined when no Fable limit has ever been observed', () => {
      expect(resolveFableWeeklyPct(makeState({ quota: null }))).to.equal(undefined);
    });
  });

  describe('resolveResetTime', () => {
    it('returns original resetAt when not expired', () => {
      const now = 1000000;
      const resetAt = now + 3600 * 1000;
      const result = resolveResetTime(resetAt, 5 * 3600 * 1000, now);
      expect(result.resetAt).to.equal(resetAt);
      expect(result.isEstimated).to.be.false;
    });

    it('returns now + period for null/undefined/0', () => {
      const now = 1000000;
      const period = 5 * 3600 * 1000;
      expect(resolveResetTime(null, period, now).resetAt).to.equal(now + period);
      expect(resolveResetTime(undefined, period, now).resetAt).to.equal(now + period);
      expect(resolveResetTime(0, period, now).resetAt).to.equal(now + period);
      expect(resolveResetTime(null, period, now).isEstimated).to.be.true;
    });

    it('computes next cycle when just expired', () => {
      const now = 10 * 3600 * 1000;
      const period = 5 * 3600 * 1000;
      const expired = now - 1000;
      const result = resolveResetTime(expired, period, now);
      expect(result.resetAt).to.equal(expired + period);
      expect(result.isEstimated).to.be.true;
    });

    it('advances one full period when resetAt equals now', () => {
      const now = 10 * 3600 * 1000;
      const period = 5 * 3600 * 1000;
      expect(resolveResetTime(now, period, now).resetAt).to.equal(now + period);
    });

    it('computes next cycle after multiple periods', () => {
      const now = 50 * 3600 * 1000;
      const period = 5 * 3600 * 1000;
      const expired = 8 * 3600 * 1000;
      const result = resolveResetTime(expired, period, now);
      const periodsPassed = Math.ceil((now - expired) / period);
      expect(result.resetAt).to.equal(expired + periodsPassed * period);
      expect(result.isEstimated).to.be.true;
    });
  });

  describe('fmtResetTime', () => {
    it('formats future reset time with absolute and remaining', () => {
      const now = new Date('2026-05-13T10:00:00').getTime();
      const resetAt = new Date('2026-05-13T14:25:00').getTime();
      const result = fmtResetTime(resetAt, 5 * 3600 * 1000, now);
      expect(result).to.include('2026-05-13 14:25:00');
      expect(result).to.include('4h25m');
    });

    it('estimates next cycle when expired', () => {
      const now = new Date('2026-05-13T10:00:00').getTime();
      const expired = new Date('2026-05-13T02:00:00').getTime();
      const result = fmtResetTime(expired, 5 * 3600 * 1000, now);
      // 过期 8h，周期 5h，需要前进 2 个周期 = 10h，nextResetAt = 12:00
      expect(result).to.include('2026-05-13 12:00:00');
      expect(result).to.include('2h00m');
    });
  });

  describe('resolveAuthDisplayMode', () => {
    it('returns normal when authenticated with quota', () => {
      const state = makeState({ quota: {}, authStatus: 'authenticated' });
      expect(resolveAuthDisplayMode(state)).to.equal('normal');
    });

    it('returns degraded when expired with quota', () => {
      const state = makeState({ quota: {}, authStatus: 'expired' });
      expect(resolveAuthDisplayMode(state)).to.equal('degraded');
    });

    it('returns degraded when expired with only local estimate', () => {
      const state = makeState({ quota: null, localEstimate: { weeklyPct: 10 }, authStatus: 'expired' });
      expect(resolveAuthDisplayMode(state)).to.equal('degraded');
    });

    it('returns blocked when expired without any data', () => {
      const state = makeState({ quota: null, localEstimate: null, authStatus: 'expired' });
      expect(resolveAuthDisplayMode(state)).to.equal('blocked');
    });

    it('returns degraded when failed with error and data', () => {
      const state = makeState({ quota: {}, authStatus: 'failed', error: 'HTTP 401' });
      expect(resolveAuthDisplayMode(state)).to.equal('degraded');
    });

    it('returns blocked when failed with error and no data', () => {
      const state = makeState({ quota: null, localEstimate: null, authStatus: 'failed', error: 'HTTP 401' });
      expect(resolveAuthDisplayMode(state)).to.equal('blocked');
    });

    it('returns normal when failed without error (regression guard)', () => {
      const state = makeState({ quota: null, localEstimate: null, authStatus: 'failed' });
      expect(resolveAuthDisplayMode(state)).to.equal('normal');
    });

    it('returns normal for missing and unknown (handled elsewhere)', () => {
      expect(resolveAuthDisplayMode(makeState({ authStatus: 'missing' }))).to.equal('normal');
      expect(resolveAuthDisplayMode(makeState({ authStatus: 'unknown' }))).to.equal('normal');
    });
  });

  describe('buildIndicatorSuffix', () => {
    const THRESHOLD = 120_000;

    it('shows only source indicator for fresh api data', () => {
      const now = Date.now();
      const state = makeState({ quota: {}, authStatus: 'authenticated', dataSource: 'api', lastSuccessfulFetchAt: now });
      expect(buildIndicatorSuffix(state, now, THRESHOLD, ['source', 'auth'])).to.equal(' \uD83C\uDF10');
    });

    it('combines stale, source and auth indicators in fixed order', () => {
      const now = Date.now();
      const state = makeState({
        quota: null, localEstimate: { weeklyPct: 10 },
        authStatus: 'expired', dataSource: 'local-only',
        lastSuccessfulFetchAt: now - THRESHOLD - 1,
      });
      expect(buildIndicatorSuffix(state, now, THRESHOLD, ['stale', 'source', 'auth']))
        .to.equal(' \uD83D\uDCA4 \u26D3\uFE0F\u200D\uD83D\uDCA5 \uD83D\uDD10');
    });

    it('respects the parts filter', () => {
      const now = Date.now();
      const state = makeState({
        quota: null, localEstimate: { weeklyPct: 10 },
        authStatus: 'expired', dataSource: 'local-only',
        lastSuccessfulFetchAt: now - THRESHOLD - 1,
      });
      expect(buildIndicatorSuffix(state, now, THRESHOLD, ['stale', 'auth']))
        .to.equal(' \uD83D\uDCA4 \uD83D\uDD10');
    });

    it('treats missing lastSuccessfulFetchAt without quota as stale', () => {
      const now = Date.now();
      const state = makeState({ quota: null, localEstimate: { weeklyPct: 10 } });
      expect(buildIndicatorSuffix(state, now, THRESHOLD, ['stale'])).to.equal(' \uD83D\uDCA4');
    });

    it('omits auth indicator when auth is normal', () => {
      const now = Date.now();
      const state = makeState({ quota: {}, authStatus: 'authenticated', dataSource: 'api', lastSuccessfulFetchAt: now });
      expect(buildIndicatorSuffix(state, now, THRESHOLD, ['auth'])).to.equal('');
    });
  });
});

function makeQuota(partial: Partial<QuotaData> = {}): QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 0, weeklyUsedPct: 0, weeklyResetAt: 0,
    windowLimit: 200, windowUsed: 0, windowRemaining: 200, windowUsedPct: 0, windowResetAt: 0,
    parallelLimit: 30,
    ...partial,
  };
}

function makeState(partial: { quota?: Partial<QuotaData> | null; localEstimate?: Partial<import('../src/types').LocalEstimate> | null; usageEntries?: import('../src/types').UsageEntry[]; estHistory?: import('../src/types').EstHistoryEntry[]; authStatus?: AppState['authStatus']; error?: string; dataSource?: AppState['dataSource']; lastSuccessfulFetchAt?: number }): AppState {
  const base: AppState = {
    quota: null,
    lastFetchAt: null,
    lastSuccessfulFetchAt: null,
    error: null,
    authStatus: 'unknown',
    dataSource: 'no-data',
    isLoading: false,
    localEstimate: null,
    usageEntries: [],
    estHistory: [],
    activeProvider: 'codex',
    ui: { displayMode: 'percent', language: 'auto', isPaused: false },
  };
  if (partial.quota === null) {
    base.quota = null;
  } else if (partial.quota) {
    base.quota = makeQuota(partial.quota);
  }
  if (partial.localEstimate) {
    base.localEstimate = {
      weeklyPct: 0,
      windowPct: 0,
      weeklyP: 0,
      weeklyC: 0,
      weeklyK: 0,
      windowP: 0,
      windowC: 0,
      windowK: 0,
      calibratedAt: null,
      cost5h: 0,
      cost7d: 0,
      costToday: 0,
      requestsToday: 0,
      tokensToday: 0,
      tokensOutToday: 0,
      tokensCacheReadToday: 0,
      tokensCacheCreateToday: 0,
      tokensIn5h: 0,
      tokensOut5h: 0,
      tokensCacheRead5h: 0,
      tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0,
      tokensOut7d: 0,
      tokensCacheRead7d: 0,
      tokensCacheCreate7d: 0,
      requests7d: 0,
      tokensThisCycle: 0,
      tokensOutThisCycle: 0,
      tokensCacheReadThisCycle: 0,
      tokensCacheCreateThisCycle: 0,
      costThisCycle: 0,
      requestsThisCycle: 0,
      ...partial.localEstimate,
    };
  }
  if (partial.usageEntries) {
    base.usageEntries = partial.usageEntries;
  }
  if (partial.estHistory) {
    base.estHistory = partial.estHistory;
  }
  if (partial.authStatus) {
    base.authStatus = partial.authStatus;
  }
  if (partial.error !== undefined) {
    base.error = partial.error;
  }
  if (partial.dataSource) {
    base.dataSource = partial.dataSource;
  }
  if (partial.lastSuccessfulFetchAt !== undefined) {
    base.lastSuccessfulFetchAt = partial.lastSuccessfulFetchAt;
  }
  return base;
}

describe('estimateStateMemory', () => {
  it('returns empty breakdown for null state', () => {
    const result = estimateStateMemory(null);
    expect(result.totalBytes).to.equal(0);
    expect(result.items).to.have.length(0);
  });

  it('returns only storeOverhead for empty state', () => {
    const state = makeState({ quota: null, localEstimate: null });
    const result = estimateStateMemory(state);
    expect(result.totalBytes).to.be.greaterThan(0);
    expect(result.items).to.have.length(1);
    expect(result.items[0].name).to.equal('Store.storeOverhead');
  });

  it('includes estHistory when present', () => {
    const state = makeState({
      quota: null,
      localEstimate: null,
      estHistory: Array.from({ length: 100 }, () => ({
        timestamp: Date.now(),
        source: 'short' as const,
        apiWeeklyPct: null,
        apiWindowPct: null,
        estimatedWeeklyPct: 51,
        estimatedWindowPct: 19,
        localCost7d: 10,
        localCost5h: 2,
        weeklyP: 50,
        weeklyC: 10,
        weeklyK: 5,
        windowP: 20,
        windowC: 2,
        windowK: 10,
        windowStartMs: Date.now() - 5 * 3600 * 1000,
        weeklyStartMs: Date.now() - 7 * 24 * 3600 * 1000,
      })),
    });
    const result = estimateStateMemory(state);
    const historyItem = result.items.find((i) => i.name === 'Store.estHistory');
    expect(historyItem).to.exist;
    expect(historyItem!.bytes).to.be.greaterThan(0);
  });

  it('estimates usageEntries memory', () => {
    const entries = Array.from({ length: 1000 }, (_, i) => ({
      timestamp: Date.now(),
      inputOther: 1000,
      output: 500,
      inputCacheRead: 100,
      inputCacheCreation: 50,
      cost: 0.01,
      messageId: 'msg_' + i,
      model: 'gpt-4',
    }));
    const state = makeState({ usageEntries: entries });
    const result = estimateStateMemory(state);
    const entryItem = result.items.find((i) => i.name === 'Store.usageEntries');
    expect(entryItem).to.exist;
    expect(entryItem!.bytes).to.be.greaterThan(0);
    expect(result.totalBytes).to.be.greaterThan(entryItem!.bytes);
  });

  it('sorts items by bytes descending', () => {
    const entries = Array.from({ length: 100 }, (_, i) => ({
      timestamp: Date.now(),
      inputOther: 1000, output: 500, inputCacheRead: 100, inputCacheCreation: 50,
      cost: 0.01, messageId: 'msg_' + i, model: 'gpt-4',
    }));
    const state = makeState({ usageEntries: entries, quota: { weeklyUsedPct: 25, windowUsedPct: 10 } });
    const result = estimateStateMemory(state);
    for (let i = 1; i < result.items.length; i++) {
      expect(result.items[i - 1].bytes).to.be.at.least(result.items[i].bytes);
    }
  });
});

describe('formatMemorySize', () => {
  it('formats bytes', () => {
    expect(formatMemorySize(512)).to.equal('512 B');
  });
  it('formats KB', () => {
    expect(formatMemorySize(1536)).to.equal('1.50 KB');
  });
  it('formats MB', () => {
    expect(formatMemorySize(2 * 1024 * 1024)).to.equal('2.00 MB');
  });
  it('formats GB', () => {
    expect(formatMemorySize(3 * 1024 * 1024 * 1024)).to.equal('3.00 GB');
  });
});

import {
  buildDailyBuckets, buildHourlyBuckets, formatDateLocal, formatMonthLocal,
  fmtRmb, fmtNumber, fmtCostCurveTime, heatmapColor,
} from '../src/calc';

describe('Phase 3 calc helpers', () => {
  describe('buildDailyBuckets', () => {
    it('builds buckets for a single day', () => {
      const start = new Date('2026-05-10T00:00:00').getTime();
      const end = start + 3600 * 1000;
      const buckets = buildDailyBuckets(start, end);
      expect(buckets.length).to.equal(1);
      expect(buckets[0].key).to.equal('2026-05-10');
    });

    it('builds buckets across midnight', () => {
      const start = new Date('2026-05-10T12:00:00').getTime();
      const end = new Date('2026-05-12T06:00:00').getTime();
      const buckets = buildDailyBuckets(start, end);
      expect(buckets.length).to.equal(3);
      expect(buckets[0].key).to.equal('2026-05-10');
      expect(buckets[1].key).to.equal('2026-05-11');
      expect(buckets[2].key).to.equal('2026-05-12');
    });
  });

  describe('buildHourlyBuckets', () => {
    it('builds 24 hourly buckets', () => {
      const day = new Date('2026-05-10T00:00:00').getTime();
      const buckets = buildHourlyBuckets(day);
      expect(buckets.length).to.equal(24);
      expect(buckets[0].key).to.equal('00:00');
      expect(buckets[23].key).to.equal('23:00');
    });
  });

  describe('formatDateLocal', () => {
    it('formats as YYYY-MM-DD', () => {
      const ms = new Date('2026-05-10T12:00:00').getTime();
      expect(formatDateLocal(ms)).to.equal('2026-05-10');
    });
  });

  describe('formatMonthLocal', () => {
    it('formats as YYYY-MM', () => {
      const ms = new Date('2026-05-10T12:00:00').getTime();
      expect(formatMonthLocal(ms)).to.equal('2026-05');
    });
  });

  describe('fmtCurrency', () => {
    it('formats with default $ and 2 decimals', () => {
      expect(fmtCurrency(12.345)).to.equal('$12.35');
      expect(fmtCurrency(0)).to.equal('$0.00');
    });
    it('formats with custom symbol', () => {
      expect(fmtCurrency(12.345, '¥')).to.equal('¥12.35');
    });
    it('handles non-finite', () => {
      expect(fmtCurrency(NaN)).to.equal('$0.00');
    });
  });

  describe('fmtNumber', () => {
    it('formats with commas', () => {
      expect(fmtNumber(1234567)).to.equal('1,234,567');
      expect(fmtNumber(0)).to.equal('0');
    });
  });

  describe('fmtCostCurveTime', () => {
    it('formats 5h window', () => {
      const ms = new Date('2026-05-10T14:30:45').getTime();
      expect(fmtCostCurveTime(ms, '5h')).to.match(/\d{2}:\d{2}:\d{2}/);
    });
    it('formats 7d window', () => {
      const ms = new Date('2026-05-10T14:30:45').getTime();
      expect(fmtCostCurveTime(ms, '7d')).to.match(/5\.10-\d{2}:\d{2}/);
    });
  });

  describe('heatmapColor', () => {
    it('returns blue at t=0', () => {
      expect(heatmapColor(0)).to.equal('rgb(13,71,161)');
    });
    it('returns red at t=1', () => {
      expect(heatmapColor(1)).to.equal('rgb(191,54,12)');
    });
    it('clamps out of range', () => {
      expect(heatmapColor(-1)).to.equal('rgb(13,71,161)');
      expect(heatmapColor(2)).to.equal('rgb(191,54,12)');
    });
  });
});
