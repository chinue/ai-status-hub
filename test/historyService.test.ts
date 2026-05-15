import { expect } from 'chai';
import { HistoryService } from '../src/services/historyService';
import { UsageEntry } from '../src/types';
import { formatDateLocal } from '../src/calc';

function makeEntry(ts: number, overrides: Partial<UsageEntry> = {}): UsageEntry {
  return {
    timestamp: ts,
    inputOther: 1000,
    output: 500,
    inputCacheRead: 100,
    inputCacheCreation: 50,
    cost: 0.5,
    messageId: null,
    model: 'k2.6',
    ...overrides,
  };
}

describe('HistoryService', () => {
  const svc = HistoryService.getInstance();

  describe('buildDashboardAggregates', () => {
    it('returns null aggregates for empty entries', () => {
      const now = new Date('2026-05-13T12:00:00').getTime();
      const todayStart = new Date('2026-05-13T00:00:00').getTime();
      const agg = svc.buildDashboardAggregates([], {
        todayStartMs: todayStart,
        window5hStartMs: now - 5 * 3600 * 1000,
        window7dStartMs: now - 7 * 24 * 3600 * 1000,
        window30dStartMs: now - 30 * 24 * 3600 * 1000,
        monthStartMs: new Date('2026-05-01T00:00:00').getTime(),
      });
      expect(agg.today).to.be.null;
      expect(agg.allTime).to.be.null;
      expect(agg.hourlyForToday).to.deep.equal([]);
    });

    it('aggregates today and windows correctly', () => {
      const now = new Date('2026-05-13T12:00:00').getTime();
      const todayStart = new Date('2026-05-13T00:00:00').getTime();
      const entries: UsageEntry[] = [
        makeEntry(now - 1 * 3600 * 1000), // within 5h
        makeEntry(now - 2 * 3600 * 1000), // within 5h
        makeEntry(now - 10 * 3600 * 1000), // within 7d but not 5h
        makeEntry(now - 20 * 24 * 3600 * 1000), // within 30d but not 7d
      ];
      const agg = svc.buildDashboardAggregates(entries, {
        todayStartMs: todayStart,
        window5hStartMs: now - 5 * 3600 * 1000,
        window7dStartMs: now - 7 * 24 * 3600 * 1000,
        window30dStartMs: now - 30 * 24 * 3600 * 1000,
        monthStartMs: new Date('2026-05-01T00:00:00').getTime(),
      });
      expect(agg.window5h!.messageCount).to.equal(2);
      expect(agg.window7d!.messageCount).to.equal(3);
      expect(agg.window30d!.messageCount).to.equal(4);
    });

    it('includes model breakdown', () => {
      const now = new Date('2026-05-13T12:00:00').getTime();
      const entries: UsageEntry[] = [
        makeEntry(now, { model: 'k2.6' }),
        makeEntry(now, { model: 'k2.6-lite' }),
      ];
      const agg = svc.buildDashboardAggregates(entries, {
        todayStartMs: new Date('2026-05-13T00:00:00').getTime(),
        window5hStartMs: now - 5 * 3600 * 1000,
        window7dStartMs: now - 7 * 24 * 3600 * 1000,
        window30dStartMs: now - 30 * 24 * 3600 * 1000,
        monthStartMs: new Date('2026-05-01T00:00:00').getTime(),
      });
      expect(Object.keys(agg.today!.modelBreakdown)).to.deep.equal(['k2.6', 'k2.6-lite']);
    });

    it('excludes synthetic entries and orders Claude models', () => {
      const now = new Date('2026-05-13T12:00:00').getTime();
      const entries: UsageEntry[] = [
        makeEntry(now, { model: 'claude-opus-4', cost: 3 }),
        makeEntry(now, { model: '<synthetic>', cost: 99 }),
        makeEntry(now, { model: 'claude-sonnet-4', cost: 2 }),
        makeEntry(now, { model: 'claude-3-haiku-20240307', cost: 1 }),
      ];
      const agg = svc.buildDashboardAggregates(entries, {
        todayStartMs: new Date('2026-05-13T00:00:00').getTime(),
        window5hStartMs: now - 5 * 3600 * 1000,
        window7dStartMs: now - 7 * 24 * 3600 * 1000,
        window30dStartMs: now - 30 * 24 * 3600 * 1000,
        monthStartMs: new Date('2026-05-01T00:00:00').getTime(),
      });
      expect(agg.today!.messageCount).to.equal(3);
      expect(Object.keys(agg.today!.modelBreakdown)).to.deep.equal([
        'claude-3-haiku-20240307',
        'claude-sonnet-4',
        'claude-opus-4',
      ]);
    });
  });

  describe('buildHeatmapData', () => {
    it('returns empty daily arrays when no entries', () => {
      const hm = svc.buildHeatmapData([]);
      expect(hm.daily.length).to.equal(90);
      expect(hm.daily.every(d => d.tokensTotal === 0)).to.be.true;
    });

    it('aggregates daily totals', () => {
      const now = Date.now();
      const entries: UsageEntry[] = [
        makeEntry(now - 1 * 24 * 3600 * 1000, { inputOther: 1000, output: 500 }),
        makeEntry(now - 1 * 24 * 3600 * 1000, { inputOther: 2000, output: 1000 }),
      ];
      const hm = svc.buildHeatmapData(entries);
      const day = hm.daily.find(d => d.date === formatDateLocal(now - 1 * 24 * 3600 * 1000));
      expect(day).to.exist;
      expect(day!.sessionCount).to.equal(2);
      expect(day!.tokensTotal).to.equal(4800);
    });

    it('excludes synthetic entries from heatmap model data', () => {
      const now = Date.now();
      const entries: UsageEntry[] = [
        makeEntry(now - 3600 * 1000, { model: '<synthetic>', inputOther: 10_000, output: 10_000, cost: 50 }),
        makeEntry(now - 3600 * 1000, { model: 'claude-sonnet-4', inputOther: 1000, output: 500, cost: 1 }),
      ];
      const hm = svc.buildHeatmapData(entries);
      const row = hm.dailyByModel.find(d => Object.keys(d.byModel).length > 0);
      expect(row).to.exist;
      expect(row!.byModel).to.not.have.property('<synthetic>');
      expect(row!.byModel).to.have.property('claude-sonnet-4');
    });
  });

  describe('buildCostCurveOptions', () => {
    it('generates 5h and 7d options', () => {
      const opts = svc.buildCostCurveOptions([]);
      expect(opts.options5h.length).to.be.greaterThan(0);
      expect(opts.options7d.length).to.be.greaterThan(0);
      expect(opts.options5h[0].endMs - opts.options5h[0].startMs).to.equal(5 * 3600 * 1000);
      expect(opts.options7d[0].endMs - opts.options7d[0].startMs).to.equal(7 * 24 * 3600 * 1000);
    });

    it('uses the same supplied starts as aggregates and heatmap', () => {
      const now = Date.now();
      const window5hStartMs = now - 2 * 3600 * 1000;
      const window7dStartMs = now - 2 * 24 * 3600 * 1000;
      const entries: UsageEntry[] = [
        makeEntry(window5hStartMs - 1000, { cost: 1 }),
        makeEntry(window5hStartMs + 1000, { cost: 2 }),
        makeEntry(window7dStartMs + 1000, { cost: 3 }),
      ];
      const agg = svc.buildDashboardAggregates(entries, {
        todayStartMs: now - 24 * 3600 * 1000,
        window5hStartMs,
        window7dStartMs,
        window30dStartMs: now - 30 * 24 * 3600 * 1000,
        monthStartMs: now - 30 * 24 * 3600 * 1000,
      });
      const heatmap = svc.buildHeatmapData(entries, { window5hStartMs, window7dStartMs });
      const opts = svc.buildCostCurveOptions(entries, { window5hStartMs, window7dStartMs });

      expect(agg.window5h!.messageCount).to.equal(1);
      expect(agg.window7d!.messageCount).to.equal(3);
      expect(heatmap.cycles5hByModel[heatmap.cycles5hByModel.length - 1].costTotal).to.equal(2);
      expect(heatmap.cycles7dByModel[heatmap.cycles7dByModel.length - 1].costTotal).to.equal(6);
      expect(opts.current5hStartMs).to.equal(window5hStartMs);
      expect(opts.current7dStartMs).to.equal(window7dStartMs);
    });
  });

  describe('buildCostCurve', () => {
    it('returns start and end points for empty range', () => {
      const now = Date.now();
      const pts = svc.buildCostCurve([], '5h', now - 3600 * 1000, now);
      expect(pts.length).to.be.at.least(2);
      expect(pts[0].cumulativeRmb).to.equal(0);
    });

    it('accumulates cost in order', () => {
      const base = Date.now() - 3600 * 1000;
      const entries: UsageEntry[] = [
        makeEntry(base + 10 * 60 * 1000, { cost: 1.0 }),
        makeEntry(base + 20 * 60 * 1000, { cost: 2.0 }),
        makeEntry(base + 30 * 60 * 1000, { cost: 3.0 }),
      ];
      const pts = svc.buildCostCurve(entries, '5h', base, base + 3600 * 1000);
      const samples = pts.filter(p => p.sample);
      expect(samples.length).to.be.at.least(3);
      const lastSample = samples[samples.length - 1];
      expect(lastSample.cumulativeRmb).to.be.closeTo(6.0, 0.01);
    });

    it('excludes synthetic entries from cost curves', () => {
      const base = Date.now() - 3600 * 1000;
      const entries: UsageEntry[] = [
        makeEntry(base + 10 * 60 * 1000, { model: '<synthetic>', cost: 100 }),
        makeEntry(base + 20 * 60 * 1000, { model: 'claude-haiku', cost: 2 }),
      ];
      const pts = svc.buildCostCurve(entries, '5h', base, base + 3600 * 1000);
      const samples = pts.filter(p => p.sample);
      expect(samples.length).to.equal(1);
      expect(samples[0].cumulativeRmb).to.equal(2);
    });
  });

  describe('aggregateHourlyForDate', () => {
    it('aggregates by hour for a specific date', () => {
      const d = new Date('2026-05-13T10:30:00').getTime();
      const entries: UsageEntry[] = [
        makeEntry(d),
        makeEntry(d + 20 * 60 * 1000), // same hour 10:50
        makeEntry(d + 2 * 3600 * 1000), // hour 12
      ];
      const rows = svc.aggregateHourlyForDate(entries, '2026-05-13');
      expect(rows.length).to.equal(2);
      expect(rows[0].hour).to.equal('10:00');
      expect(rows[1].hour).to.equal('12:00');
    });
  });

  describe('aggregateDailyForMonth', () => {
    it('aggregates by day for a specific month', () => {
      const entries: UsageEntry[] = [
        makeEntry(new Date('2026-05-10T12:00:00').getTime()),
        makeEntry(new Date('2026-05-11T12:00:00').getTime()),
        makeEntry(new Date('2026-05-11T14:00:00').getTime()),
      ];
      const rows = svc.aggregateDailyForMonth(entries, '2026-05-01');
      expect(rows.length).to.equal(2);
      expect(rows[0].date).to.equal('2026-05-10');
      expect(rows[1].date).to.equal('2026-05-11');
      expect(rows[1].data.messageCount).to.equal(2);
    });
  });
});
