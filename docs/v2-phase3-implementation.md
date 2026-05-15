# AI Status Hub v2 Phase 3 详细实现文档

> 版本：v2.0.0-draft  
> 日期：2026-05-12  
> 前置文档：
> - `v2-rebuild-design.md` — 整体架构
> - `v2-dashboard-design.md` — 仪表盘详细设计
> - `v2-local-estimation-design.md` — 本地估算设计
> - `v2-provider-abstraction.md` — Provider 抽象设计
> - `v2-phase1-implementation.md` — Phase 1 实现
> - `v2-phase2-implementation.md` — Phase 2 实现（本地估算）
> **本文档目标**：AI 加载后可直接按此文档开发全部源代码，无需额外提示词。

---

## 1. Phase 3 范围

| 模块 | 功能 | 优先级 | 说明 |
|---|---|---|---|
| **成本计算** | 基于 token 用量 x 定价计算 RMB 费用 | P0 | `calc.ts` 已有基础，需集成到 Dashboard UI |
| **费用变化曲线** | 5h + 7d 成本曲线图 | P0 | Canvas/Chart.js 折线图，含时间选择器 |
| **热力图** | Token 用量热力图 + 费用热力图 | P0 | 90 天日历网格，蓝到红色温 |
| **趋势图** | 按日 Token 柱状图 + 按日费用柱状图 | P0 | 近 30 天，k2.6 / 总计 并列 |
| **预算告警** | 可设置 `weeklyBudget`，超限时告警 | P1 | 状态栏/仪表盘显示告警 |
| **模型明细** | 多模型使用量明细 | P1 | 预留架构，当前仅 k2.6 |
| **Session 监控** | 文件系统监听器，实时检测新会话 | P2 | 可选，默认关闭 |

**P0 = 必须，P1 = 重要，P2 = 可选**

---

## 2. 文件结构变化

相对于 Phase 2 的新增/修改文件：

```
src/
├── types.ts                          # 修改：新增 Dashboard 数据接口
├── calc.ts                           # 修改：新增历史数据聚合辅助函数
├── store.ts                          # 修改：新增 Action 类型
├── config.ts                         # 修改：新增预算/sessionMonitor 配置
├── extension.ts                      # 修改：注册新命令、初始化 SessionMonitor
├── services/
│   ├── localUsageService.ts          # 修改：增量扫描、暴露 entries
│   ├── scheduler.ts                  # 修改：预算告警检查
│   └── historyService.ts             # 新增：热力图/趋势图/成本曲线数据聚合
└── presenters/
    ├── statusBar.ts                  # 修改：预算告警指示器
    └── dashboard.ts                  # 大幅扩展：新增 4 个卡片 + Chart.js
```

---

## 3. types.ts 扩展

在现有 `types.ts` 末尾追加以下接口和类型（不修改已有接口，保持向后兼容）：

```typescript
// ============================================================================
// Phase 3: Dashboard Data Types
// ============================================================================

export interface DashboardMessage {
  usage: KimiUsageData;
  dashboard: DashboardAggregates | null;
  heatmap: HeatmapData | null;
  costCurveOptions: CostCurveOptions | null;
  pricing: TokenPricing;
  modelPricing: Record<string, TokenPricing>;
  settings: DashboardSettings;
}

export interface KimiUsageData {
  // API 数据
  utilization5h: number;
  utilization7d: number;
  resetIn5h: number;
  resetIn7d: number;
  limitStatus: 'allowed' | 'allowed_warning' | 'denied';
  has7dLimit: boolean;
  providerType: 'kimi-ai' | 'api-key';

  // 本地 JSONL 聚合
  cost5h: number;
  costDay: number;
  cost7d: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  tokensInDay: number;
  tokensOutDay: number;
  tokensCacheReadDay: number;
  tokensCacheCreateDay: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;

  // 元数据
  lastUpdated: number;
  cacheAge: number;
  dataSource: DataSource;
}

export interface DashboardUsageData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  messageCount: number;
  modelBreakdown: Record<string, ModelBreakdownEntry>;
}

export interface ModelBreakdownEntry {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  count: number;
}

export interface DashboardAggregates {
  today: DashboardUsageData | null;
  thisMonth: DashboardUsageData | null;
  allTime: DashboardUsageData | null;
  window5h: DashboardUsageData | null;
  window7d: DashboardUsageData | null;
  window30d: DashboardUsageData | null;
  hourlyForToday: HourlyBreakdownRow[];
  dailyForThisMonth: DailyBreakdownRow[];
  monthlyForAllTime: DailyBreakdownRow[]; // date 为 YYYY-MM-01
  allTimeStart: string | null;
  allTimeEnd: string | null;
}

export interface DailyBreakdownRow {
  date: string; // YYYY-MM-DD
  data: DashboardUsageData;
}

export interface HourlyBreakdownRow {
  hour: string; // "00:00".."23:00"
  data: DashboardUsageData;
}

export interface HeatmapData {
  daily: DailyUsage[];
  dailyByModel: DailyModelBreakdown[];
  cycles5hByModel: DailyModelBreakdown[];
  cycles7dByModel: DailyModelBreakdown[];
  cycles30dByModel: DailyModelBreakdown[];
  generatedAt: number;
}

export interface DailyUsage {
  date: string;      // YYYY-MM-DD local time
  cost: number;      // RMB
  sessionCount: number;
  tokensTotal: number;
}

export interface DailyModelBreakdown {
  date: string;
  tokensTotal: number;
  costTotal: number;
  tokensK26?: number;
  costK26?: number;
  tokensLite?: number;
  costLite?: number;
}

export interface CostCurveOptions {
  options5h: CostCurveOptionItem[];
  options7d: CostCurveOptionItem[];
  current5hStartMs: number;
  current7dStartMs: number;
}

export interface CostCurveOptionItem {
  label: string;
  startMs: number;
  endMs: number;
}

export interface CostCurvePoint {
  tMs: number;
  cumulativeRmb: number | null;
  sample?: boolean;
}

export interface DashboardSettings {
  provider: string;
  apiEnabled: boolean;
  cacheTtlSeconds: number;
  weeklyBudget: number | null;
  chartHeightRatio: number;
}

// ============================================================================
// Phase 3: Store Action Extensions
// ============================================================================

export type Action =
  // ... existing actions from Phase 1/2 ...
  | { type: 'DASHBOARD_DATA'; payload: DashboardMessage }
  | { type: 'HEATMAP_DATA'; payload: HeatmapData }
  | { type: 'COST_CURVE_DATA'; payload: { window: '5h' | '7d'; startMs: number; endMs: number; points: CostCurvePoint[] } }
  | { type: 'BUDGET_SET'; payload: number | null }
  | { type: 'BUDGET_ALERT'; payload: { exceeded: boolean; current: number; budget: number } }
  | { type: 'HOURLY_DATA'; payload: { date: string; data: HourlyBreakdownRow[] } }
  | { type: 'DAILY_DATA'; payload: { month: string; data: DailyBreakdownRow[] } };
```

---

## 4. calc.ts 扩展

在 `calc.ts` 末尾追加以下辅助函数：

```typescript
// ============================================================================
// Phase 3: History Aggregation Helpers
// ============================================================================

export interface TimeBucket {
  key: string;
  startMs: number;
  endMs: number;
}

/** Build daily buckets for a date range [startMs, endMs]. */
export function buildDailyBuckets(startMs: number, endMs: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= endMs) {
    const dayStart = d.getTime();
    const dayEnd = dayStart + 24 * 3600 * 1000 - 1;
    buckets.push({
      key: formatDateLocal(dayStart),
      startMs: dayStart,
      endMs: Math.min(dayEnd, endMs),
    });
    d.setDate(d.getDate() + 1);
  }
  return buckets;
}

/** Build hourly buckets for a single day (local time). */
export function buildHourlyBuckets(dayMs: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const d = new Date(dayMs);
  d.setHours(0, 0, 0, 0);
  for (let h = 0; h < 24; h++) {
    const hourStart = d.getTime() + h * 3600 * 1000;
    buckets.push({
      key: `${String(h).padStart(2, '0')}:00`,
      startMs: hourStart,
      endMs: hourStart + 3600 * 1000 - 1,
    });
  }
  return buckets;
}

/** Format a timestamp as YYYY-MM-DD in local time. */
export function formatDateLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a timestamp as YYYY-MM in local time. */
export function formatMonthLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Format currency with ¥ prefix and 2 decimals. */
export function fmtRmb(n: number): string {
  const safe = isFinite(n) ? n : 0;
  return '¥' + safe.toFixed(2);
}

/** Format large numbers with commas. */
export function fmtNumber(n: number): string {
  const safe = isFinite(n) ? Math.round(n) : 0;
  return safe.toLocaleString('en-US');
}

/** Format a timestamp for cost curve X-axis labels. */
export function fmtCostCurveTime(ms: number, window: '5h' | '7d'): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (window === '5h') {
    return `${hh}:${mm}:${ss}`;
  }
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${mo}.${day}-${hh}:${mm}`;
}

/** Heatmap color interpolation: blue (low) -> red (high). */
export function heatmapColor(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const c0 = [13, 71, 161];
  const c1 = [191, 54, 12];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  return `rgb(${r},${g},${b})`;
}
```

---

## 5. services/historyService.ts（新增）

新增文件，负责将 `UsageEntry[]` 聚合为 Dashboard 所需的多种粒度数据。

```typescript
import { UsageEntry } from './localUsageService';
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
  TokenPricing,
  CostCurveOptionItem,
} from '../types';
import {
  buildDailyBuckets,
  buildHourlyBuckets,
  formatDateLocal,
  formatMonthLocal,
} from '../calc';

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
    },
  ): DashboardAggregates {
    const todayEntries = entries.filter(e => e.timestamp >= opts.todayStartMs);
    const monthEntries = entries.filter(e => e.timestamp >= opts.monthStartMs);
    const win5hEntries = entries.filter(e => e.timestamp >= opts.window5hStartMs);
    const win7dEntries = entries.filter(e => e.timestamp >= opts.window7dStartMs);
    const win30dEntries = entries.filter(e => e.timestamp >= opts.window30dStartMs);

    const today = this.aggregateEntries(todayEntries);
    const thisMonth = this.aggregateEntries(monthEntries);
    const allTime = this.aggregateEntries(entries);
    const window5h = this.aggregateEntries(win5hEntries);
    const window7d = this.aggregateEntries(win7dEntries);
    const window30d = this.aggregateEntries(win30dEntries);

    const hourlyBuckets = buildHourlyBuckets(opts.todayStartMs);
    const hourlyForToday: HourlyBreakdownRow[] = hourlyBuckets.map(b => ({
      hour: b.key,
      data: this.aggregateEntries(entries.filter(e => e.timestamp >= b.startMs && e.timestamp <= b.endMs)),
    }));

    const dailyBuckets = buildDailyBuckets(opts.monthStartMs, Date.now());
    const dailyForThisMonth: DailyBreakdownRow[] = dailyBuckets.map(b => ({
      date: b.key,
      data: this.aggregateEntries(entries.filter(e => e.timestamp >= b.startMs && e.timestamp <= b.endMs)),
    }));

    const monthlyMap = new Map<string, UsageEntry[]>();
    for (const e of entries) {
      const mk = formatMonthLocal(e.timestamp) + '-01';
      if (!monthlyMap.has(mk)) monthlyMap.set(mk, []);
      monthlyMap.get(mk)!.push(e);
    }
    const monthlyForAllTime: DailyBreakdownRow[] = Array.from(monthlyMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, es]) => ({ date, data: this.aggregateEntries(es) }));

    return {
      today,
      thisMonth,
      allTime,
      window5h,
      window7d,
      window30d,
      hourlyForToday,
      dailyForThisMonth,
      monthlyForAllTime,
      allTimeStart: entries.length > 0 ? formatDateLocal(entries[0].timestamp) : null,
      allTimeEnd: entries.length > 0 ? formatDateLocal(entries[entries.length - 1].timestamp) : null,
    };
  }

  buildHeatmapData(entries: UsageEntry[]): HeatmapData {
    const now = Date.now();
    const startMs = now - 90 * 24 * 3600 * 1000;
    const relevant = entries.filter(e => e.timestamp >= startMs);

    const dailyMap = new Map<string, UsageEntry[]>();
    for (const e of relevant) {
      const dk = formatDateLocal(e.timestamp);
      if (!dailyMap.has(dk)) dailyMap.set(dk, []);
      dailyMap.get(dk)!.push(e);
    }

    const daily: DailyUsage[] = [];
    const d = new Date(startMs);
    d.setHours(0, 0, 0, 0);
    while (d.getTime() <= now) {
      const dk = formatDateLocal(d.getTime());
      const es = dailyMap.get(dk) || [];
      const agg = this.aggregateEntries(es);
      daily.push({
        date: dk,
        cost: agg.totalCost,
        sessionCount: agg.messageCount,
        tokensTotal: agg.totalInputTokens + agg.totalOutputTokens + agg.totalCacheCreationTokens + agg.totalCacheReadTokens,
      });
      d.setDate(d.getDate() + 1);
    }

    const dailyByModel: DailyModelBreakdown[] = daily.map(dd => ({
      date: dd.date,
      tokensTotal: dd.tokensTotal,
      costTotal: dd.cost,
      tokensK26: dd.tokensTotal,
      costK26: dd.cost,
    }));

    return {
      daily,
      dailyByModel,
      cycles5hByModel: dailyByModel,
      cycles7dByModel: dailyByModel,
      cycles30dByModel: dailyByModel,
      generatedAt: now,
    };
  }

  buildCostCurveOptions(entries: UsageEntry[]): CostCurveOptions {
    if (entries.length === 0) {
      return { options5h: [], options7d: [], current5hStartMs: 0, current7dStartMs: 0 };
    }

    const dayMap = new Map<string, UsageEntry[]>();
    for (const e of entries) {
      const dk = formatDateLocal(e.timestamp);
      if (!dayMap.has(dk)) dayMap.set(dk, []);
      dayMap.get(dk)!.push(e);
    }

    const options5h: CostCurveOptionItem[] = [];
    for (const [date, es] of dayMap) {
      for (let h = 0; h < 24; h++) {
        const hourEntries = es.filter(e => new Date(e.timestamp).getHours() === h);
        if (hourEntries.length === 0) continue;
        const startMs = new Date(date).setHours(h, 0, 0, 0);
        const endMs = startMs + 5 * 3600 * 1000;
        options5h.push({ label: `${date} ${String(h).padStart(2, '0')}:00`, startMs, endMs });
      }
    }
    options5h.sort((a, b) => a.startMs - b.startMs);

    const options7d: CostCurveOptionItem[] = [];
    const sortedDays = Array.from(dayMap.keys()).sort();
    for (let i = 0; i < sortedDays.length; i++) {
      const startMs = new Date(sortedDays[i]).setHours(0, 0, 0, 0);
      const endMs = startMs + 7 * 24 * 3600 * 1000;
      options7d.push({ label: `${sortedDays[i]} ~ ${formatDateLocal(endMs)}`, startMs, endMs });
    }

    const lastEntry = entries[entries.length - 1];
    return {
      options5h,
      options7d,
      current5hStartMs: lastEntry.timestamp - 5 * 3600 * 1000,
      current7dStartMs: lastEntry.timestamp - 7 * 24 * 3600 * 1000,
    };
  }

  buildCostCurve(entries: UsageEntry[], startMs: number, endMs: number): CostCurvePoint[] {
    const relevant = entries
      .filter(e => e.timestamp >= startMs && e.timestamp <= endMs)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (relevant.length === 0) return [];

    const points: CostCurvePoint[] = [];
    let cumulative = 0;
    for (const e of relevant) {
      cumulative += e.cost;
      points.push({ tMs: e.timestamp, cumulativeRmb: cumulative, sample: true });
    }

    if (points[0].tMs > startMs) {
      points.unshift({ tMs: startMs, cumulativeRmb: 0 });
    }

    return points;
  }

  private aggregateEntries(entries: UsageEntry[]): DashboardUsageData {
    const modelBreakdown: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cost: number; count: number }> = {};
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalCacheCreationTokens = 0;
    let totalCacheReadTokens = 0;
    let totalCost = 0;

    for (const e of entries) {
      totalInputTokens += e.inputOther;
      totalOutputTokens += e.output;
      totalCacheCreationTokens += e.inputCacheCreation;
      totalCacheReadTokens += e.inputCacheRead;
      totalCost += e.cost;

      const model = e.model || 'k2.6';
      if (!modelBreakdown[model]) {
        modelBreakdown[model] = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0, count: 0 };
      }
      modelBreakdown[model].inputTokens += e.inputOther;
      modelBreakdown[model].outputTokens += e.output;
      modelBreakdown[model].cacheCreationTokens += e.inputCacheCreation;
      modelBreakdown[model].cacheReadTokens += e.inputCacheRead;
      modelBreakdown[model].cost += e.cost;
      modelBreakdown[model].count += 1;
    }

    return {
      totalInputTokens,
      totalOutputTokens,
      totalCacheCreationTokens,
      totalCacheReadTokens,
      totalCost,
      messageCount: entries.length,
      modelBreakdown,
    };
  }
}
```

---

## 6. services/localUsageService.ts 扩展

### 6.1 添加 `getRawEntries`

在 `LocalUsageService` 类中添加：

```typescript
  async getRawEntries(): Promise<UsageEntry[]> {
    const usage = await this.getLocalUsage();
    return usage.entries;
  }

  async hasChangedSince(lastScanAt: number): Promise<boolean> {
    try {
      await fs.access(SESSIONS_DIR);
    } catch {
      return false;
    }

    const files = await this.enumerateWireJsonl(SESSIONS_DIR);
    for (const f of files) {
      try {
        const stat = await fs.stat(f);
        if (stat.mtimeMs > lastScanAt) {
          return true;
        }
      } catch { /* ignore */ }
    }
    return false;
  }
```

### 6.2 修改 `parseLine` 的 model 默认值

```typescript
        model: payload.model ?? 'k2.6',
```

---

## 7. services/scheduler.ts 扩展

### 7.1 修改 `doShortTick`

```typescript
  private async doShortTick(): Promise<void> {
    // ... existing logic ...

    this.store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: { weeklyPct, windowPct, cost7d: localUsage.cost7d },
    });

    this.checkBudget(localUsage.cost7d);
  }
```

### 7.2 修改 `doLongTick`

在 API 成功后添加预算检查：

```typescript
    if (result.ok && result.data) {
      // ... existing calibration and cache logic ...

      const localUsage = await this.localUsageService.getLocalUsage({
        weeklyResetAtMs: result.data.weeklyResetAt,
        windowResetAtMs: result.data.windowResetAt,
      });
      this.checkBudget(localUsage.cost7d);
    }
```

### 7.3 添加 `checkBudget`

```typescript
  private checkBudget(currentCost7d: number): void {
    const budget = this.config.weeklyBudget;
    if (!budget || budget <= 0) return;

    const exceeded = currentCost7d > budget;
    const state = this.store.getState();
    const wasExceeded = state.localEstimate?.cost7d && state.localEstimate.cost7d > budget;

    if (exceeded !== wasExceeded) {
      this.store.dispatch({
        type: 'BUDGET_ALERT',
        payload: { exceeded, current: currentCost7d, budget },
      });
    }
  }
```

---


  <script nonce="${nonce}">
    let chartJsLoaded = false;
    async function ensureChartJs() {
      if (chartJsLoaded) return;
      return new Promise((resolve, reject) => {
        const script = document.createElement("script");
        script.src = "https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js";
        script.onload = () => { chartJsLoaded = true; resolve(); };
        script.onerror = reject;
        document.head.appendChild(script);
      });
    }

    const vscode = acquireVsCodeApi();
    let currentData = null;
    let currentTabDetailed = "5h";
    let currentTabHistory = "daily";
    let chartInstances = {};
    let pendingCostCurve = null;

    function esc(str) {
      return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function post(type, payload = {}) {
      vscode.postMessage({ type, ...payload });
    }

    function fmtRmb(n) {
      return "¥" + (isFinite(n) ? n.toFixed(2) : "0.00");
    }

    function fmtNum(n) {
      return isFinite(n) ? Math.round(n).toLocaleString("en-US") : "0";
    }

    function fmtDateShort(iso) {
      const d = new Date(iso);
      return (d.getMonth() + 1) + "." + d.getDate();
    }

    function heatmapColor(t) {
      t = Math.max(0, Math.min(1, t));
      const c0 = [13, 71, 161];
      const c1 = [191, 54, 12];
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return "rgb(" + r + "," + g + "," + b + ")";
    }

    function toggleCard(id) {
      const card = document.getElementById(id);
      card.classList.toggle("collapsed");
      const btn = card.querySelector(".card-toggle");
      const isZh = document.documentElement.lang === "zh-CN";
      const collapsed = card.classList.contains("collapsed");
      btn.textContent = collapsed ? (isZh ? "▼ 展开" : "▼ Expand") : (isZh ? "▲ 收起" : "▲ Collapse");
    }

    document.getElementById("btn-refresh").addEventListener("click", () => {
      const btn = document.getElementById("btn-refresh");
      btn.disabled = true; btn.innerHTML = "<span class=\"spinning\">&#8635;</span>";
      post("refresh");
      setTimeout(() => { btn.disabled = false; btn.textContent = "Refresh"; }, 2000);
    });
    document.getElementById("btn-toggle").addEventListener("click", () => post("toggleMode"));
    document.getElementById("btn-lang").addEventListener("click", () => post("toggleLanguage"));
    document.getElementById("btn-settings").addEventListener("click", () => post("openSettings"));
    document.getElementById("btn-budget-save").addEventListener("click", () => {
      const val = parseFloat(document.getElementById("input-budget").value);
      post("setBudget", { amount: isNaN(val) || val <= 0 ? null : val });
    });
    document.getElementById("btn-budget-clear").addEventListener("click", () => {
      document.getElementById("input-budget").value = "";
      post("setBudget", { amount: null });
    });

    document.getElementById("tabs-detailed").addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab")) return;
      document.querySelectorAll("#tabs-detailed .tab").forEach(t => t.classList.remove("active"));
      e.target.classList.add("active");
      currentTabDetailed = e.target.dataset.tab;
      renderDetailedUsage();
    });
    document.getElementById("tabs-history").addEventListener("click", (e) => {
      if (!e.target.classList.contains("tab")) return;
      document.querySelectorAll("#tabs-history .tab").forEach(t => t.classList.remove("active"));
      e.target.classList.add("active");
      currentTabHistory = e.target.dataset.tab;
      renderHistory();
    });

    document.getElementById("sel-curve-5h").addEventListener("change", (e) => {
      const opt = e.target.options[e.target.selectedIndex];
      requestCostCurve("5h", parseInt(opt.dataset.start), parseInt(opt.dataset.end));
    });
    document.getElementById("sel-curve-7d").addEventListener("change", (e) => {
      const opt = e.target.options[e.target.selectedIndex];
      requestCostCurve("7d", parseInt(opt.dataset.start), parseInt(opt.dataset.end));
    });

    function requestCostCurve(window, startMs, endMs) {
      pendingCostCurve = { window, startMs, endMs };
      post("getCostCurve", { window, startMs, endMs });
    }

    window.addEventListener("message", (event) => {
      const msg = event.data;
      if (msg.type === "update") {
        currentData = msg.data;
        renderAll();
        return;
      }
      if (msg.type === "costCurve") {
        if (pendingCostCurve && pendingCostCurve.startMs === msg.startMs && pendingCostCurve.window === msg.window) {
          renderCostCurve(msg.window, msg.points);
          pendingCostCurve = null;
        }
        return;
      }
      if (msg.type === "hourlyDataResponse") {
        if (!currentData) return;
        if (!currentData._hourlyCache) currentData._hourlyCache = {};
        currentData._hourlyCache[msg.date] = msg.data;
        renderDetailedUsage();
        return;
      }
      if (msg.type === "dailyDataResponse") {
        if (!currentData) return;
        if (!currentData._dailyCache) currentData._dailyCache = {};
        currentData._dailyCache[msg.month] = msg.data;
        renderDetailedUsage();
        return;
      }
    });

    function renderAll() {
      if (!currentData) return;
      renderCurrentUsage();
      renderCostCurveOptions();
      renderPricing();
      renderDetailedUsage();
      renderHistory();
      renderBudget();
      renderModels();
      renderFooter();
    }

    function renderCurrentUsage() {
      const u = currentData.usage;
      const isEstimate = u.dataSource === "local-only" || u.dataSource === "stale";
      const w5h = Math.min(100, u.utilization5h || 0);
      const w7d = Math.min(100, u.utilization7d || 0);

      const fill5h = document.getElementById("fill-5h");
      fill5h.style.width = w5h + "%";
      fill5h.className = "progress-fill" + (w5h >= 75 ? " warning" : "") + (u.limitStatus === "denied" ? " error" : "");
      document.getElementById("lbl-5h").textContent = w5h.toFixed(1) + "%";
      document.getElementById("badge-5h").textContent = isEstimate ? " (estimate)" : "";

      const fill7d = document.getElementById("fill-7d");
      fill7d.style.width = w7d + "%";
      fill7d.className = "progress-fill" + (w7d >= 75 ? " warning" : "") + (u.limitStatus === "denied" ? " error" : "");
      document.getElementById("lbl-7d").textContent = w7d.toFixed(1) + "%";
      document.getElementById("badge-7d").textContent = isEstimate ? " (estimate)" : "";

      function fmtReset(totalSeconds) {
        if (totalSeconds <= 0) return "";
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        const pad2 = (n) => String(n).padStart(2, " ");
        if (days > 0) return "resets in " + pad2(days) + "d" + pad2(hours) + "h";
        if (hours > 0) return "resets in " + pad2(hours) + "h" + pad2(mins) + "m";
        if (mins > 0) return "resets in " + pad2(mins) + "m" + pad2(secs) + "s";
        return "resets in " + pad2(secs) + "s";
      }

      document.getElementById("meta-5h").textContent = fmtReset(u.resetIn5h);
      document.getElementById("meta-7d").textContent = fmtReset(u.resetIn7d);
    }

    function renderPricing() {
      const s = currentData.settings;
      const badge = document.getElementById("badge-api");
      if (s.apiEnabled) {
        badge.style.background = "#0e4429";
        badge.style.color = "#39d353";
        badge.textContent = "API enabled";
      } else {
        badge.style.background = "var(--vscode-inputValidation-warningBackground)";
        badge.style.color = "var(--vscode-editor-foreground)";
        badge.textContent = "API disabled";
      }
      document.getElementById("lbl-ttl").textContent = s.cacheTtlSeconds + "s";
    }

    function renderDetailedUsage() {
      const dash = currentData.dashboard;
      if (!dash) return;
      const tab = currentTabDetailed;
      let data = null;
      let tableData = null;
      let isHourly = false;

      switch (tab) {
        case "5h": data = dash.window5h; tableData = []; break;
        case "7d": data = dash.window7d; tableData = []; break;
        case "30d": data = dash.window30d; tableData = []; break;
        case "today": data = dash.today; tableData = dash.hourlyForToday; isHourly = true; break;
        case "month": data = dash.thisMonth; tableData = dash.dailyForThisMonth; break;
        case "all": data = dash.allTime; tableData = dash.monthlyForAllTime; break;
      }

      if (!data) data = { totalInputTokens:0, totalOutputTokens:0, totalCacheCreationTokens:0, totalCacheReadTokens:0, totalCost:0, messageCount:0, modelBreakdown:{} };

      const isZh = document.documentElement.lang === "zh-CN";
      const summaryHtml = [
        { label: isZh ? "费用" : "Cost", value: fmtRmb(data.totalCost) },
        { label: isZh ? "消息数" : "Messages", value: fmtNum(data.messageCount) },
        { label: "Input", value: fmtNum(data.totalInputTokens) },
        { label: "Output", value: fmtNum(data.totalOutputTokens) },
        { label: isZh ? "缓存写入" : "CacheW", value: fmtNum(data.totalCacheCreationTokens) },
        { label: isZh ? "缓存读取" : "CacheR", value: fmtNum(data.totalCacheReadTokens) },
      ].map(item => "<div class=\"summary-item\"><div class=\"label\">" + esc(item.label) + "</div><div class=\"value\">" + esc(item.value) + "</div></div>").join("");
      document.getElementById("summary-detailed").innerHTML = summaryHtml;

      const models = Object.entries(data.modelBreakdown).sort((a,b) => b[1].cost - a[1].cost);
      let modelsHtml = "";
      for (const [model, m] of models) {
        const pricing = currentData.modelPricing[model] || currentData.pricing;
        modelsHtml += "<div class=\"model-item\">" +
          "<div class=\"model-header\"><span>" + esc(model) + "</span><span>" + fmtRmb(m.cost) + "</span></div>" +
          "<div class=\"model-metrics\">" +
            "<div class=\"model-metric\"><div class=\"num\">" + fmtNum(m.inputTokens) + "</div><div class=\"price\">¥" + pricing.inputPerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">" + fmtNum(m.outputTokens) + "</div><div class=\"price\">¥" + pricing.outputPerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">" + fmtNum(m.cacheCreationTokens) + "</div><div class=\"price\">¥" + pricing.cacheCreatePerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">" + fmtNum(m.cacheReadTokens) + "</div><div class=\"price\">¥" + pricing.cacheReadPerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">" + fmtNum(m.count) + "</div><div class=\"price\">" + (isZh ? "消息" : "msgs") + "</div></div>" +
          "</div></div>";
      }
      document.getElementById("models-detailed").innerHTML = modelsHtml || "<div class=\"placeholder\">" + (isZh ? "无数据" : "No data") + "</div>";

      renderTable("table-detailed", tableData, isHourly);
    }

    function renderTable(containerId, rows, isHourly) {
      const container = document.getElementById(containerId);
      if (!rows || rows.length === 0) {
        container.innerHTML = "<div class=\"placeholder\">No data</div>";
        return;
      }
      const isZh = document.documentElement.lang === "zh-CN";
      let html = "<table class=\"data-table\"><thead><tr>" +
        "<th>" + (isHourly ? (isZh ? "小时" : "Hour") : (isZh ? "日期" : "Date")) + "</th>" +
        "<th>" + (isZh ? "费用" : "Cost") + "</th>" +
        "<th>Input</th><th>Output</th>" +
        "<th>CacheW</th><th>CacheR</th>" +
        "<th>" + (isZh ? "消息" : "Msgs") + "</th>" +
        "</tr></thead><tbody>";
      for (const row of rows) {
        const key = isHourly ? row.hour : row.date;
        const d = row.data;
        html += "<tr>" +
          "<td>" + esc(key) + "</td>" +
          "<td class=\"num\">" + fmtRmb(d.totalCost) + "</td>" +
          "<td class=\"num\">" + fmtNum(d.totalInputTokens) + "</td>" +
          "<td class=\"num\">" + fmtNum(d.totalOutputTokens) + "</td>" +
          "<td class=\"num\">" + fmtNum(d.totalCacheCreationTokens) + "</td>" +
          "<td class=\"num\">" + fmtNum(d.totalCacheReadTokens) + "</td>" +
          "<td class=\"num\">" + fmtNum(d.messageCount) + "</td>" +
          "</tr>";
      }
      html += "</tbody></table>";
      container.innerHTML = html;
    }

    function renderCostCurveOptions() {
      const opts = currentData.costCurveOptions;
      if (!opts) return;
      const sel5h = document.getElementById("sel-curve-5h");
      const sel7d = document.getElementById("sel-curve-7d");

      let html5h = "";
      for (const o of opts.options5h) {
        html5h += "<option value=\"" + o.startMs + "\" data-start=\"" + o.startMs + "\" data-end=\"" + o.endMs + "\">" + esc(o.label) + "</option>";
      }
      sel5h.innerHTML = html5h || "<option>No data</option>";

      let html7d = "";
      for (const o of opts.options7d) {
        html7d += "<option value=\"" + o.startMs + "\" data-start=\"" + o.startMs + "\" data-end=\"" + o.endMs + "\">" + esc(o.label) + "</option>";
      }
      sel7d.innerHTML = html7d || "<option>No data</option>";

      if (opts.options5h.length > 0) {
        const current5h = opts.options5h.find(o => o.startMs === opts.current5hStartMs) || opts.options5h[opts.options5h.length - 1];
        sel5h.value = String(current5h.startMs);
        requestCostCurve("5h", current5h.startMs, current5h.endMs);
      }
      if (opts.options7d.length > 0) {
        const current7d = opts.options7d.find(o => o.startMs === opts.current7dStartMs) || opts.options7d[opts.options7d.length - 1];
        sel7d.value = String(current7d.startMs);
        requestCostCurve("7d", current7d.startMs, current7d.endMs);
      }
    }

    async function renderCostCurve(window, points) {
      await ensureChartJs();
      const canvasId = "canvas-curve-" + window;
      const ctx = document.getElementById(canvasId).getContext("2d");
      if (chartInstances[canvasId]) chartInstances[canvasId].destroy();

      const color = window === "5h" ? "#00c853" : "#7c4dff";
      const labels = points.map(p => {
        const d = new Date(p.tMs);
        const hh = String(d.getHours()).padStart(2, "0");
        const mm = String(d.getMinutes()).padStart(2, "0");
        const ss = String(d.getSeconds()).padStart(2, "0");
        if (window === "5h") return hh + ":" + mm + ":" + ss;
        const mo = d.getMonth() + 1;
        const day = d.getDate();
        return mo + "." + day + "-" + hh + ":" + mm;
      });
      const data = points.map(p => p.cumulativeRmb);

      chartInstances[canvasId] = new Chart(ctx, {
        type: "line",
        data: {
          labels,
          datasets: [{
            label: "Cumulative Cost (¥)",
            data,
            borderColor: color,
            backgroundColor: color + "20",
            borderWidth: 2,
            tension: window === "5h" ? 0.05 : 0.35,
            pointRadius: 0,
            pointHoverRadius: 6,
            fill: false,
          }],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { display: false },
            tooltip: {
              callbacks: {
                title: (items) => new Date(points[items[0].dataIndex].tMs).toLocaleString(),
                label: (item) => "¥" + (isFinite(item.raw) ? item.raw.toFixed(4) : "0.0000"),
              },
            },
          },
          scales: {
            x: { ticks: { maxTicksLimit: 8, color: "var(--vscode-editor-foreground)" }, grid: { color: "var(--vscode-panel-border)" } },
            y: { ticks: { callback: (v) => "¥" + v, color: "var(--vscode-editor-foreground)" }, grid: { color: "var(--vscode-panel-border)" } },
          },
        },
      });
    }

    function renderHistory() {
      const heatmap = currentData.heatmap;
      if (!heatmap) return;
      const tab = currentTabHistory;
      let source = heatmap.daily;
      if (tab === "5h") source = heatmap.cycles5hByModel;
      else if (tab === "7d") source = heatmap.cycles7dByModel;
      else if (tab === "30d") source = heatmap.cycles30dByModel;

      renderHeatmapGrid("heatmap-tokens", source, "tokensTotal");
      renderHeatmapGrid("heatmap-cost", source, "costTotal");
      renderBarCharts(heatmap.daily);
    }

    function renderHeatmapGrid(containerId, source, field) {
      const container = document.getElementById(containerId);
      if (!source || source.length === 0) {
        container.innerHTML = "<div class=\"placeholder\">No data</div>";
        return;
      }
      const values = source.map(d => d[field] || 0);
      const maxVal = Math.max(...values);
      const minVal = Math.min(...values);
      const range = maxVal - minVal;

      let html = "";
      for (const d of source) {
        const val = d[field] || 0;
        const t = range > 0 ? (val - minVal) / range : 0;
        const color = maxVal === 0 && minVal === 0 ? "transparent" : heatmapColor(t);
        const tooltip = d.date + " | " + (field === "tokensTotal" ? fmtNum(val) + " tokens" : fmtRmb(val)) + " | " + fmtNum(d.sessionCount || 0) + " msgs";
        html += "<div class=\"heatmap-cell\" style=\"background:" + color + ";border:1px solid var(--vscode-panel-border);\" data-tooltip=\"" + esc(tooltip) + "\"></div>";
      }
      container.innerHTML = html;
    }

    async function renderBarCharts(daily) {
      await ensureChartJs();
      const last30 = daily.slice(-30);
      const labels = last30.map(d => fmtDateShort(d.date));

      const ctxTokens = document.getElementById("canvas-bar-tokens").getContext("2d");
      if (chartInstances["bar-tokens"]) chartInstances["bar-tokens"].destroy();
      chartInstances["bar-tokens"] = new Chart(ctxTokens, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "k2.6", data: last30.map(d => d.tokensTotal || 0), backgroundColor: "#7c4dff" },
            { label: "Total", data: last30.map(d => d.tokensTotal || 0), backgroundColor: "#ff9800" },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: { legend: { labels: { color: "var(--vscode-editor-foreground)" } } },
          scales: {
            x: { ticks: { color: "var(--vscode-editor-foreground)" }, grid: { color: "var(--vscode-panel-border)" } },
            y: { beginAtZero: true, ticks: { color: "var(--vscode-editor-foreground)" }, grid: { color: "var(--vscode-panel-border)" } },
          },
        },
      });

      const ctxCost = document.getElementById("canvas-bar-cost").getContext("2d");
      if (chartInstances["bar-cost"]) chartInstances["bar-cost"].destroy();
      chartInstances["bar-cost"] = new Chart(ctxCost, {
        type: "bar",
        data: {
          labels,
          datasets: [
            { label: "k2.6", data: last30.map(d => d.cost || 0), backgroundColor: "#7c4dff" },
            { label: "Total", data: last30.map(d => d.cost || 0), backgroundColor: "#ff9800" },
          ],
        },
        options: {
          responsive: true,
          maintainAspectRatio: false,
          plugins: {
            legend: { labels: { color: "var(--vscode-editor-foreground)" } },
            tooltip: { callbacks: { label: (item) => "¥" + (isFinite(item.raw) ? item.raw.toFixed(2) : "0.00") } },
          },
          scales: {
            x: { ticks: { color: "var(--vscode-editor-foreground)" }, grid: { color: "var(--vscode-panel-border)" } },
            y: { beginAtZero: true, ticks: { callback: (v) => "¥" + v, color: "var(--vscode-editor-foreground)" }, grid: { color: "var(--vscode-panel-border)" } },
          },
        },
      });
    }

    function renderBudget() {
      const s = currentData.settings;
      const u = currentData.usage;
      document.getElementById("input-budget").value = s.weeklyBudget || "";

      const container = document.getElementById("budget-alert-container");
      const status = document.getElementById("budget-status");
      const isZh = document.documentElement.lang === "zh-CN";

      if (!s.weeklyBudget || s.weeklyBudget <= 0) {
        container.innerHTML = "";
        status.innerHTML = "<span class=\"placeholder\">" + (isZh ? "未设置预算" : "No budget set") + "</span>";
        return;
      }

      const pct = (u.cost7d / s.weeklyBudget) * 100;
      status.innerHTML = (isZh ? "本周已用：" : "Week used: ") + fmtRmb(u.cost7d) + " / " + fmtRmb(s.weeklyBudget) + " (" + pct.toFixed(1) + "%)";

      if (u.cost7d > s.weeklyBudget) {
        container.innerHTML = "<div class=\"alert error\">&#9888; " + (isZh ? "预算超限！本周费用 " : "Budget exceeded! Week cost ") + fmtRmb(u.cost7d) + " > " + fmtRmb(s.weeklyBudget) + "</div>";
      } else if (pct >= 75) {
        container.innerHTML = "<div class=\"alert warning\">&#9888; " + (isZh ? "预算警告：已使用 " : "Budget warning: used ") + pct.toFixed(0) + "%</div>";
      } else {
        container.innerHTML = "";
      }
    }

    function renderModels() {
      const dash = currentData.dashboard;
      const container = document.getElementById("content-models");
      const isZh = document.documentElement.lang === "zh-CN";
      if (!dash || !dash.allTime) {
        container.innerHTML = "<div class=\"placeholder\">" + (isZh ? "无数据" : "No data") + "</div>";
        return;
      }

      const models = Object.entries(dash.allTime.modelBreakdown).sort((a,b) => b[1].cost - a[1].cost);
      let html = "";
      for (const [model, m] of models) {
        const pricing = currentData.modelPricing[model] || currentData.pricing;
        html += "<div class=\"model-item\">" +
          "<div class=\"model-header\"><span>" + esc(model) + "</span><span>" + fmtRmb(m.cost) + "</span></div>" +
          "<div class=\"model-metrics\">" +
            "<div class=\"model-metric\"><div class=\"num\">In: " + fmtNum(m.inputTokens) + "</div><div class=\"price\">¥" + pricing.inputPerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">Out: " + fmtNum(m.outputTokens) + "</div><div class=\"price\">¥" + pricing.outputPerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">CacheW: " + fmtNum(m.cacheCreationTokens) + "</div><div class=\"price\">¥" + pricing.cacheCreatePerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">CacheR: " + fmtNum(m.cacheReadTokens) + "</div><div class=\"price\">¥" + pricing.cacheReadPerMillion.toFixed(2) + "/M</div></div>" +
            "<div class=\"model-metric\"><div class=\"num\">Msgs: " + fmtNum(m.count) + "</div></div>" +
          "</div></div>";
      }
      container.innerHTML = html || "<div class=\"placeholder\">" + (isZh ? "无数据" : "No data") + "</div>";
    }

    function renderFooter() {
      const u = currentData.usage;
      const age = u.lastUpdated ? Math.max(0, Math.floor((Date.now() - u.lastUpdated) / 1000)) : 0;
      let ageStr;
      if (age < 60) ageStr = "just now";
      else if (age < 3600) ageStr = Math.floor(age / 60) + "m ago";
      else if (age < 86400) ageStr = Math.floor(age / 3600) + "h ago";
      else ageStr = Math.floor(age / 86400) + "d ago";

      const isZh = document.documentElement.lang === "zh-CN";
      const sourceLabels = { "api": "", "cache": isZh ? "（缓存）" : " (cache)", "stale": isZh ? "（过期）" : " (stale)", "local-only": isZh ? "（本地估算）" : " (local est.)", "no-credentials": isZh ? "（未登录）" : " (no auth)", "no-data": "" };
      const sourceLabel = sourceLabels[u.dataSource] || "";

      document.getElementById("footer-left").textContent = (isZh ? "最后更新：" : "Last updated: ") + ageStr + sourceLabel;
    }

    post("ready");
  </script>
</body>
</html>`;
    // End of getHtml template string
  }

  private sendUpdate(data: DashboardMessage): void {
    if (!this.panel.visible) return;
    this.panel.webview.postMessage({ type: "update", data });
  }
}

// Helper functions outside the DashboardPanel class
function aggregateEntries(entries: import("../services/localUsageService").UsageEntry[]): import("../types").DashboardUsageData {
  const modelBreakdown: Record<string, { inputTokens: number; outputTokens: number; cacheCreationTokens: number; cacheReadTokens: number; cost: number; count: number }> = {};
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCacheCreationTokens = 0;
  let totalCacheReadTokens = 0;
  let totalCost = 0;

  for (const e of entries) {
    totalInputTokens += e.inputOther;
    totalOutputTokens += e.output;
    totalCacheCreationTokens += e.inputCacheCreation;
    totalCacheReadTokens += e.inputCacheRead;
    totalCost += e.cost;
    const model = e.model || "k2.6";
    if (!modelBreakdown[model]) {
      modelBreakdown[model] = { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, cost: 0, count: 0 };
    }
    modelBreakdown[model].inputTokens += e.inputOther;
    modelBreakdown[model].outputTokens += e.output;
    modelBreakdown[model].cacheCreationTokens += e.inputCacheCreation;
    modelBreakdown[model].cacheReadTokens += e.inputCacheRead;
    modelBreakdown[model].cost += e.cost;
    modelBreakdown[model].count += 1;
  }

  return {
    totalInputTokens,
    totalOutputTokens,
    totalCacheCreationTokens,
    totalCacheReadTokens,
    totalCost,
    messageCount: entries.length,
    modelBreakdown,
  };
}

function buildHourlyBuckets(dayMs: number): import("../calc").TimeBucket[] {
  const buckets: import("../calc").TimeBucket[] = [];
  const d = new Date(dayMs);
  d.setHours(0, 0, 0, 0);
  for (let h = 0; h < 24; h++) {
    const hourStart = d.getTime() + h * 3600 * 1000;
    buckets.push({
      key: `${String(h).padStart(2, "0")}:00`,
      startMs: hourStart,
      endMs: hourStart + 3600 * 1000 - 1,
    });
  }
  return buckets;
}

function buildDailyBuckets(startMs: number, endMs: number): import("../calc").TimeBucket[] {
  const buckets: import("../calc").TimeBucket[] = [];
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= endMs) {
    const dayStart = d.getTime();
    const dayEnd = dayStart + 24 * 3600 * 1000 - 1;
    buckets.push({
      key: formatDateLocal(dayStart),
      startMs: dayStart,
      endMs: Math.min(dayEnd, endMs),
    });
    d.setDate(d.getDate() + 1);
  }
  return buckets;
}

function formatDateLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
```

---

## 9. presenters/statusBar.ts 扩展

### 9.1 扩展 `LocalEstimate` 类型

在 `types.ts` 中修改：

```typescript
export interface LocalEstimate {
  weeklyPct: number;
  windowPct: number;
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number | null;
  cost7d?: number; // Phase 3: for budget alert
}
```

### 9.2 修改 `doShortTick`

在 `scheduler.ts` 中：

```typescript
    this.store.dispatch({
      type: "LOCAL_ESTIMATE",
      payload: { weeklyPct, windowPct, cost7d: localUsage.cost7d },
    });
```

### 9.3 修改 `StatusBarPresenter.render`

在 `statusBar.ts` 中，预算超限時修改状态栏颜色：

```typescript
      // Budget alert
      const budget = this.config.weeklyBudget;
      if (budget && budget > 0 && state.localEstimate?.cost7d && state.localEstimate.cost7d > budget) {
        this.items.weekly.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
        this.items.weekly.text = `🌘 Kimi:${formatPercent(metrics.weeklyPct, 1)} ⚠`;
      }
```

---

## 10. store.ts 扩展

在 `reducer` 中添加新的 action 处理：

```typescript
    case "BUDGET_SET":
      return state;

    case "BUDGET_ALERT": {
      return {
        ...state,
        ui: {
          ...state.ui,
          budgetAlert: action.payload,
        },
      };
    }

    case "DASHBOARD_DATA":
      return state;

    case "HEATMAP_DATA":
      return state;

    case "COST_CURVE_DATA":
      return state;

    case "HOURLY_DATA":
      return state;

    case "DAILY_DATA":
      return state;
```

---

## 11. extension.ts 扩展

在 `activate` 函数中：

```typescript
  // Register budget command
  context.subscriptions.push(
    vscode.commands.registerCommand("aiStatusHub.setBudget", async () => {
      const value = await vscode.window.showInputBox({
        title: "AI Status Hub – Set Weekly Budget",
        prompt: "Enter weekly budget in RMB (¥). Leave empty to clear.",
        validateInput: (v) => {
          if (!v) return null;
          const n = parseFloat(v);
          if (isNaN(n) || n < 0) return "Please enter a valid number.";
          return null;
        },
      });
      const amount = value ? parseFloat(value) : null;
      await ConfigService.getInstance().setWeeklyBudget(amount);
      store.dispatch({ type: "BUDGET_SET", payload: amount });
    }),
  );

  // Session Monitor (optional, default off)
  const sessionMonitorEnabled = config.sessionMonitorEnabled;
  if (sessionMonitorEnabled) {
    const monitor = new SessionMonitor(localUsageService, () => {
      localUsageService.invalidate();
      scheduler.force();
    });
    monitor.start();
    context.subscriptions.push({ dispose: () => monitor.stop() });
  }
```

---

## 12. package.json 扩展

在 `contributes.configuration` 中添加：

```json
{
  "aiStatusHub.weeklyBudget": {
    "type": ["number", "null"],
    "default": null,
    "minimum": 0,
    "description": "Weekly budget in RMB. Null means no budget."
  },
  "aiStatusHub.chartHeightRatio": {
    "type": "number",
    "default": 0.4,
    "minimum": 0.1,
    "maximum": 1.0,
    "description": "Dashboard chart height ratio relative to width."
  },
  "aiStatusHub.sessionMonitorEnabled": {
    "type": "boolean",
    "default": false,
    "description": "Enable file system watcher for real-time session detection."
  }
}
```

在 `contributes.commands` 中添加：

```json
{
  "command": "aiStatusHub.setBudget",
  "title": "AI Status Hub: Set Weekly Budget",
  "icon": "$(warning)"
}
```

---

## 13. config.ts 扩展

在 `ConfigService` 中添加：

```typescript
  get weeklyBudget(): number | null {
    const v = this.cfg.get<number | null>("weeklyBudget", null);
    return v && v > 0 ? v : null;
  }

  async setWeeklyBudget(amount: number | null): Promise<void> {
    await this.cfg.update("weeklyBudget", amount, true);
  }

  get chartHeightRatio(): number {
    return Math.max(0.1, Math.min(1.0, this.cfg.get<number>("chartHeightRatio", 0.4)));
  }

  get sessionMonitorEnabled(): boolean {
    return this.cfg.get<boolean>("sessionMonitorEnabled", false);
  }
```

---

## 14. SessionMonitor（可选）

新建 `src/services/sessionMonitor.ts`：

```typescript
import * as fs from "fs/promises";
import * as path from "path";
import * as os from "os";
import { LocalUsageService } from "./localUsageService";

const SESSIONS_DIR = path.join(os.homedir(), ".kimi", "sessions");

export class SessionMonitor {
  private watcher: fs.FSWatcher | null = null;
  private running = false;

  constructor(
    private localUsageService: LocalUsageService,
    private onChange: () => void,
  ) {}

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await fs.access(SESSIONS_DIR);
      this.watcher = fs.watch(SESSIONS_DIR, { recursive: true }, (eventType, filename) => {
        if (filename && filename.endsWith("wire.jsonl")) {
          setTimeout(() => {
            this.localUsageService.invalidate();
            this.onChange();
          }, 500);
        }
      });
    } catch {
      // Directory doesn't exist, skip
    }
  }

  stop(): void {
    this.running = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
```

---

## 15. i18n.ts 扩展

在 `dict` 中添加 Phase 3 需要的键：

```typescript
  en: {
    // ... existing keys ...
    "dashboard.costCurve": "Cost Curve",
    "dashboard.detailedUsage": "Detailed Usage",
    "dashboard.usageHistory": "Usage History",
    "dashboard.budgetAlert": "Budget Alert",
    "dashboard.modelBreakdown": "Model Breakdown",
    "dashboard.noData": "No data",
    "dashboard.loading": "Loading…",
  },
  "zh-CN": {
    // ... existing keys ...
    "dashboard.costCurve": "费用变化曲线",
    "dashboard.detailedUsage": "用量明细",
    "dashboard.usageHistory": "使用历史",
    "dashboard.budgetAlert": "预算告警",
    "dashboard.modelBreakdown": "模型明细",
    "dashboard.noData": "无数据",
    "dashboard.loading": "加载中…",
  },
```

---

## 16. 测试计划

### 16.1 单元测试

| 模块 | 测试内容 | 示例断言 |
|---|---|---|
| `calc.ts` | `heatmapColor` 插值 | `heatmapColor(0) === "rgb(13,71,161)"` |
| `calc.ts` | `buildDailyBuckets` | 生成 7 天范围应返回 7 个 bucket |
| `historyService.ts` | `aggregateEntries` | 2 条 entry 的 cost 应正确累加 |
| `historyService.ts` | `buildHeatmapData` | 90 天范围应返回 90 个 daily 项 |
| `historyService.ts` | `buildCostCurve` | 空 entries 返回空数组 |
| `historyService.ts` | `buildDashboardAggregates` | `today` 的 messageCount 等于今日 entry 数 |

### 16.2 集成测试

| 场景 | 步骤 | 期望结果 |
|---|---|---|
| Dashboard 打开 | 调用 `DashboardPanel.createOrShow()` | WebView 显示，所有卡片渲染 |
| 成本曲线切换 | 选择不同 5h 窗口 | 图表更新，无 stale response |
| 预算设置 | 设置 budget=100，模拟 cost7d=150 | 状态栏显示 ⚠，Dashboard 显示红色告警 |
| 热力图 | 90 天无数据 | 所有格子显示边框色（不填充） |
| Session 监控 | 写入新 wire.jsonl | 5s 内 Dashboard 数据更新 |

### 16.3 WebView 测试

1. `buildDashboardMessage()` 返回的数据结构完整性
2. `handleMessage()` 对各种 message type 的响应
3. XSS 防护：确保 `esc()` 转义所有动态内容

---

## 17. 与 Phase 2 的关键差异

| 维度 | Phase 2 | Phase 3 |
|---|---|---|
| **Dashboard** | 仅 Header + Current Usage + Footer | 新增 6 个卡片（Cost Curve / Detailed Usage / History / Budget / Models / Pricing） |
| **数据流** | `sendUpdate(state)` 发送原始 `AppState` | `sendUpdate(data)` 发送 `DashboardMessage`（预计算聚合） |
| **本地数据** | `LocalAggregatedUsage` 只有汇总 | 保留原始 `entries[]`，供 `HistoryService` 多粒度聚合 |
| **Service 层** | 无 `HistoryService` | 新增 `HistoryService`，负责热力图/曲线/趋势图数据 |
| **Scheduler** | 仅本地估算 + API 刷新 | 新增预算告警检查 |
| **状态栏** | 显示百分比 | 预算超限时显示 ⚠ 和警告背景色 |
| **Store** | `LOCAL_ESTIMATE` 只有 `weeklyPct/windowPct` | 扩展为包含 `cost7d` |
| **外部依赖** | 无 | 通过 CDN 引入 Chart.js 4.4.1 |
| **文件监控** | 无 | 可选 `SessionMonitor`（文件系统监听器） |
| **配置项** | `language/refreshInterval/displayMode` | 新增 `weeklyBudget/chartHeightRatio/sessionMonitorEnabled` |

---

## 18. 实现顺序建议

按以下顺序开发，确保每步可验证：

1. **`types.ts`** — 添加所有 Phase 3 接口
2. **`calc.ts`** — 添加历史聚合辅助函数
3. **`config.ts`** — 添加预算/sessionMonitor 配置
4. **`historyService.ts`** — 实现数据聚合（可独立单元测试）
5. **`localUsageService.ts`** — 暴露 `entries`，添加增量扫描
6. **`store.ts`** — 添加新 Action 处理
7. **`scheduler.ts`** — 添加预算检查
8. **`statusBar.ts`** — 添加预算告警指示器
9. **`dashboard.ts`** — 扩展 HTML/JS（最复杂，分卡片逐个实现）
   - 先实现 `Current Usage` 增强（显示 cost）
   - 再实现 `Cost Curve Card`
   - 再实现 `Usage History Card`（热力图 + 柱状图）
   - 再实现 `Budget Alert Card`
   - 最后实现 `Model Breakdown Card`
10. **`extension.ts`** — 注册新命令，初始化 SessionMonitor
11. **`package.json`** — 添加新配置项和命令
12. **测试** — 逐模块验证

---

## 19. 注意事项

1. **Chart.js CDN**：Dashboard HTML 中通过 `https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js` 加载。如果用户无网络，图表不会显示（ graceful degradation：显示 "Chart unavailable" 文本）。
2. **性能**：`buildDashboardAggregates` 每次 state 变化都会执行。如果 entry 数量 > 10k，考虑在 `HistoryService` 中加内存缓存。
3. **XSS**：WebView 中所有动态插入的字符串必须经过 `esc()` 转义。特别注意 `modelBreakdown` 的 key（未来可能来自用户输入）。
4. **CSP**：Chart.js CDN 需要 `script-src` 包含 `https://cdn.jsdelivr.net`。
5. **Node.js `fs.watch`**：Windows 上 `recursive: true` 的可靠性有限。`SessionMonitor` 作为 P2 可选功能，默认关闭。

---

文档结束。开发前请确认范围。
