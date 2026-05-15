// DESIGN: v2-phase3-implementation.md#serviceshistoryservicets
// AGENTS: pure-fn | no-disk-IO | fmt->calc.ts
import { UsageEntry } from '../types';
import {
  DashboardAggregates,
  DashboardUsageData,
  DailyBreakdownRow,
  HourlyBreakdownRow,
  HeatmapData,
  DailyUsage,
  DailyModelBreakdown,
  CostCurveOptions,
  CostCurvePoint,
  CostCurveOptionItem,
} from '../types';
import {
  buildDailyBuckets,
  buildHourlyBuckets,
  formatDateLocal,
  formatMonthLocal,
} from '../calc';

function emptyUsage(): DashboardUsageData {
  return {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCost: 0,
    messageCount: 0,
    modelBreakdown: {},
  };
}

function isSyntheticEntry(entry: UsageEntry): boolean {
  return (entry.model ?? '').trim().toLowerCase() === '<synthetic>';
}

function visibleEntries(entries: UsageEntry[]): UsageEntry[] {
  return entries.filter((entry) => !isSyntheticEntry(entry));
}

function modelRank(model: string): number {
  const m = model.toLowerCase();
  if (m.includes('haiku')) { return 0; }
  if (m.includes('sonnet')) { return 1; }
  if (m.includes('opus')) { return 2; }
  return 10;
}

function compareModelNames(a: string, b: string): number {
  const rankDiff = modelRank(a) - modelRank(b);
  if (rankDiff !== 0) { return rankDiff; }
  return a.localeCompare(b);
}

function orderModelBreakdown(data: DashboardUsageData | null): DashboardUsageData | null {
  if (!data) { return data; }
  data.modelBreakdown = Object.fromEntries(
    Object.entries(data.modelBreakdown).sort(([a], [b]) => compareModelNames(a, b)),
  );
  return data;
}

function orderDailyModelBreakdown(row: DailyModelBreakdown): DailyModelBreakdown {
  row.byModel = Object.fromEntries(
    Object.entries(row.byModel).sort(([a], [b]) => compareModelNames(a, b)),
  );
  return row;
}

function addRecord(agg: DashboardUsageData, entry: UsageEntry, defaultModelName?: string): void {
  agg.totalInputTokens += entry.inputOther;
  agg.totalOutputTokens += entry.output;
  agg.totalCacheCreationTokens += entry.inputCacheCreation;
  agg.totalCacheReadTokens += entry.inputCacheRead;
  agg.totalCost += entry.cost;
  agg.messageCount += 1;

  const model = entry.model || defaultModelName || 'unknown';
  const m = agg.modelBreakdown[model] ?? {
    inputTokens: 0,
    outputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    cost: 0,
    count: 0,
  };
  m.inputTokens += entry.inputOther;
  m.outputTokens += entry.output;
  m.cacheCreationTokens += entry.inputCacheCreation;
  m.cacheReadTokens += entry.inputCacheRead;
  m.cost += entry.cost;
  m.count += 1;
  agg.modelBreakdown[model] = m;
}

function toDayKey(ts: number): string {
  return formatDateLocal(ts);
}

function toMonthKey(ts: number): string {
  return formatMonthLocal(ts) + '-01';
}

function hourKey(ts: number): string {
  return String(new Date(ts).getHours()).padStart(2, '0') + ':00';
}

function startOfLocalDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export class HistoryService {
  private static instance: HistoryService;

  static getInstance(): HistoryService {
    if (!HistoryService.instance) { HistoryService.instance = new HistoryService(); }
    return HistoryService.instance;
  }

  buildDashboardAggregates(
    entries: UsageEntry[],
    opts: {
      todayStartMs: number;
      window5hStartMs: number;
      window7dStartMs: number;
      window30dStartMs: number;
      monthStartMs: number;
      defaultModelName?: string;
    },
  ): DashboardAggregates {
    entries = visibleEntries(entries);
    const today = emptyUsage();
    const thisMonth = emptyUsage();
    const allTime = emptyUsage();
    const window5h = emptyUsage();
    const window7d = emptyUsage();
    const window30d = emptyUsage();
    const byDayThisMonth = new Map<string, DashboardUsageData>();
    const byMonthAllTime = new Map<string, DashboardUsageData>();
    const byHourToday = new Map<string, DashboardUsageData>();

    let minTs: number | null = null;
    let maxTs: number | null = null;

    const fallbackModel = opts.defaultModelName || 'unknown';
    for (const e of entries) {
      addRecord(allTime, e, fallbackModel);
      const monthKey = toMonthKey(e.timestamp);
      if (!byMonthAllTime.has(monthKey)) { byMonthAllTime.set(monthKey, emptyUsage()); }
      addRecord(byMonthAllTime.get(monthKey)!, e, fallbackModel);

      if (e.timestamp >= opts.monthStartMs) {
        addRecord(thisMonth, e, fallbackModel);
        const dayKey = toDayKey(e.timestamp);
        if (!byDayThisMonth.has(dayKey)) { byDayThisMonth.set(dayKey, emptyUsage()); }
        addRecord(byDayThisMonth.get(dayKey)!, e, fallbackModel);
      }
      if (e.timestamp >= opts.todayStartMs) {
        addRecord(today, e, fallbackModel);
        const h = hourKey(e.timestamp);
        if (!byHourToday.has(h)) { byHourToday.set(h, emptyUsage()); }
        addRecord(byHourToday.get(h)!, e, fallbackModel);
      }
      if (e.timestamp >= opts.window5hStartMs) {
        addRecord(window5h, e, fallbackModel);
      }
      if (e.timestamp >= opts.window7dStartMs) {
        addRecord(window7d, e, fallbackModel);
      }
      if (e.timestamp >= opts.window30dStartMs) {
        addRecord(window30d, e, fallbackModel);
      }

      minTs = minTs === null ? e.timestamp : Math.min(minTs, e.timestamp);
      maxTs = maxTs === null ? e.timestamp : Math.max(maxTs, e.timestamp);
    }

    const hasAny = entries.length > 0;
    const dailyForThisMonth = Array.from(byDayThisMonth.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({ date, data }));

    const monthlyForAllTime = Array.from(byMonthAllTime.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({ date, data }));

    const hourlyForToday = Array.from(byHourToday.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, data]) => ({ hour, data }));

    return {
      today: hasAny ? orderModelBreakdown(today) : null,
      thisMonth: hasAny ? orderModelBreakdown(thisMonth) : null,
      allTime: hasAny ? orderModelBreakdown(allTime) : null,
      window5h: hasAny ? orderModelBreakdown(window5h) : null,
      window7d: hasAny ? orderModelBreakdown(window7d) : null,
      window30d: hasAny ? orderModelBreakdown(window30d) : null,
      hourlyForToday,
      dailyForThisMonth,
      monthlyForAllTime,
      allTimeStart: minTs === null ? null : toDayKey(minTs),
      allTimeEnd: maxTs === null ? null : toDayKey(maxTs),
    };
  }

  buildHeatmapData(
    entries: UsageEntry[],
    opts?: {
      window5hStartMs?: number;
      window7dStartMs?: number;
      defaultModelName?: string;
    },
  ): HeatmapData {
    const nowMs = Date.now();
    const days = 90;
    const cutoff = nowMs - days * 24 * 3600 * 1000;
    const relevant = visibleEntries(entries).filter(e => e.timestamp >= cutoff);

    const fallbackModel = opts?.defaultModelName || 'unknown';
    const daily = this.aggregateByDay(relevant, days);
    const dailyByModel = this.aggregateDailyByModel(relevant, 30, fallbackModel);
    const start5h = typeof opts?.window5hStartMs === 'number' ? opts.window5hStartMs : (nowMs - 5 * 3600 * 1000);
    const start7d = typeof opts?.window7dStartMs === 'number' ? opts.window7dStartMs : startOfLocalDay(nowMs - 6 * 24 * 3600 * 1000);

    return {
      daily,
      dailyByModel,
      cycles5hByModel: this.aggregateCyclesByModel(relevant, 5 * 3600 * 1000, 30, nowMs, start5h, '5h', fallbackModel),
      cycles7dByModel: this.aggregateCyclesByModel(relevant, 7 * 24 * 3600 * 1000, 30, nowMs, start7d, 'day', fallbackModel),
      cycles30dByModel: this.aggregateCyclesByModel(
        relevant,
        30 * 24 * 3600 * 1000,
        12,
        nowMs,
        startOfLocalDay(nowMs - 29 * 24 * 3600 * 1000),
        'day',
        fallbackModel,
      ),
      generatedAt: nowMs,
    };
  }

  private aggregateByDay(entries: UsageEntry[], days: number): DailyUsage[] {
    const byDate = new Map<string, DailyUsage>();
    for (const e of entries) {
      const key = toDayKey(e.timestamp);
      const d = byDate.get(key) ?? { date: key, cost: 0, sessionCount: 0, tokensTotal: 0 };
      d.cost += e.cost;
      d.tokensTotal += e.inputOther + e.output + e.inputCacheRead + e.inputCacheCreation;
      d.sessionCount++;
      byDate.set(key, d);
    }

    const result: DailyUsage[] = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const key = toDayKey(now - i * 24 * 3600 * 1000);
      result.push(byDate.get(key) ?? { date: key, cost: 0, sessionCount: 0, tokensTotal: 0 });
    }
    return result;
  }

  private aggregateDailyByModel(entries: UsageEntry[], days: number, defaultModelName?: string): DailyModelBreakdown[] {
    const cutoff = Date.now() - days * 24 * 3600 * 1000;
    const byDate = new Map<string, DailyModelBreakdown>();

    for (const e of entries) {
      if (e.timestamp < cutoff) { continue; }
      const key = toDayKey(e.timestamp);
      const row = byDate.get(key) ?? {
        date: key,
        tokensTotal: 0,
        costTotal: 0,
        byModel: {},
      };
      const tokens = e.inputOther + e.output + e.inputCacheRead + e.inputCacheCreation;
      row.tokensTotal += tokens;
      row.costTotal += e.cost;
      const model = e.model || defaultModelName || 'unknown';
      const prev = row.byModel[model] ?? { tokens: 0, cost: 0 };
      prev.tokens += tokens;
      prev.cost += e.cost;
      row.byModel[model] = prev;
      byDate.set(key, row);
    }

    const result: DailyModelBreakdown[] = [];
    const now = Date.now();
    for (let i = days - 1; i >= 0; i--) {
      const key = toDayKey(now - i * 24 * 3600 * 1000);
      result.push(
        orderDailyModelBreakdown(byDate.get(key) ?? {
          date: key,
          tokensTotal: 0,
          costTotal: 0,
          byModel: {},
        }),
      );
    }
    return result;
  }

  private aggregateCyclesByModel(
    entries: UsageEntry[],
    cycleMs: number,
    cycles: number,
    nowMs: number,
    currentStartMs: number,
    labelMode: 'day' | '5h',
    defaultModelName?: string,
  ): DailyModelBreakdown[] {
    const firstStart = currentStartMs - (cycles - 1) * cycleMs;

    const buckets: DailyModelBreakdown[] = Array.from({ length: cycles }, (_, i) => {
      const start = firstStart + i * cycleMs;
      const date = labelMode === '5h' ? this.toLocal5hLabel(start) : toDayKey(start);
      return {
        date,
        tokensTotal: 0,
        costTotal: 0,
        byModel: {},
      };
    });

    for (const e of entries) {
      if (e.timestamp < firstStart || e.timestamp >= nowMs) { continue; }
      const idx = Math.floor((e.timestamp - firstStart) / cycleMs);
      if (idx < 0 || idx >= cycles) { continue; }
      const row = buckets[idx];
      const tokens = e.inputOther + e.output + e.inputCacheRead + e.inputCacheCreation;
      row.tokensTotal += tokens;
      row.costTotal += e.cost;
      const model = e.model || defaultModelName || 'unknown';
      const prev = row.byModel[model] ?? { tokens: 0, cost: 0 };
      prev.tokens += tokens;
      prev.cost += e.cost;
      row.byModel[model] = prev;
    }

    return buckets.map(orderDailyModelBreakdown);
  }

  private toLocal5hLabel(ts: number): string {
    const d = new Date(ts);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:00`;
  }

  buildCostCurveOptions(
    entries: UsageEntry[],
    windowStarts?: { window5hStartMs?: number; window7dStartMs?: number },
  ): CostCurveOptions {
    const nowMs = Date.now();
    const start5h = typeof windowStarts?.window5hStartMs === 'number' ? windowStarts.window5hStartMs : (nowMs - 5 * 3600 * 1000);
    const start7d = typeof windowStarts?.window7dStartMs === 'number' ? windowStarts.window7dStartMs : startOfLocalDay(nowMs - 6 * 24 * 3600 * 1000);

    function fmt5hLabel(ms: number): string {
      const d = new Date(ms);
      const m = d.getMonth() + 1;
      const day = d.getDate();
      const hh = String(d.getHours()).padStart(2, '0');
      return `${m}.${day}-${hh}`;
    }
    function fmt7dLabel(ms: number): string {
      const d = new Date(ms);
      const m = d.getMonth() + 1;
      const day = d.getDate();
      return `${m}.${day}`;
    }

    const options5h: CostCurveOptionItem[] = [];
    const max5h = 60;
    for (let i = 0; i < max5h; i++) {
      const s = start5h - i * 5 * 3600 * 1000;
      const e = s + 5 * 3600 * 1000;
      if (e <= 0) { break; }
      options5h.push({ label: fmt5hLabel(s), startMs: s, endMs: e });
    }

    const options7d: CostCurveOptionItem[] = [];
    const max7d = 26;
    for (let i = 0; i < max7d; i++) {
      const s = start7d - i * 7 * 24 * 3600 * 1000;
      const e = s + 7 * 24 * 3600 * 1000;
      if (e <= 0) { break; }
      options7d.push({ label: fmt7dLabel(s), startMs: s, endMs: e });
    }

    return {
      options5h,
      options7d,
      current5hStartMs: start5h,
      current7dStartMs: start7d,
    };
  }

  buildCostCurve(
    entries: UsageEntry[],
    window: '5h' | '7d',
    startMs: number,
    endMs: number,
    maxPoints = 2000,
  ): CostCurvePoint[] {
    entries = visibleEntries(entries);
    const now = Date.now();
    const cutoffMs = (startMs <= now && now < endMs) ? now : endMs;

    type Hit = { ts: number; cost: number };
    const hits: Hit[] = [];
    for (const e of entries) {
      if (e.timestamp < startMs || e.timestamp >= cutoffMs) { continue; }
      if (!isFinite(e.cost) || e.cost <= 0) { continue; }
      hits.push({ ts: e.timestamp, cost: e.cost });
    }
    hits.sort((a, b) => a.ts - b.ts);

    const points: CostCurvePoint[] = [];
    let cum = 0;
    points.push({ tMs: startMs, cumulativeRmb: 0, sample: false });

    if (window === '7d') {
      const windowMs = endMs - startMs;
      const targetBuckets = Math.max(1, maxPoints - 2);
      const rawBucketMs = Math.ceil(windowMs / targetBuckets);
      const bucketMs = Math.max(60 * 1000, Math.ceil(rawBucketMs / (60 * 1000)) * (60 * 1000));
      const buckets = new Map<number, number>();
      for (const h of hits) {
        const k = startMs + Math.floor((h.ts - startMs) / bucketMs) * bucketMs;
        buckets.set(k, (buckets.get(k) ?? 0) + h.cost);
      }
      for (let t = startMs; t < endMs; t += bucketMs) {
        const delta = buckets.get(t) ?? 0;
        if (t < cutoffMs) { cum += delta; }
        points.push({
          tMs: t,
          cumulativeRmb: t <= cutoffMs ? cum : null,
          sample: delta > 0 && t < cutoffMs,
        });
      }
      if (points.length === 0 || points[points.length - 1].tMs !== endMs) {
        points.push({
          tMs: endMs,
          cumulativeRmb: endMs <= cutoffMs ? cum : null,
          sample: false,
        });
      }
      return points;
    }

    // 5h window
    if (hits.length + 2 <= maxPoints) {
      for (const h of hits) {
        cum += h.cost;
        points.push({ tMs: h.ts, cumulativeRmb: cum, sample: true });
      }
      if (cutoffMs < endMs) {
        points.push({ tMs: cutoffMs, cumulativeRmb: cum, sample: false });
        points.push({ tMs: endMs, cumulativeRmb: null, sample: false });
      } else {
        points.push({ tMs: endMs, cumulativeRmb: cum, sample: false });
      }
      return points;
    }

    const windowMs = endMs - startMs;
    const targetBuckets = Math.max(1, maxPoints - 2);
    const rawBucketMs = Math.ceil(windowMs / targetBuckets);
    const bucketMs = Math.max(1_000, Math.ceil(rawBucketMs / 1_000) * 1_000);
    const buckets = new Map<number, number>();
    for (const h of hits) {
      const k = startMs + Math.floor((h.ts - startMs) / bucketMs) * bucketMs;
      buckets.set(k, (buckets.get(k) ?? 0) + h.cost);
    }
    for (let t = startMs; t < endMs; t += bucketMs) {
      const delta = buckets.get(t) ?? 0;
      if (t < cutoffMs) { cum += delta; }
      points.push({
        tMs: t,
        cumulativeRmb: t <= cutoffMs ? cum : null,
        sample: delta > 0 && t < cutoffMs,
      });
    }
    points.push({
      tMs: endMs,
      cumulativeRmb: endMs <= cutoffMs ? cum : null,
      sample: false,
    });
    return points;
  }

  aggregateHourlyForDate(entries: UsageEntry[], dateKey: string): HourlyBreakdownRow[] {
    entries = visibleEntries(entries);
    const byHour = new Map<string, DashboardUsageData>();
    for (const e of entries) {
      if (toDayKey(e.timestamp) !== dateKey) { continue; }
      const h = hourKey(e.timestamp);
      if (!byHour.has(h)) { byHour.set(h, emptyUsage()); }
      addRecord(byHour.get(h)!, e);
    }
    return Array.from(byHour.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([hour, data]) => ({ hour, data: orderModelBreakdown(data)! }));
  }

  aggregateDailyForMonth(entries: UsageEntry[], monthKey: string): DailyBreakdownRow[] {
    entries = visibleEntries(entries);
    const byDay = new Map<string, DashboardUsageData>();
    for (const e of entries) {
      if (toMonthKey(e.timestamp) !== monthKey) { continue; }
      const d = toDayKey(e.timestamp);
      if (!byDay.has(d)) { byDay.set(d, emptyUsage()); }
      addRecord(byDay.get(d)!, e);
    }
    return Array.from(byDay.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, data]) => ({ date, data: orderModelBreakdown(data)! }));
  }
}
