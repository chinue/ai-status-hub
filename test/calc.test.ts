import { expect } from 'chai';
import {
  computeUtilization, buildBar, buildMiniBar, formatPercent, fmtHours, fmtDuration, calculateCost,
  calibrateTokenCapacity, calibrateWindowCostCapacity, estimateWeeklyPct, estimateWindowPct,
  fallbackWeeklyPct, fallbackWindowPct, isCalibrationValid, fmtCurrency,
} from '../src/calc';
import { QuotaData, TokenPricing } from '../src/types';

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

  describe('calibrateTokenCapacity', () => {
    it('calculates capacity from API pct and local tokens', () => {
      // 10M tokens at 62% -> capacity = 10M / 0.62 = ~16.13M
      const cap = calibrateTokenCapacity(62, 10_000_000);
      expect(cap).to.be.closeTo(16_129_032, 1);
    });
    it('returns null for zero API pct', () => {
      expect(calibrateTokenCapacity(0, 10_000_000)).to.be.null;
    });
    it('returns null for zero local tokens', () => {
      expect(calibrateTokenCapacity(62, 0)).to.be.null;
    });
  });

  describe('calibrateWindowCostCapacity', () => {
    it('calculates capacity from API pct and local cost', () => {
      // ¥45.67 at 30% -> capacity = 45.67 / 0.30 = ~152.23
      const cap = calibrateWindowCostCapacity(30, 45.67);
      expect(cap).to.be.closeTo(152.23, 0.01);
    });
    it('returns null for zero API pct', () => {
      expect(calibrateWindowCostCapacity(0, 45.67)).to.be.null;
    });
  });

  describe('estimateWeeklyPct', () => {
    it('estimates percentage from local tokens and capacity', () => {
      // 10M tokens / 16.13M capacity = ~62%
      const pct = estimateWeeklyPct(10_000_000, 16_129_032);
      expect(pct).to.be.closeTo(62, 0.1);
    });
    it('caps at 100%', () => {
      expect(estimateWeeklyPct(20_000_000, 16_129_032)).to.equal(100);
    });
    it('returns null without capacity', () => {
      expect(estimateWeeklyPct(10_000_000, null)).to.be.null;
    });
  });

  describe('estimateWindowPct', () => {
    it('estimates percentage from local cost and capacity', () => {
      const pct = estimateWindowPct(45.67, 152.23);
      expect(pct).to.be.closeTo(30, 0.1);
    });
    it('returns null without capacity', () => {
      expect(estimateWindowPct(45.67, null)).to.be.null;
    });
  });

  describe('fallbackWeeklyPct', () => {
    it('falls back to used/limit ratio', () => {
      expect(fallbackWeeklyPct(250_000, 1_000_000)).to.equal(25);
    });
    it('returns 0 when limit is null', () => {
      expect(fallbackWeeklyPct(250_000, null)).to.equal(0);
    });
  });

  describe('fallbackWindowPct', () => {
    it('falls back to used/limit ratio', () => {
      expect(fallbackWindowPct(50, 200)).to.equal(25);
    });
    it('returns 0 when limit is null', () => {
      expect(fallbackWindowPct(50, null)).to.equal(0);
    });
  });

  describe('isCalibrationValid', () => {
    it('returns true for fresh calibration matching resetAt', () => {
      const resetAt = Date.now();
      const valid = isCalibrationValid(
        { tokenCapacity: 100, windowCostCapacity: 50, calibratedAt: Date.now(), resetAt },
        resetAt,
      );
      expect(valid).to.be.true;
    });
    it('returns false when resetAt mismatches', () => {
      const valid = isCalibrationValid(
        { tokenCapacity: 100, windowCostCapacity: 50, calibratedAt: Date.now(), resetAt: 1000 },
        2000,
      );
      expect(valid).to.be.false;
    });
    it('returns false when calibration is too old', () => {
      const old = Date.now() - 8 * 24 * 3600 * 1000; // 8 days ago
      const valid = isCalibrationValid(
        { tokenCapacity: 100, windowCostCapacity: 50, calibratedAt: old, resetAt: 1000 },
        1000,
      );
      expect(valid).to.be.false;
    });
    it('returns false for null calibration', () => {
      expect(isCalibrationValid(null, 1000)).to.be.false;
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
