# AI Status Hub v2 Phase 2 详细实现文档

## 0.6.20 精简费用显示（2026-11-09）

i18n 的 glm.apiEquivalentCost 保留翻译键，显示值缩短为 Cost / 费用，同步作用于状态栏 tooltip 和 Dashboard 表头；窗口前缀复用 dashboard.cost。费用估算说明与价格计算继续沿用 0.6.19。

## 0.6.19 GLM 费率配置与费用语义（2026-11-09）

ConfigService 的 GLM 默认模型更新为 glm-5.3，官方价格链接改为文档定价页；getPricing 可传模型缺省费率，保持自定义关键字、Provider 私有、全局配置的优先级，避免通用 2/10/0.5 覆盖 GLM 参考价。package.json 增加四个 GLM 模型的 16 项私有费率设置，每项仍允许 0。无新增逐请求字段或历史集合。

状态栏 tooltip 中 GLM 的费用列和解释使用“API 等价费用（估算）”，说明与 Coding Plan 加权积分和实际扣款的区别；未改变其他 Provider 的费用语义。中英翻译位于 i18n.ts。

## 0.6.18 本地统计来源及总 Token（2026-11-09）

DashboardUsageData 新增 totalTokens，表示互斥的输入、输出、缓存分类之和，供 Dashboard 各时间页直接显示；不会将它用于配额百分比校准。StatusBarPresenter 的本地用量区注明仅覆盖本机/拷回日志，区分今日与额度窗口。i18n.ts 同时更新中英文：总 Token（含缓存）、输入不含缓存，以及本地来源说明。

## 0.6.17 GLM 配额和错误展示（2026-11-09）

QuotaData / UnifiedQuota 新增可选 has7dLimit 标记，仅提供 5h 额度时不假报每周 0%。KimiUsageData 新增 weeklyQuotaAvailable 与 quotaError：前者驱动缺失周窗口红色标记，后者将 GLM 已脱敏的查询失败原因显示在 Dashboard。StatusBarPresenter 在没有本地记录和配额但查询失败时显示警告及原因，避免永久转圈；本地统计不被查询失败遮挡。仅 5h 套餐的状态栏颜色取 5h 剩余额度。旧 Provider 未提供新标记时保持原有语义。

内存变化为每份 quota 一个可选布尔值、每次 Dashboard 更新一个布尔值及已有错误字符串引用，不新增历史集合，不改变 retention 预算。新增 GLM 中英翻译覆盖连接验证、鉴权失败、套餐缺失、HTTP 错误及网络异常。

## 0.6.16 未登录本地展示与数据协议（2026-11-09）

StatusBarPresenter 的 missing 分支只在没有 quota 和 localEstimate 时提前返回；存在本地数据时继续显示今日本地输入 Token、费用以及 tooltip 中完整用量统计。calc.hasQuotaData 统一判断配额依据，没有依据时不渲染百分比进度条和重置时间，提供红色配额提示和该 Provider 的登录命令。语言取有效语言，货币取状态栏 Provider 的配置。认证过期/失败时仍保留已有数据。

types.ts 的 KimiUsageData 新增 quotaAvailable 字段，让 Dashboard 分别处理配额可用性与本地数据。Scheduler 继续先发布本地记录。新增中英翻译位于 i18n.ts，包含 GLM 登录引导、浏览器失败、密钥保存结果、配额警告及估算费用说明。

> 版本：v2.0.0-draft
> 日期：2026-05-12
> 前置文档：
> - `v2-rebuild-design.md` — 整体架构
> - `v2-dashboard-design.md` — 仪表盘设计
> - `v2-local-estimation-design.md` — 本地估算设计
> - `v2-phase1-implementation.md` — Phase 1 实现
> **本文档目标**：AI 加载后可直接生成全部源代码，无需额外提示词。

---

## 1. Phase 2 范围

| 模块 | 功能 | 说明 |
|---|---|---|
| **本地 JSONL 扫描** | 异步扫描 ~/.kimi/sessions/**/wire.jsonl | fileStates 增量更新，去重，多窗口聚合 |
| **Token 容量校准** | API 返回时校准 weekly/window 容量 | 纯函数，7 天过期 |
| **Short tick** | 5s 本地估算，不调 API | Scheduler 重构为 short/long 双 tick |
| **缓存持久化** | calibration 数据写入缓存 | cacheService 扩展 |
| **UI fallback** | 无 API 时显示本地估算 | statusBar + dashboard |

**Phase 2 不实现**：成本曲线（Phase 3）、热力图（Phase 3）、模型明细（Phase 3）、预算告警（Phase 3）。

---

## 1.1 当前窗口锚点策略

- 5h / 7d 的本地统计窗口统一由 `WindowAnchorData` 驱动，窗口起点定义为官方 reset 时间减去固定周期：`windowResetAt - 5h`、`weeklyResetAt - 7d`。
- `Scheduler` 在 API 成功时从 quota 的 `windowResetAt` / `weeklyResetAt` 生成官方锚点并写入 Store；API 失败时先复用当前 Store 锚点，再通过 `CacheService.readWindowAnchors(providerId)` 从磁盘恢复，仍失败才使用 `now - period` fallback。
- `CacheService` 负责所有窗口锚点磁盘 I/O，schema 为 `ai-status-hub-window-anchors-v1`，文件位于 provider 隔离缓存目录，例如 `~/.codex/ai-status-hub-window-anchors-claude.json`。
- 插件 `deactivate` 时通过 `CacheService.writeWindowAnchors(providerId, data)` 写入最后有效锚点；`SIGN_OUT` 清空当前锚点，provider 激活后由 Scheduler 重新从 API / 磁盘 / fallback 设置。
- Claude JSONL 不要求保存官方窗口起点；Claude API 403、用量耗尽或网络失败时，本地 usage、Detailed Usage、heatmap、Cost Curve 仍共用同一组锚点窗口。
- Claude OAuth usage 临时不可用并回退 Messages headers 时，如果新响应缺少 Fable 模型级窗口，Scheduler 会保留最后一次已知 Fable 窗口。重置时间到达后将用量清零并把 reset 推算到下一 7d 周期，使进度条保持可见；新权威数据到达后覆盖该估算状态。
- `force()` 在安排强制 long tick 前调用 Provider 可选的 `invalidateCache()`，保证手动刷新绕过成功响应缓存；Provider 自己维护的服务端限流退避不被清除。

---

## 2. 文件结构变化

相对于 Phase 1 的变化：

```
v2/
├── src/
│   ├── extension.ts              # 扩展：引入 LocalUsageService，恢复 calibration
│   ├── types.ts                  # 扩展：LocalEstimate, CalibrationData, UsageEntry, CachedData, Action
│   ├── store.ts                  # 扩展：localEstimate 字段，LOCAL_ESTIMATE reducer
│   ├── calc.ts                   # 扩展：Phase 2 校准与估算纯函数
│   ├── services/
│   │   ├── localUsageService.ts  # 新增：JSONL 扫描 + Token 聚合
│   │   ├── scheduler.ts          # 重构：short/long 双 tick
│   │   └── cacheService.ts       # 扩展：支持 CalibrationData 持久化
│   └── presenters/
│       ├── statusBar.ts          # 扩展：local-only 模式显示估算值
│       └── dashboard.ts          # 扩展：estimate badge，local-only source label
```

---

## 3. types.ts

Phase 2 在 Phase 1 基础上新增/扩展以下内容（其余同 Phase 1）：

当前统一 `QuotaData` 还允许 Claude 附带可选的 `fableWeeklyUsedPct` / `fableWeeklyResetAt`，用于承载模型级 Fable 7d 配额；其他 Provider 不设置这两个字段。

```typescript
export type DataSource = 'api' | 'cache' | 'stale' | 'no-credentials' | 'no-data' | 'local-only';

export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreatePerMillion: number;
}

export interface LocalEstimate {
  weeklyPct: number;
  windowPct: number;
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number | null;
}

export interface CalibrationData {
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number;
  reset5hAt: number;
  reset7dAt: number;
}

export interface AppState {
  quota: QuotaData | null;
  lastFetchAt: number | null;
  lastSuccessfulFetchAt: number | null;
  error: string | null;
  authStatus: AuthStatus;
  dataSource: DataSource;
  isLoading: boolean;
  localEstimate: LocalEstimate | null;
  ui: {
    displayMode: DisplayMode;
    language: LanguageSetting;
    isPaused: boolean;
  };
}

export interface CachedData {
  quota: QuotaData;
  fetchedAt: number;
  calibration?: CalibrationData;
}

export type Action =
  | { type: 'INIT' }
  | { type: 'CACHE_LOADED'; payload: QuotaData }
  | { type: 'API_SUCCESS'; payload: QuotaData }
  | { type: 'API_ERROR'; payload: { error: string; authFailed?: boolean; networkError?: boolean } }
  | { type: 'LOCAL_ESTIMATE'; payload: Partial<LocalEstimate> }
  | { type: 'AUTH_STATUS'; payload: AuthStatus }
  | { type: 'UI_SET_DISPLAY_MODE'; payload: DisplayMode }
  | { type: 'UI_SET_LANGUAGE'; payload: LanguageSetting }
  | { type: 'UI_SET_PAUSED'; payload: boolean }
  | { type: 'LOADING_START' }
  | { type: 'LOADING_END' }
  | { type: 'SIGN_OUT' };
```

---

## 4. store.ts

Phase 2 在 Phase 1 基础上新增 `localEstimate` 字段和 `LOCAL_ESTIMATE` reducer 处理（其余同 Phase 1）：

```typescript
import { AppState, Action, AuthStatus } from './types';

export const defaultState = (): AppState => ({
  quota: null,
  lastFetchAt: null,
  lastSuccessfulFetchAt: null,
  error: null,
  authStatus: 'unknown',
  dataSource: 'no-data',
  isLoading: false,
  localEstimate: null,
  ui: {
    displayMode: 'percent',
    language: 'auto',
    isPaused: false,
  },
});

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return state;

    case 'CACHE_LOADED':
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: action.payload.weeklyResetAt,
        dataSource: 'cache',
        error: null,
      };

    case 'API_SUCCESS': {
      const now = Date.now();
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: now,
        lastSuccessfulFetchAt: now,
        dataSource: 'api',
        error: null,
        authStatus: state.authStatus === 'missing' ? 'authenticated' : state.authStatus,
        isLoading: false,
      };
    }

    case 'API_ERROR':
      return {
        ...state,
        error: action.payload.error,
        isLoading: false,
        authStatus: action.payload.authFailed
          ? (state.authStatus === 'authenticated' ? 'expired' : 'failed')
          : state.authStatus,
      };

    case 'LOCAL_ESTIMATE': {
      const next: AppState = {
        ...state,
        localEstimate: state.localEstimate
          ? { ...state.localEstimate, ...action.payload }
          : { weeklyPct: 0, windowPct: 0, tokenCapacity: null, windowCostCapacity: null, calibratedAt: null, ...action.payload },
      };
      // When we have a local estimate but no API quota yet, upgrade dataSource
      if (!state.quota && next.localEstimate) {
        next.dataSource = state.dataSource === 'no-data' ? 'local-only' : state.dataSource;
      }
      return next;
    }

    case 'AUTH_STATUS':
      return { ...state, authStatus: action.payload };

    case 'UI_SET_DISPLAY_MODE':
      return { ...state, ui: { ...state.ui, displayMode: action.payload } };

    case 'UI_SET_LANGUAGE':
      return { ...state, ui: { ...state.ui, language: action.payload } };

    case 'UI_SET_PAUSED':
      return { ...state, ui: { ...state.ui, isPaused: action.payload } };

    case 'LOADING_START':
      return { ...state, isLoading: true };

    case 'LOADING_END':
      return { ...state, isLoading: false };

    case 'SIGN_OUT':
      return {
        ...defaultState(),
        ui: state.ui,
      };

    default:
      return state;
  }
}

export class Store {
  private state: AppState;
  private listeners = new Set<(s: AppState) => void>();

  constructor() {
    this.state = defaultState();
  }

  dispatch(action: Action): void {
    const next = reducer(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach((fn) => {
        try { fn(this.state); } catch (e) { console.error('Store listener error', e); }
      });
    }
  }

  getState(): AppState { return this.state; }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
```

> **v0.5.22 修复**：`API_ERROR` 现在更新 `lastFetchAt`（记录尝试时间），使 Dashboard 刷新计时器在失败时也能归零；`CACHE_LOADED` 不再无条件清除 `error`，避免 API 401 错误被缓存恢复掩盖。

---

## 5. calc.ts

Phase 2 在 Phase 1 基础上新增以下纯函数（Phase 1 部分同前，此处仅列出新增）：

### 5.0 鉴权显示判定与状态栏指示器（v0.5.26 新增）

- `resolveAuthDisplayMode(state): 'normal' | 'degraded' | 'blocked'` — 决定状态栏对鉴权错误的呈现方式：
  - `normal`：无鉴权错误，照常渲染；
  - `degraded`：`authStatus` 为 `expired`，或为 `failed` 且 `error` 非空，但仍有缓存 quota 或 localEstimate 可显示 → 照常渲染用量并附加 🔐 指示器（token 在用户下次使用 Claude Code 时会自动刷新，扩展自愈）；
  - `blocked`：鉴权错误且完全无数据 → 红色错误全占显示。
  - `authStatus === 'missing'`（从未登录）不在该函数职责内，由 presenter 在调用前单独短路。
- `buildIndicatorSuffix(state, now, staleThresholdMs, parts)` — 统一构建状态栏 emoji 指示器后缀，固定顺序 stale(💤) → source(🌐/⛓️‍💥) → auth(🔐)；`parts` 参数选择每个状态栏项显示哪些指示器（itemWindow 用 `['stale','auth']`，itemWeekly 用 `['source','auth']`，动画期间用全部三个）。收编了原先内联在 statusBar.ts 两处的重复计算。

```typescript
import { QuotaData, TokenPricing } from './types';

export interface TokenUsage {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}

export function calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
  const cost = (
    (usage.inputOther / 1_000_000) * pricing.inputPerMillion +
    (usage.output / 1_000_000) * pricing.outputPerMillion +
    (usage.inputCacheRead / 1_000_000) * pricing.cacheReadPerMillion +
    (usage.inputCacheCreation / 1_000_000) * pricing.cacheCreatePerMillion
  );
  return isFinite(cost) && cost >= 0 ? cost : 0;
}

// ---------------------------------------------------------------------------
// Phase 2: Calibration & Estimation
// ---------------------------------------------------------------------------

export interface Calibration {
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number;
  resetAt: number;
}

/** Calibrate token capacity from API weeklyUsedPct and local tokens. */
export function calibrateTokenCapacity(
  apiWeeklyUsedPct: number,
  localTokensThisCycle: number,
): number | null {
  if (!apiWeeklyUsedPct || apiWeeklyUsedPct <= 0) return null;
  if (localTokensThisCycle <= 0) return null;
  const capacity = localTokensThisCycle / (apiWeeklyUsedPct / 100);
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Calibrate window cost capacity from API windowUsedPct and local cost. */
export function calibrateWindowCostCapacity(
  apiWindowUsedPct: number,
  localCost5h: number,
): number | null {
  if (!apiWindowUsedPct || apiWindowUsedPct <= 0) return null;
  if (localCost5h <= 0) return null;
  const capacity = localCost5h / (apiWindowUsedPct / 100);
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Heuristic estimate when API returns 0% but local has cost. */
export function estimateWindowCostCapacityHeuristic(
  localCost5h: number,
  windowLimit: number | null,
): number | null {
  if (localCost5h <= 0) return null;
  if (!windowLimit || windowLimit <= 0) return null;
  const capacity = localCost5h * windowLimit;
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Estimate weekly percentage from local tokens and calibrated capacity. */
export function estimateWeeklyPct(
  localTokensThisCycle: number,
  tokenCapacity: number | null,
): number | null {
  if (!tokenCapacity || tokenCapacity <= 0) return null;
  if (localTokensThisCycle < 0) return null;
  const pct = (localTokensThisCycle / tokenCapacity) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Fallback weekly percentage when calibration is unavailable. */
export function fallbackWeeklyPct(
  localTokensThisCycle: number,
  weeklyLimit: number | null,
): number {
  if (!weeklyLimit || weeklyLimit <= 0) return 0;
  return Math.min(100, (localTokensThisCycle / weeklyLimit) * 100);
}

/** Estimate window percentage from local cost and calibrated capacity. */
export function estimateWindowPct(
  localCost5h: number,
  windowCostCapacity: number | null,
): number | null {
  if (!windowCostCapacity || windowCostCapacity <= 0) return null;
  if (localCost5h < 0) return null;
  const pct = (localCost5h / windowCostCapacity) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Fallback window percentage when calibration is unavailable. */
export function fallbackWindowPct(
  localCost5h: number,
  windowLimit: number | null,
): number {
  if (!windowLimit || windowLimit <= 0) return 0;
  return Math.min(100, (localCost5h / windowLimit) * 100);
}

/** Check if calibration is still valid for the current reset cycle. */
export function isCalibrationValid(
  calibration: Calibration | null,
  currentResetAt: number | null,
): boolean {
  if (!calibration || !calibration.calibratedAt) return false;
  if (!currentResetAt) return false;
  if (calibration.resetAt !== currentResetAt) return false;
  if (Date.now() - calibration.calibratedAt > 7 * 24 * 3600 * 1000) return false;
  return true;
}

/** Safe estimate wrapper: tries estimateFn, falls back to fallbackFn. */
export function safeEstimate(
  estimateFn: () => number | null,
  fallbackFn: () => number,
): number {
  try {
    const result = estimateFn();
    return result !== null && isFinite(result) ? result : fallbackFn();
  } catch {
    return fallbackFn();
  }
}
```

---

## 6. services/localUsageService.ts

新增文件，完整代码：

```typescript
// 🔀 Provider boundary: JSONL path and format are Kimi-specific.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { TokenPricing } from '../types';
import { calculateCost, TokenUsage } from '../calc';
import { log } from '../utils';

const SESSIONS_DIR = path.join(os.homedir(), '.kimi', 'sessions');

export interface UsageEntry {
  timestamp: number; // ms
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  cost: number;
  messageId: string | null;
  model?: string;
}

export interface LocalAggregatedUsage {
  tokensToday: number;
  costToday: number;
  requestsToday: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  cost5h: number;
  requests5h: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  cost7d: number;
  requests7d: number;
  tokensThisCycle: number;
  costThisCycle: number;
  requestsThisCycle: number;
  entries: UsageEntry[];
}

interface FileState {
  mtimeMs: number;
  size: number;
  entries: UsageEntry[];
}

export class LocalUsageService {
  private static instance: LocalUsageService;
  private fileStates = new Map<string, FileState>();

  static getInstance(): LocalUsageService {
    if (!LocalUsageService.instance) { LocalUsageService.instance = new LocalUsageService(); }
    return LocalUsageService.instance;
  }

  async getLocalUsage(opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
  }): Promise<LocalAggregatedUsage> {
    return this.scanAllFiles(opts);
  }

  invalidate(): void {
    this.fileStates.clear();
  }

  private async scanAllFiles(opts?: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
  }): Promise<LocalAggregatedUsage> {
    const empty: LocalAggregatedUsage = {
      tokensToday: 0, costToday: 0, requestsToday: 0,
      tokensIn5h: 0, tokensOut5h: 0, tokensCacheRead5h: 0, tokensCacheCreate5h: 0,
      requests5h: 0,
      tokensIn7d: 0, tokensOut7d: 0, tokensCacheRead7d: 0, tokensCacheCreate7d: 0,
      cost7d: 0, requests7d: 0,
      cost5h: 0,
      tokensThisCycle: 0, costThisCycle: 0, requestsThisCycle: 0,
      entries: [],
    };

    try {
      await fs.access(SESSIONS_DIR);
    } catch {
      return empty;
    }

    const files = await this.enumerateWireJsonl(SESSIONS_DIR);
    if (files.length === 0) {
      return empty;
    }

    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const default5hStart = now - 5 * 3600 * 1000;
    const window5hStart = opts?.window5hStartMs
      ?? (opts?.windowResetAtMs ? opts.windowResetAtMs - 5 * 3600 * 1000 : default5hStart);
    const window7dStart = opts?.weeklyResetAtMs ? opts.weeklyResetAtMs - 7 * 24 * 3600 * 1000 : now - 7 * 24 * 3600 * 1000;
    const cycleStart = opts?.cycleStartMs ?? window7dStart;

    const seenMessageIds = new Set<string>();
    const entries: UsageEntry[] = [];

    // Read all files in parallel
    const fileContents = await Promise.all(
      files.map(async (f) => {
        try {
          const text = await fs.readFile(f, 'utf-8');
          return text;
        } catch {
          return '';
        }
      })
    );

    for (const text of fileContents) {
      if (!text) continue;
      const lines = text.split(/\r?\n/);
      for (const line of lines) {
        if (!line.trim()) continue;
        const entry = this.parseLine(line);
        if (!entry) continue;

        // Deduplicate by messageId
        if (entry.messageId) {
          if (seenMessageIds.has(entry.messageId)) continue;
          seenMessageIds.add(entry.messageId);
        }

        entries.push(entry);

        // Aggregate by time windows
        const ts = entry.timestamp;
        if (ts >= todayStart) {
          empty.tokensToday += entry.inputOther + entry.output + entry.inputCacheRead + entry.inputCacheCreation;
          empty.costToday += entry.cost;
          empty.requestsToday++;
        }
        if (ts >= window5hStart) {
          empty.tokensIn5h += entry.inputOther;
          empty.tokensOut5h += entry.output;
          empty.tokensCacheRead5h += entry.inputCacheRead;
          empty.tokensCacheCreate5h += entry.inputCacheCreation;
          empty.cost5h += entry.cost;
          empty.requests5h++;
        }
        if (ts >= window7dStart) {
          empty.tokensIn7d += entry.inputOther;
          empty.tokensOut7d += entry.output;
          empty.tokensCacheRead7d += entry.inputCacheRead;
          empty.tokensCacheCreate7d += entry.inputCacheCreation;
          empty.cost7d += entry.cost;
          empty.requests7d++;
        }
        if (ts >= cycleStart) {
          empty.tokensThisCycle += entry.inputOther + entry.output + entry.inputCacheRead + entry.inputCacheCreation;
          empty.costThisCycle += entry.cost;
          empty.requestsThisCycle++;
        }
      }
    }

    empty.entries = entries;
    return empty;
  }

  private async enumerateWireJsonl(dir: string): Promise<string[]> {
    const results: string[] = [];
    try {
      const sessionDirs = await fs.readdir(dir, { withFileTypes: true });
      for (const sessionDir of sessionDirs) {
        if (!sessionDir.isDirectory()) continue;
        const sessionPath = path.join(dir, sessionDir.name);
        try {
          const convDirs = await fs.readdir(sessionPath, { withFileTypes: true });
          for (const convDir of convDirs) {
            if (!convDir.isDirectory()) continue;
            const wirePath = path.join(sessionPath, convDir.name, 'wire.jsonl');
            try {
              await fs.access(wirePath);
              results.push(wirePath);
            } catch { /* ignore missing */ }
          }
        } catch { /* ignore unreadable session dir */ }
      }
    } catch { /* ignore */ }
    return results;
  }

  private parseLine(line: string): UsageEntry | null {
    try {
      const json = JSON.parse(line);
      if (json.message?.type !== 'StatusUpdate') return null;
      const payload = json.message.payload;
      if (!payload?.token_usage) return null;

      const tu = payload.token_usage;
      const usage: TokenUsage = {
        inputOther: toInt(tu.input_other),
        output: toInt(tu.output),
        inputCacheRead: toInt(tu.input_cache_read),
        inputCacheCreation: toInt(tu.input_cache_creation),
      };
      const cost = calculateCost(usage, DEFAULT_PRICING);
      const timestamp = typeof json.timestamp === 'number' ? json.timestamp * 1000 : Date.now();

      return {
        timestamp,
        inputOther: usage.inputOther,
        output: usage.output,
        inputCacheRead: usage.inputCacheRead,
        inputCacheCreation: usage.inputCacheCreation,
        cost,
        messageId: payload.message_id ?? null,
        model: payload.model ?? undefined,
      };
    } catch {
      return null;
    }
  }
}

function toInt(v: any): number {
  const n = typeof v === 'number' ? v : parseInt(String(v), 10);
  return isNaN(n) ? 0 : n;
}

/** Default pricing for kimi-k2.6 (RMB). */
export const DEFAULT_PRICING: TokenPricing = {
  inputPerMillion: 6.50,
  outputPerMillion: 27.00,
  cacheReadPerMillion: 1.10,
  cacheCreatePerMillion: 6.50,
};
```

---

## 7. services/scheduler.ts

重构为 short/long 双 tick：

- `doShortTick` 静默扫描本地 JSONL 数据，不 dispatch 加载状态（避免每 5 秒闪烁状态栏）。
- `doLongTick` 保持原有加载状态管理。

完整代码：

```typescript
// DESIGN: v2-phase2-implementation.md#servicesschedulerts
// 💠 Generic: scheduler logic is provider-agnostic.

import { Store } from '../store';
import { AuthService } from './authService';
import { ApiService } from './apiService';
import { CacheService } from './cacheService';
import { LocalUsageService } from './localUsageService';
import { ConfigService } from '../config';
import { log } from '../utils';
import {
  calibrateTokenCapacity,
  calibrateWindowCostCapacity,
  estimateWeeklyPct,
  estimateWindowPct,
  fallbackWeeklyPct,
  fallbackWindowPct,
  isCalibrationValid,
} from '../calc';

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLongTick = 0;
  private readonly config = ConfigService.getInstance();

  private get longMs(): number {
    return this.config.refreshIntervalSeconds * 1000;
  }

  constructor(
    private store: Store,
    private authService: AuthService,
    private apiService: ApiService,
    private cacheService: CacheService,
    private localUsageService: LocalUsageService,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Ensure first tick is a long tick so we fetch API data immediately
    this.lastLongTick = Date.now() - this.longMs;
    // First tick immediately (fetch API data as soon as possible)
    this.schedule(Date.now());
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Manual refresh: force a long tick (API fetch) immediately. */
  force(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    // Reset lastLongTick so the next tick is guaranteed to be a long tick
    this.lastLongTick = Date.now() - this.longMs;
    this.schedule(Date.now() + 50);
  }

  private schedule(at: number): void {
    if (!this.running) return;
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const isLong = now - this.lastLongTick >= this.longMs;

    try {
      if (isLong) {
        await this.doLongTick();
        this.lastLongTick = now;
      } else {
        await this.doShortTick();
      }
    } catch (err) {
      log(`Scheduler tick error: ${err}`);
    }

    // Schedule next tick: whichever comes first (short or long)
    const nextLong = this.lastLongTick + this.longMs;
    const nextShort = now + this.config.shortRefreshIntervalSeconds * 1000;
    this.schedule(Math.min(nextLong, nextShort));
  }

  private async doShortTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    const state = this.store.getState();
    const quota = state.quota;

    const localUsage = await this.localUsageService.getLocalUsage({
      weeklyResetAtMs: quota?.weeklyResetAt,
      windowResetAtMs: quota?.windowResetAt,
      dataRetentionDays: this.config.dataRetentionDays,
    });

    // Skip short tick when no local data is available to avoid overwriting
    // API percentages with zeros.
    if (localUsage.entries.length === 0) {
      return;
    }

    const calibration = state.localEstimate
      ? {
          tokenCapacity: state.localEstimate.tokenCapacity,
          windowCostCapacity: state.localEstimate.windowCostCapacity,
          calibratedAt: state.localEstimate.calibratedAt ?? 0,
          resetAt: quota?.weeklyResetAt ?? 0,
        }
      : null;

    const tokenCapacity = isCalibrationValid(calibration, quota?.weeklyResetAt ?? null)
      ? calibration!.tokenCapacity
      : null;
    const windowCostCapacity = isCalibrationValid(
      calibration ? { ...calibration, resetAt: quota?.windowResetAt ?? 0 } : null,
      quota?.windowResetAt ?? null,
    )
      ? calibration!.windowCostCapacity
      : null;

    const weeklyPct = estimateWeeklyPct(localUsage.tokensThisCycle, tokenCapacity)
      ?? fallbackWeeklyPct(localUsage.tokensThisCycle, quota?.weeklyLimit ?? null);
    const windowPct = estimateWindowPct(localUsage.cost5h, windowCostCapacity)
      ?? fallbackWindowPct(localUsage.cost5h, quota?.windowLimit ?? null);

    this.store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct,
        windowPct,
        cost5h: localUsage.cost5h,
        cost7d: localUsage.cost7d,
        costToday: localUsage.costToday,
        // Full detail for tooltip / dashboard (from memory, no disk access)
        requestsToday: localUsage.requestsToday,
        tokensToday: localUsage.tokensToday,
        tokensIn5h: localUsage.tokensIn5h,
        tokensOut5h: localUsage.tokensOut5h,
        tokensCacheRead5h: localUsage.tokensCacheRead5h,
        tokensCacheCreate5h: localUsage.tokensCacheCreate5h,
        requests5h: localUsage.requests5h,
        tokensIn7d: localUsage.tokensIn7d,
        tokensOut7d: localUsage.tokensOut7d,
        tokensCacheRead7d: localUsage.tokensCacheRead7d,
        tokensCacheCreate7d: localUsage.tokensCacheCreate7d,
        requests7d: localUsage.requests7d,
        tokensThisCycle: localUsage.tokensThisCycle,
        costThisCycle: localUsage.costThisCycle,
        requestsThisCycle: localUsage.requestsThisCycle,
      },
    });
  }

  private async doLongTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    this.store.dispatch({ type: 'LOADING_START' });

    const token = await this.authService.resolveToken();
    if (!token) {
      this.store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      this.store.dispatch({ type: 'LOADING_END' });
      return;
    }

    const result = await this.apiService.fetchQuota(token);

    if (result.ok && result.data) {
      const apiData = result.data;

      const localUsage = await this.localUsageService.getLocalUsage({
        weeklyResetAtMs: apiData.weeklyResetAt,
        windowResetAtMs: apiData.windowResetAt,
        dataRetentionDays: this.config.dataRetentionDays,
      });

      // 百分数平稳化：若本地估算值四舍五入后的整数与 API 返回的整数一致，
      // 则保留更精细的本地估算值，避免每次 API 刷新都跳回整数造成视觉跳动
      const currentEstimate = this.store.getState().localEstimate;
      let weeklyPct = apiData.weeklyUsedPct;
      let windowPct = apiData.windowUsedPct;
      if (currentEstimate) {
        if (Math.round(currentEstimate.weeklyPct) === apiData.weeklyUsedPct) {
          weeklyPct = currentEstimate.weeklyPct;
        }
        if (Math.round(currentEstimate.windowPct) === apiData.windowUsedPct) {
          windowPct = currentEstimate.windowPct;
        }
      }

      // Calibrate using the smoothed percentages so short ticks preserve the fine-grained value
      const tokenCapacity = calibrateTokenCapacity(weeklyPct, localUsage.tokensThisCycle);
      const windowCostCapacity = calibrateWindowCostCapacity(windowPct, localUsage.cost5h);

      // Write cache with calibration
      await this.cacheService.write({
        quota: apiData,
        fetchedAt: Date.now(),
        calibration: {
          tokenCapacity,
          windowCostCapacity,
          calibratedAt: Date.now(),
          reset5hAt: apiData.windowResetAt,
          reset7dAt: apiData.weeklyResetAt,
        },
      });

      this.store.dispatch({ type: 'API_SUCCESS', payload: apiData });
      this.store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          weeklyPct,
          windowPct,
          tokenCapacity,
          windowCostCapacity,
          calibratedAt: Date.now(),
          cost5h: localUsage.cost5h,
          cost7d: localUsage.cost7d,
          costToday: localUsage.costToday,
          // Full detail for tooltip / dashboard (from memory, no disk access)
          requestsToday: localUsage.requestsToday,
          tokensToday: localUsage.tokensToday,
          tokensIn5h: localUsage.tokensIn5h,
          tokensOut5h: localUsage.tokensOut5h,
          tokensCacheRead5h: localUsage.tokensCacheRead5h,
          tokensCacheCreate5h: localUsage.tokensCacheCreate5h,
          requests5h: localUsage.requests5h,
          tokensIn7d: localUsage.tokensIn7d,
          tokensOut7d: localUsage.tokensOut7d,
          tokensCacheRead7d: localUsage.tokensCacheRead7d,
          tokensCacheCreate7d: localUsage.tokensCacheCreate7d,
          requests7d: localUsage.requests7d,
          tokensThisCycle: localUsage.tokensThisCycle,
          costThisCycle: localUsage.costThisCycle,
          requestsThisCycle: localUsage.requestsThisCycle,
        },
      });
    } else {
      this.store.dispatch({
        type: 'API_ERROR',
        payload: { error: result.error ?? 'Unknown error', authFailed: result.authFailed, networkError: result.networkError },
      });

      // Fallback to cache
      const cached = await this.cacheService.read();
      if (cached) {
        this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
        // Restore calibration if valid
        if (cached.calibration) {
          this.store.dispatch({
            type: 'LOCAL_ESTIMATE',
            payload: {
              tokenCapacity: cached.calibration.tokenCapacity,
              windowCostCapacity: cached.calibration.windowCostCapacity,
              calibratedAt: cached.calibration.calibratedAt,
            },
          });
        }
      }
    }

    this.store.dispatch({ type: 'LOADING_END' });
  }
}

`````

> **v0.5.22 修复**：`force()` 增加执行日志，便于在 Output 面板确认手动刷新已触发。
> **v0.5.23 修复**：`tick()` 增加 `Promise.race` 60 秒兜底超时，防止 `doLongTick()` 内部任何 async 操作（如 fetch 无超时）hang 住时 scheduler 彻底停止；Claude/Kimi `fetchQuota` 增加 `AbortController` + 30 秒超时。
> **v0.5.24 修复**：`ClaudeAuthProvider` 支持 `ANTHROPIC_API_KEY` 环境变量和 `CLAUDE_CONFIG_DIR` 路径覆盖；scheduler 在无 token 时使用 `getAuthStatus()` 区分 `missing` 与 `expired`。
> **v0.5.25 修复**：`ClaudeAuthProvider` 检测到 OAuth token 过期时仍返回 token 让 API 验证（配合 Claude Code 的自动刷新）；scheduler 在 API 401 时调用 `authService.invalidate()` 清除缓存。
> **v0.5.31 修复**：Claude usage 严格拒绝 `null`/空字符串百分比并继续 fallback；手动刷新清除成功缓存；HTTP 429 遵循 `Retry-After`；API Key 与 OAuth 通过 `getCredentialType()` 走各自正确的 endpoint/header 路径。

---

## 8. services/cacheService.ts

Phase 2 扩展 `CachedData` 以支持 `CalibrationData` 持久化，其余同 Phase 1：

```typescript
// 💠 Generic: cache schema is provider-agnostic.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CachedData } from '../types';

const CACHE_DIR = path.join(os.homedir(), '.kimi');
const CACHE_FILE = path.join(CACHE_DIR, 'ai-status-hub-cache-v2.json');
const SCHEMA = 'ai-status-hub-cache-v2';
const CURRENT_VERSION = 2;

export class CacheService {
  private static instance: CacheService;
  private cacheFile: string;

  static getInstance(): CacheService {
    if (!CacheService.instance) { CacheService.instance = new CacheService(); }
    return CacheService.instance;
  }

  constructor(cacheFile?: string) {
    this.cacheFile = cacheFile ?? CACHE_FILE;
  }

  async read(): Promise<CachedData | null> {
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== SCHEMA || parsed.version !== CURRENT_VERSION) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async write(data: CachedData): Promise<void> {
    const payload = {
      version: CURRENT_VERSION,
      schema: SCHEMA,
      writtenAt: new Date().toISOString(),
      data,
    };
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(payload, null, 2));
    } catch {
      // ignore write errors
    }
  }

  async clear(): Promise<void> {
    try { await fs.unlink(this.cacheFile); } catch { /* ignore */ }
  }
}
```

---

## 9. extension.ts

Phase 2 扩展以引入 `LocalUsageService`、恢复 calibration 数据：

```typescript
import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { AuthService } from './services/authService';
import { ApiService } from './services/apiService';
import { CacheService } from './services/cacheService';
import { LocalUsageService } from './services/localUsageService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, deleteApiKey, deleteOAuth } from './utils';

const PAUSE_STATE_KEY = 'aiStatusHub._pauseSignal';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('AI Status Hub v2 activated');

  const store = new Store();
  const config = ConfigService.getInstance();
  const authService = AuthService.getInstance();
  const apiService = ApiService.getInstance();
  const cacheService = CacheService.getInstance();
  const localUsageService = LocalUsageService.getInstance();

  authService.init(context.secrets);

  // 1. Restore pause state from globalState (cross-window sync)
  const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
  if (pausedFromGlobal) {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
  }

  // 2. Restore cache
  const cached = await cacheService.read();
  if (cached) {
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
    // Restore calibration
    if (cached.calibration) {
      store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          tokenCapacity: cached.calibration.tokenCapacity,
          windowCostCapacity: cached.calibration.windowCostCapacity,
          calibratedAt: cached.calibration.calibratedAt,
        },
      });
    }
  }

  // 3. Initialize Presenters
  const statusBar = new StatusBarPresenter(store);

  // 4. Start scheduler
  const scheduler = new Scheduler(store, authService, apiService, cacheService, localUsageService);
  scheduler.start();

  // 5. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aiStatusHub.refresh', () => {
      scheduler.force();
    }),
    vscode.commands.registerCommand('aiStatusHub.signIn', async () => {
      const success = await authService.startOAuthFlow();
      if (success) {
        scheduler.force();
      }
    }),
    vscode.commands.registerCommand('aiStatusHub.signOut', async () => {
      await deleteApiKey(context.secrets);
      await deleteOAuth(context.secrets);
      authService.invalidate();
      localUsageService.invalidate();
      store.dispatch({ type: 'SIGN_OUT' });
    }),
    vscode.commands.registerCommand('aiStatusHub.setApiKey', () => {
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('aiStatusHub.showDashboard', () => {
      DashboardPanel.createOrShow(store);
    }),
    vscode.commands.registerCommand('aiStatusHub.togglePause', async () => {
      const next = !store.getState().ui.isPaused;
      store.dispatch({ type: 'UI_SET_PAUSED', payload: next });
      await context.globalState.update(PAUSE_STATE_KEY, next);
      // Broadcast via configuration change so other windows pick it up
      const cfg = vscode.workspace.getConfiguration('aiStatusHub');
      await cfg.update('_pauseSignal', Date.now(), true);
    }),
  );

  // 6. Listen to configuration changes (including pause broadcast)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiStatusHub')) {
        store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
        store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });
        // Sync pause state from other windows via _pauseSignal broadcast
        if (e.affectsConfiguration('aiStatusHub._pauseSignal')) {
          const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
          const currentPaused = store.getState().ui.isPaused;
          if (pausedFromGlobal !== currentPaused) {
            store.dispatch({ type: 'UI_SET_PAUSED', payload: pausedFromGlobal });
          }
        }
      }
    })
  );

  // 7. Persist cache on deactivation via subscription disposal
  context.subscriptions.push(
    { dispose: () => { scheduler.stop(); statusBar.dispose(); } }
  );
}

export function deactivate(): void {
  log('AI Status Hub v2 deactivated');
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'AI Status Hub – Set API Key',
    prompt: 'Paste your Kimi API key (sk-...).',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
  });
  if (!value?.trim()) return;
  await writeApiKey(context.secrets, value.trim());
  void vscode.window.showInformationMessage('API key saved.');
}
```

---

## 10. presenters/statusBar.ts

Phase 2 扩展以支持 local-only 模式下的估算显示，并新增**月亮更新动画**：

- 动画触发条件：`weeklyPct` 或 `windowPct` 的实际数值发生变化（首次数据到达除外，直接显示数值）。
- 动画播放时长可通过设置 `aiStatusHub.updateAnimationDurationMs` 调整（默认 5000ms，范围 500–10000ms）。
- 动画帧间隔可通过设置 `aiStatusHub.updateAnimationIntervalMs` 调整（默认 300ms，范围 100–2000ms），控制月亮相位切换速度。
- 动画期间 `itemWeekly` 以 🌕🌖🌗🌘 循环播放，同时显示实时百分比，例如 `🌕 Kimi:25.0%`。`itemWindow`（5h 窗口）保持可见，继续正常显示。
- 动画播放期间若又有新数据变化，重置计时器继续播放，不重置帧索引。
- 动画结束后恢复完整正常显示（含迷你条、错误/估算指示器等）。
- `itemPause` 按钮在暂停状态下显示 🌕（表示休眠），活跃状态下显示 ⏸️。

**鉴权降级显示（v0.5.26 新增）**：

- 鉴权错误（`expired`/`failed`）不再无条件以红色全占显示，而是经 `calc.resolveAuthDisplayMode(state)` 三态判定：
  - `degraded`（有缓存 quota 或 localEstimate）：照常渲染用量百分比，`itemWeekly`/`itemWindow` 均附加 🔐 指示器，无错误背景色，`itemWindow` 保持可见；tooltip 顶部插入警告条 `🔐 令牌已过期，使用一次 Claude Code 后会自动恢复，或 [点击重新登录]`（`tooltip.authDegraded` + `tooltip.signInAction`，登录链接触发 `aiStatusHub.signIn`），下方照常显示用量表格。
  - `blocked`（完全无数据）：保留原有红色 `$(warning) auth expired/failed` 全占显示并隐藏 `itemWindow`；该分支现在也会更新 tooltip（含登录链接），修复了之前残留旧 tooltip 的问题。
  - `missing`（从未登录）行为不变，仍在三态判定之前单独短路。
- 背景：Claude OAuth token 仅在使用 Claude Code 时刷新，长期不用会良性过期；API 401 后 scheduler 回退本地数据，此时不应以错误状态遮蔽可用的用量信息。
- 指示器（💤/🌐/⛓️‍💥/🔐）统一由 `calc.buildIndicatorSuffix` 构建，动画期间同样生效。

```typescript
import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { computeUtilization, formatPercent, formatPercentPadded, fmtHours } from '../calc';
import { AppState } from '../types';

const STALE_THRESHOLD_MS = 120_000; // 2 minutes

function utilizationToColor(util: number): string {
  if (util < 0.20) return '#FFFFFF';
  if (util < 0.40) return '#FFFF80';
  if (util < 0.60) return '#00FF80';
  if (util < 0.80) return '#FF80FF';
  return '#FF0000';
}

export class StatusBarPresenter {
  private itemWeekly: vscode.StatusBarItem;
  private itemWindow: vscode.StatusBarItem;
  private itemPause: vscode.StatusBarItem;
  private config = ConfigService.getInstance();
  private disposables: vscode.Disposable[] = [];

  constructor(private store: Store) {
    const alignment = vscode.StatusBarAlignment.Right;

    this.itemWeekly = vscode.window.createStatusBarItem(alignment, 104);
    this.itemWeekly.name = 'AI Status Hub Weekly';
    this.itemWeekly.command = 'aiStatusHub.showDashboard';
    this.itemWeekly.text = '$(sync~spin) Kimi…';
    this.itemWeekly.show();

    this.itemWindow = vscode.window.createStatusBarItem(alignment, 103);
    this.itemWindow.name = 'AI Status Hub Window';
    this.itemWindow.command = 'aiStatusHub.refresh';
    this.itemWindow.show();

    this.itemPause = vscode.window.createStatusBarItem(alignment, 102);
    this.itemPause.name = 'AI Status Hub Pause';
    this.itemPause.command = 'aiStatusHub.togglePause';
    this.itemPause.text = '\u23F8\uFE0F';
    this.itemPause.show();

    const unsub = store.subscribe((state) => this.render(state));
    this.disposables.push({ dispose: unsub });

    // Initial render
    this.render(store.getState());
  }

  private render(state: AppState): void {
    try {
      // Pause item always visible
      this.itemPause.text = '\u23F8\uFE0F';
      this.itemPause.tooltip = state.ui.isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';

      // When paused, hide data items and show only pause button
      if (state.ui.isPaused) {
        this.itemWeekly.hide();
        this.itemWindow.hide();
        return;
      }

      if (state.authStatus === 'missing') {
        this.itemWeekly.text = '$(key) Kimi: sign in';
        this.itemWeekly.command = 'aiStatusHub.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWeekly.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.itemWindow.hide();
        return;
      }

      if (state.error && state.authStatus === 'failed') {
        this.itemWeekly.text = '$(warning) Kimi: auth failed';
        this.itemWeekly.command = 'aiStatusHub.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWindow.hide();
        return;
      }

      const hasApiData = !!state.quota;
      const hasEstimate = !!state.localEstimate;

      if (!hasApiData && !hasEstimate) {
        this.itemWeekly.text = '$(sync~spin) Kimi…';
        this.itemWeekly.backgroundColor = undefined;
        this.itemWindow.hide();
        return;
      }

      // Prefer API data; fallback to local estimate
      const weeklyPct = hasApiData ? state.quota!.weeklyUsedPct : state.localEstimate!.weeklyPct;
      const windowPct = hasApiData ? state.quota!.windowUsedPct : state.localEstimate!.windowPct;
      const weeklyUtil = weeklyPct / 100;
      const windowUtil = windowPct / 100;

      const isStale = state.lastSuccessfulFetchAt
        ? Date.now() - state.lastSuccessfulFetchAt > STALE_THRESHOLD_MS
        : !hasApiData;
      const staleIndicator = isStale ? ' \uD83D\uDCA4' : '';
      const estimateIndicator = !hasApiData && hasEstimate ? ' \uD83D\uDD0D' : ''; // 🔍 for estimate
      const errorIndicator = state.error && (state.error.includes('network') || state.error.includes('ECONN'))
        ? ' \u26D3\uFE0F\u200D\uD83D\uDCA5'
        : '';

      if (this.config.displayMode === 'absolute') {
        if (hasApiData) {
          this.itemWeekly.text = `\uD83C\uDF18 Kimi:${state.quota!.weeklyUsed}/${state.quota!.weeklyLimit}${errorIndicator}`;
          this.itemWindow.text = `5\uFE0F\u20E3 ${state.quota!.windowUsed}/${state.quota!.windowLimit}${staleIndicator}`;
        } else {
          this.itemWeekly.text = `\uD83C\uDF18 Kimi:~${Math.round(weeklyPct)}%${estimateIndicator}${errorIndicator}`;
          this.itemWindow.text = `5\uFE0F\u20E3 ~${Math.round(windowPct)}%${staleIndicator}`;
        }
      } else {
        this.itemWeekly.text = `\uD83C\uDF18 Kimi:${formatPercent(weeklyPct, 1)}${estimateIndicator}${errorIndicator}`;
        this.itemWindow.text = `5\uFE0F\u20E3 ${buildMiniBar(windowUtil, 5)} ${formatPercent(windowPct, 1)}${staleIndicator}`;
      }

      this.itemWeekly.command = 'aiStatusHub.showDashboard';
      this.itemWeekly.color = utilizationToColor(weeklyUtil);
      this.itemWindow.color = utilizationToColor(windowUtil);
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.show();
      this.itemWindow.show();

      // Tooltip: lazy build
      this.itemWeekly.tooltip = this.buildTooltip(state);
      this.itemWindow.tooltip = this.itemWeekly.tooltip;
    } catch (err) {
      console.error('StatusBar render error', err);
    }
  }

  private buildTooltip(state: AppState): vscode.MarkdownString {
    const locale = this.config.effectiveLanguage;
    const t = makeT(locale);
    const md = new vscode.MarkdownString();

    if (state.authStatus === 'missing') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.notLoggedIn')}\n\`\`\``);
      return md;
    }

    if (state.authStatus === 'failed') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.authFailed')}\n\`\`\``);
      return md;
    }

    const hasApiData = !!state.quota;
    const hasEstimate = !!state.localEstimate;

    if (!hasApiData && !hasEstimate) {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\nLoading…\n\`\`\``);
      return md;
    }

    const q = state.quota;
    const le = state.localEstimate;
    const weeklyPct = hasApiData ? q!.weeklyUsedPct : le!.weeklyPct;
    const windowPct = hasApiData ? q!.windowUsedPct : le!.windowPct;
    const weeklyUtil = weeklyPct / 100;
    const windowUtil = windowPct / 100;

    const weeklyBar = buildBar(weeklyUtil, 10);
    const windowBar = buildBar(windowUtil, 10);

    const weeklyReset = q && q.weeklyResetAt > Date.now()
      ? fmtHours((q.weeklyResetAt - Date.now()) / 3600000)
      : '?';
    const windowReset = q && q.windowResetAt > Date.now()
      ? fmtHours((q.windowResetAt - Date.now()) / 3600000)
      : '?';

    let sourceLabel = '';
    if (state.dataSource === 'stale') sourceLabel = ' ' + t('tooltip.stale');
    else if (state.dataSource === 'local-only') sourceLabel = ' (estimate)';

    md.appendMarkdown(`\`\`\`text\n`);
    md.appendMarkdown(`${t('tooltip.title')}${sourceLabel}\n`);
    md.appendMarkdown(`${'─'.repeat(29)}\n`);
    md.appendMarkdown(`${t('tooltip.window5h')}  ${formatPercentPadded(windowPct, 2)} [${windowBar}] ${t('tooltip.resetsIn')} ${windowReset}\n`);
    md.appendMarkdown(`${t('tooltip.window7d')}  ${formatPercentPadded(weeklyPct, 2)} [${weeklyBar}] ${t('tooltip.resetsIn')} ${weeklyReset}\n\n`);

    if (q) {
      md.appendMarkdown(`${t('tooltip.table.col.used')} | ${t('tooltip.table.col.limit')} | ${t('tooltip.table.col.remaining')}\n`);
      md.appendMarkdown(`5h: ${q.windowUsed} | ${q.windowLimit} | ${q.windowRemaining}\n`);
      md.appendMarkdown(`7d: ${q.weeklyUsed} | ${q.weeklyLimit} | ${q.weeklyLimit - q.weeklyUsed}\n`);
      if (q.parallelLimit) {
        md.appendMarkdown(`\nParallel: ${q.parallelLimit}\n`);
      }
    }

    md.appendMarkdown(`\n${t('tooltip.lastUpdate')} ${state.lastFetchAt ? new Date(state.lastFetchAt).toLocaleString() : '—'}\n`);
    md.appendMarkdown(`\`\`\``);

    return md;
  }

  dispose(): void {
    this.itemWeekly.dispose();
    this.itemWindow.dispose();
    this.itemPause.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}

function buildBar(util: number, width: number): string {
  const safe = Math.max(0, Math.min(1, isFinite(util) ? util : 0));
  const filled = Math.round(safe * width);
  return '\u25B0'.repeat(filled) + '\u25B1'.repeat(width - filled);
}

function buildMiniBar(util: number, width = 5): string {
  return buildBar(util, width);
}
```

> **v0.5.22 修复**：`render()` 与 `buildTooltip()` 现在处理 `authStatus === 'expired'`（由 401 触发），显示 `auth expired` 红色警告并提供重新登录入口。

---

## 11. presenters/dashboard.ts

Phase 2 扩展以支持 local-only 模式下的估算显示与 source label：

```typescript
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { formatPercent, fmtHours } from '../calc';

export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];

  private constructor(private store: Store) {
    const nonce = crypto.randomBytes(16).toString('hex');
    const config = ConfigService.getInstance();
    const locale = config.effectiveLanguage;
    const i18n = makeT(locale);

    this.panel = vscode.window.createWebviewPanel(
      'aiStatusHubDashboard',
      i18n('dashboard.title'),
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml(nonce, locale);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    const unsub = store.subscribe((state) => this.sendUpdate(state));
    this.disposables.push({ dispose: unsub });

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static createOrShow(store: Store): void {
    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    DashboardPanel.instance = new DashboardPanel(store);
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.sendUpdate(this.store.getState());
        break;
      case 'refresh':
        vscode.commands.executeCommand('aiStatusHub.refresh');
        break;
      case 'toggleMode': {
        const next = ConfigService.getInstance().displayMode === 'percent' ? 'absolute' : 'percent';
        void ConfigService.getInstance().setDisplayMode(next);
        break;
      }
      case 'toggleLanguage': {
        const nextLang = ConfigService.getInstance().effectiveLanguage === 'zh-CN' ? 'en' : 'zh-CN';
        void ConfigService.getInstance().setLanguage(nextLang);
        break;
      }
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.ai-status-hub');
        break;
    }
  }

  private sendUpdate(state: import('../types').AppState): void {
    if (!this.panel.visible) return;
    this.panel.webview.postMessage({ type: 'update', state });
  }

  private getHtml(nonce: string, locale: string): string {
    const isZh = locale === 'zh-CN';
    const i18n = makeT(locale as any);
    return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>${i18n('dashboard.title')}</title>
  <style>
    * { box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-font-size);
      padding: 16px; margin: 0;
    }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 1.2em; font-weight: 600; }
    .header-actions { display: flex; gap: 8px; }
    button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 0.9em;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    .card {
      background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 4px; padding: 12px 16px; margin-bottom: 12px;
    }
    .card-title { font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin: 0 0 10px 0; }
    .progress-row { margin-bottom: 10px; }
    .progress-labels { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.9em; }
    .progress-meta { color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 2px; }
    .progress-track { height: 8px; background: var(--vscode-scrollbarSlider-background); border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 4px; background: var(--vscode-progressBar-background); transition: width 0.3s ease; }
    .progress-fill.warning { background: var(--vscode-editorWarning-foreground); }
    .progress-fill.error { background: var(--vscode-editorError-foreground); }
    .footer { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 8px; }
    .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; }
    .estimate-badge { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-left: 4px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinning { display: inline-block; animation: spin 1s linear infinite; }
  </style>
</head>
<body>
  <div class="header">
    <h1>${i18n('dashboard.title')}</h1>
    <div class="header-actions">
      <button id="btn-refresh">${i18n('dashboard.refresh')}</button>
      <button id="btn-toggle">${i18n('dashboard.toggleMode')}</button>
      <button id="btn-lang">&#127760; ${isZh ? 'EN' : '中'}</button>
      <button id="btn-settings">&#9881;</button>
    </div>
  </div>

  <div class="card">
    <div class="card-title">${i18n('dashboard.currentUsage')}</div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>5h window<span id="badge-5h" class="estimate-badge"></span></span>
        <span id="lbl-5h">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-5h" style="width:0%"></div></div>
      <div class="progress-meta" id="meta-5h"></div>
    </div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>7d window<span id="badge-7d" class="estimate-badge"></span></span>
        <span id="lbl-7d">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-7d" style="width:0%"></div></div>
      <div class="progress-meta" id="meta-7d"></div>
    </div>
  </div>

  <div class="footer" id="footer">—</div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-toggle').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleMode' });
    });
    document.getElementById('btn-lang').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleLanguage' });
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });

    window.addEventListener('message', (event) => {
      const msg = event.data;
      if (msg.type !== 'update') return;
      const state = msg.state;
      const quota = state.quota;
      const estimate = state.localEstimate;

      const hasApi = !!quota;
      const hasEstimate = !!estimate;

      if (!hasApi && !hasEstimate) {
        document.getElementById('lbl-5h').textContent = 'Loading…';
        document.getElementById('lbl-7d').textContent = 'Loading…';
        return;
      }

      const w5h = Math.min(100, hasApi ? (quota.windowUsedPct || 0) : (estimate.windowPct || 0));
      const w7d = Math.min(100, hasApi ? (quota.weeklyUsedPct || 0) : (estimate.weeklyPct || 0));

      const fill5h = document.getElementById('fill-5h');
      fill5h.style.width = w5h + '%';
      fill5h.className = 'progress-fill' + (w5h >= 75 ? ' warning' : '');
      document.getElementById('lbl-5h').textContent = w5h.toFixed(1) + '%';
      document.getElementById('badge-5h').textContent = hasApi ? '' : ' (estimate)';

      const fill7d = document.getElementById('fill-7d');
      fill7d.style.width = w7d + '%';
      fill7d.className = 'progress-fill' + (w7d >= 75 ? ' warning' : '');
      document.getElementById('lbl-7d').textContent = w7d.toFixed(1) + '%';
      document.getElementById('badge-7d').textContent = hasApi ? '' : ' (estimate)';

      function fmtReset(ms) {
        if (!ms || ms <= Date.now()) return '';
        const totalSeconds = Math.max(0, Math.floor((ms - Date.now()) / 1000));
        const days = Math.floor(totalSeconds / 86400);
        const hours = Math.floor((totalSeconds % 86400) / 3600);
        const mins = Math.floor((totalSeconds % 3600) / 60);
        const secs = totalSeconds % 60;
        const pad2 = (n) => String(n).padStart(2, ' ');
        if (days > 0) return 'resets in ' + pad2(days) + 'd' + pad2(hours) + 'h';
        if (hours > 0) return 'resets in ' + pad2(hours) + 'h' + pad2(mins) + 'm';
        if (mins > 0) return 'resets in ' + pad2(mins) + 'm' + pad2(secs) + 's';
        return 'resets in ' + pad2(secs) + 's';
      }

      document.getElementById('meta-5h').textContent = quota ? fmtReset(quota.windowResetAt) : '';
      document.getElementById('meta-7d').textContent = quota ? fmtReset(quota.weeklyResetAt) : '';

      const age = state.lastFetchAt
        ? Math.max(0, Math.floor((Date.now() - state.lastFetchAt) / 1000))
        : 0;
      const ageStr = age < 60 ? 'just now' : Math.floor(age / 60) + 'm ago';
      const sourceLabel = state.dataSource === 'local-only' ? ' · local estimate' : '';
      document.getElementById('footer').textContent = 'Last updated: ' + ageStr + sourceLabel;
    });

    // Notify extension that webview is ready to receive initial state
    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }

  private dispose(): void {
    DashboardPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
```

---

## 12. 测试覆盖

Phase 2 新增测试断言（参考 `test/` 目录已有测试风格）：

| 测试文件 | 断言描述 |
|---|---|
| `calc.test.ts` | `calibrateTokenCapacity` 在 apiWeeklyUsedPct=50, localTokens=5000 时返回 10000 |
| `calc.test.ts` | `calibrateTokenCapacity` 在 apiWeeklyUsedPct=0 时返回 null |
| `calc.test.ts` | `calibrateWindowCostCapacity` 在 apiWindowUsedPct=25, localCost5h=10 时返回 40 |
| `calc.test.ts` | `estimateWeeklyPct` 在 tokenCapacity=10000, localTokens=2500 时返回 25 |
| `calc.test.ts` | `estimateWeeklyPct` 在 tokenCapacity=null 时返回 null |
| `calc.test.ts` | `fallbackWeeklyPct` 在 weeklyLimit=10000, localTokens=5000 时返回 50 |
| `calc.test.ts` | `fallbackWindowPct` 在 windowLimit=40, localCost5h=10 时返回 25 |
| `calc.test.ts` | `isCalibrationValid` 在 resetAt 匹配且 7 天内返回 true |
| `calc.test.ts` | `isCalibrationValid` 在 resetAt 不匹配时返回 false |
| `calc.test.ts` | `safeEstimate` 在 estimateFn 返回 null 时回退到 fallbackFn |
| `store.test.ts` | `LOCAL_ESTIMATE` action 合并 payload 到现有 localEstimate |
| `store.test.ts` | `LOCAL_ESTIMATE` action 在无 quota 时将 dataSource 升级为 `local-only` |
| `cacheService.test.ts` | `write` 和 `read` 能正确序列化/反序列化含 calibration 的 CachedData |
| `scheduler.test.ts` | `doShortTick`  dispatch `LOCAL_ESTIMATE` 且不使用 API |
| `scheduler.test.ts` | `doLongTick` 成功后写入含 calibration 的缓存 |
| `calc.test.ts` | `resolveAuthDisplayMode` 在 expired+有数据时返回 `degraded`，无数据时返回 `blocked`，无鉴权错误时返回 `normal`（v0.5.26） |
| `calc.test.ts` | `buildIndicatorSuffix` 按 stale→source→auth 固定顺序拼接指示器，且遵循 `parts` 过滤（v0.5.26） |
| `statusBar.test.ts` | 鉴权过期但有缓存数据时照常显示百分比 + 🔐，无错误背景，`itemWindow` 可见（v0.5.26） |
| `statusBar.test.ts` | 鉴权过期且无任何数据时显示红色 `auth expired` 并隐藏 `itemWindow`（v0.5.26） |

---

## 13. 与 Phase 1 的关键差异

| 维度 | Phase 1 | Phase 2 |
|---|---|---|
| **Scheduler** | 单一 `setTimeout` 链，60s 固定间隔 | short/long 双 tick（5s / 60s） |
| **数据来源** | 仅 API + 缓存恢复 | API + 本地 JSONL 扫描估算 |
| **Token 聚合** | 无 | `localUsageService` 扫描 `~/.kimi/sessions/**/wire.jsonl` |
| **容量校准** | 无 | `calibrateTokenCapacity` / `calibrateWindowCostCapacity` |
| **状态字段** | `AppState` 无 `localEstimate` | 新增 `localEstimate: LocalEstimate \| null` |
| **缓存格式** | `CachedData = { quota, fetchedAt }` | 扩展 `calibration?: CalibrationData` |
| **UI 显示** | 仅 API 数据 | 无 API 时 fallback 到本地估算（🔍 标记） |
| **Dashboard** | 纯 API 数据进度条 | 支持 estimate badge 与 `local-only` source label |
| **Action 类型** | `LOCAL_ESTIMATE` payload 为 `{ weeklyPct, windowPct }` | payload 扩展为 `Partial<LocalEstimate>` |
| **登出行为** | `authService.invalidate()` + `SIGN_OUT` | 额外 `localUsageService.invalidate()` |

---

**文档结束**

---

## 7. services/scheduler.ts

```typescript
// 💠 Generic: scheduler logic is provider-agnostic.

import { Store } from '../store';
import { AuthService } from './authService';
import { ApiService } from './apiService';
import { CacheService } from './cacheService';
import { LocalUsageService } from './localUsageService';
import { ConfigService } from '../config';
import { log } from '../utils';
import {
  calibrateTokenCapacity,
  calibrateWindowCostCapacity,
  estimateWeeklyPct,
  estimateWindowPct,
  fallbackWeeklyPct,
  fallbackWindowPct,
  isCalibrationValid,
} from '../calc';

const SHORT_MS = 5_000;
const LONG_MS = 60_000;

export class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private lastLongTick = 0;
  private readonly config = ConfigService.getInstance();

  constructor(
    private store: Store,
    private authService: AuthService,
    private apiService: ApiService,
    private cacheService: CacheService,
    private localUsageService: LocalUsageService,
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    // Ensure first tick is a long tick so we fetch API data immediately
    this.lastLongTick = Date.now() - LONG_MS;
    // First tick after 100ms (let UI render first)
    this.schedule(Date.now() + 100);
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** Manual refresh: cancel current wait and execute immediately. */
  force(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.schedule(Date.now() + 50);
  }

  private schedule(at: number): void {
    if (!this.running) return;
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const isLong = now - this.lastLongTick >= LONG_MS;

    try {
      if (isLong) {
        await this.doLongTick();
        this.lastLongTick = now;
      } else {
        await this.doShortTick();
      }
    } catch (err) {
      log(`Scheduler tick error: ${err}`);
    }

    // Schedule next tick: whichever comes first (short or long)
    const nextLong = this.lastLongTick + LONG_MS;
    const nextShort = now + SHORT_MS;
    this.schedule(Math.min(nextLong, nextShort));
  }

  private async doShortTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    const state = this.store.getState();
    const quota = state.quota;

    const localUsage = await this.localUsageService.getLocalUsage({
      weeklyResetAtMs: quota?.weeklyResetAt,
      windowResetAtMs: quota?.windowResetAt,
    });

    const calibration = state.localEstimate
      ? {
          tokenCapacity: state.localEstimate.tokenCapacity,
          windowCostCapacity: state.localEstimate.windowCostCapacity,
          calibratedAt: state.localEstimate.calibratedAt ?? 0,
          resetAt: quota?.weeklyResetAt ?? 0,
        }
      : null;

    const tokenCapacity = isCalibrationValid(calibration, quota?.weeklyResetAt ?? null)
      ? calibration!.tokenCapacity
      : null;
    const windowCostCapacity = isCalibrationValid(
      calibration ? { ...calibration, resetAt: quota?.windowResetAt ?? 0 } : null,
      quota?.windowResetAt ?? null,
    )
      ? calibration!.windowCostCapacity
      : null;

    const weeklyPct = estimateWeeklyPct(localUsage.tokensThisCycle, tokenCapacity)
      ?? fallbackWeeklyPct(localUsage.tokensThisCycle, quota?.weeklyLimit ?? null);
    const windowPct = estimateWindowPct(localUsage.cost5h, windowCostCapacity)
      ?? fallbackWindowPct(localUsage.cost5h, quota?.windowLimit ?? null);

    this.store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: { weeklyPct, windowPct },
    });
  }

  private async doLongTick(): Promise<void> {
    if (this.store.getState().ui.isPaused) {
      return;
    }

    this.store.dispatch({ type: 'LOADING_START' });

    const token = await this.authService.resolveToken();
    if (!token) {
      this.store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
      this.store.dispatch({ type: 'LOADING_END' });
      return;
    }

    const result = await this.apiService.fetchQuota(token);

    if (result.ok && result.data) {
      const apiData = result.data;

      // Read local data for calibration
      const localUsage = await this.localUsageService.getLocalUsage({
        weeklyResetAtMs: apiData.weeklyResetAt,
        windowResetAtMs: apiData.windowResetAt,
      });

      // Calibrate
      const tokenCapacity = calibrateTokenCapacity(apiData.weeklyUsedPct, localUsage.tokensThisCycle);
      const windowCostCapacity = calibrateWindowCostCapacity(apiData.windowUsedPct, localUsage.cost5h);

      // Write cache with calibration
      await this.cacheService.write({
        quota: apiData,
        fetchedAt: Date.now(),
        calibration: {
          tokenCapacity,
          windowCostCapacity,
          calibratedAt: Date.now(),
          reset5hAt: apiData.windowResetAt,
          reset7dAt: apiData.weeklyResetAt,
        },
      });

      this.store.dispatch({ type: 'API_SUCCESS', payload: apiData });
      this.store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          weeklyPct: apiData.weeklyUsedPct,
          windowPct: apiData.windowUsedPct,
          tokenCapacity,
          windowCostCapacity,
          calibratedAt: Date.now(),
        },
      });
    } else {
      this.store.dispatch({
        type: 'API_ERROR',
        payload: { error: result.error ?? 'Unknown error', authFailed: result.authFailed, networkError: result.networkError },
      });

      // Fallback to cache
      const cached = await this.cacheService.read();
      if (cached) {
        this.store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
        if (cached.calibration) {
          this.store.dispatch({
            type: 'LOCAL_ESTIMATE',
            payload: {
              tokenCapacity: cached.calibration.tokenCapacity,
              windowCostCapacity: cached.calibration.windowCostCapacity,
              calibratedAt: cached.calibration.calibratedAt,
            },
          });
        }
      }
    }

    this.store.dispatch({ type: 'LOADING_END' });
  }
}
```

---

## 8. services/cacheService.ts

```typescript
// 💠 Generic: cache schema is provider-agnostic.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CachedData } from '../types';

const CACHE_DIR = path.join(os.homedir(), '.kimi');
const CACHE_FILE = path.join(CACHE_DIR, 'ai-status-hub-cache-v2.json');
const SCHEMA = 'ai-status-hub-cache-v2';
const CURRENT_VERSION = 2;

export class CacheService {
  private static instance: CacheService;
  private cacheFile: string;

  static getInstance(): CacheService {
    if (!CacheService.instance) { CacheService.instance = new CacheService(); }
    return CacheService.instance;
  }

  constructor(cacheFile?: string) {
    this.cacheFile = cacheFile ?? CACHE_FILE;
  }

  async read(): Promise<CachedData | null> {
    try {
      const raw = await fs.readFile(this.cacheFile, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== SCHEMA || parsed.version !== CURRENT_VERSION) {
        return null;
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async write(data: CachedData): Promise<void> {
    const payload = {
      version: CURRENT_VERSION,
      schema: SCHEMA,
      writtenAt: new Date().toISOString(),
      data,
    };
    try {
      await fs.mkdir(path.dirname(this.cacheFile), { recursive: true });
      await fs.writeFile(this.cacheFile, JSON.stringify(payload, null, 2));
    } catch {
      // ignore write errors
    }
  }

  async clear(): Promise<void> {
    try { await fs.unlink(this.cacheFile); } catch { /* ignore */ }
  }
}
```

---

## 9. extension.ts

```typescript
import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { AuthService } from './services/authService';
import { ApiService } from './services/apiService';
import { CacheService } from './services/cacheService';
import { LocalUsageService } from './services/localUsageService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, deleteApiKey, deleteOAuth } from './utils';

const PAUSE_STATE_KEY = 'aiStatusHub._pauseSignal';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('AI Status Hub v2 activated');

  const store = new Store();
  const config = ConfigService.getInstance();
  const authService = AuthService.getInstance();
  const apiService = ApiService.getInstance();
  const cacheService = CacheService.getInstance();
  const localUsageService = LocalUsageService.getInstance();

  authService.init(context.secrets);

  // 1. Restore pause state from globalState (cross-window sync)
  const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
  if (pausedFromGlobal) {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
  }

  // 2. Restore cache
  const cached = await cacheService.read();
  if (cached) {
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
    // Restore calibration
    if (cached.calibration) {
      store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          tokenCapacity: cached.calibration.tokenCapacity,
          windowCostCapacity: cached.calibration.windowCostCapacity,
          calibratedAt: cached.calibration.calibratedAt,
        },
      });
    }
  }

  // 3. Initialize Presenters
  const statusBar = new StatusBarPresenter(store);

  // 4. Start scheduler
  const scheduler = new Scheduler(store, authService, apiService, cacheService, localUsageService);
  scheduler.start();

  // 5. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aiStatusHub.refresh', () => {
      scheduler.force();
    }),
    vscode.commands.registerCommand('aiStatusHub.signIn', async () => {
      const success = await authService.startOAuthFlow();
      if (success) {
        scheduler.force();
      }
    }),
    vscode.commands.registerCommand('aiStatusHub.signOut', async () => {
      await deleteApiKey(context.secrets);
      await deleteOAuth(context.secrets);
      authService.invalidate();
      localUsageService.invalidate();
      store.dispatch({ type: 'SIGN_OUT' });
    }),
    vscode.commands.registerCommand('aiStatusHub.setApiKey', () => {
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('aiStatusHub.showDashboard', () => {
      DashboardPanel.createOrShow(store);
    }),
    vscode.commands.registerCommand('aiStatusHub.togglePause', async () => {
      const next = !store.getState().ui.isPaused;
      store.dispatch({ type: 'UI_SET_PAUSED', payload: next });
      await context.globalState.update(PAUSE_STATE_KEY, next);
      // Broadcast via configuration change so other windows pick it up
      const cfg = vscode.workspace.getConfiguration('aiStatusHub');
      await cfg.update('_pauseSignal', Date.now(), true);
    }),
  );

  // 6. Listen to configuration changes (including pause broadcast)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('aiStatusHub')) {
        store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
        store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });
        // Sync pause state from other windows via _pauseSignal broadcast
        if (e.affectsConfiguration('aiStatusHub._pauseSignal')) {
          const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
          const currentPaused = store.getState().ui.isPaused;
          if (pausedFromGlobal !== currentPaused) {
            store.dispatch({ type: 'UI_SET_PAUSED', payload: pausedFromGlobal });
          }
        }
      }
    })
  );

  // 7. Persist cache on deactivation via subscription disposal
  context.subscriptions.push(
    { dispose: () => { scheduler.stop(); statusBar.dispose(); } }
  );
}

export function deactivate(): void {
  log('AI Status Hub v2 deactivated');
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'AI Status Hub – Set API Key',
    prompt: 'Paste your Kimi API key (sk-...).',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
  });
  if (!value?.trim()) return;
  await writeApiKey(context.secrets, value.trim());
  void vscode.window.showInformationMessage('API key saved.');
}
```

---

## 10. presenters/statusBar.ts

```typescript
import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { computeUtilization, formatPercent, formatPercentPadded, fmtHours } from '../calc';
import { AppState } from '../types';

const STALE_THRESHOLD_MS = 120_000; // 2 minutes

function utilizationToColor(util: number): string {
  if (util < 0.20) return '#FFFFFF';
  if (util < 0.40) return '#FFFF80';
  if (util < 0.60) return '#00FF80';
  if (util < 0.80) return '#FF80FF';
  return '#FF0000';
}

export class StatusBarPresenter {
  private itemWeekly: vscode.StatusBarItem;
  private itemWindow: vscode.StatusBarItem;
  private itemPause: vscode.StatusBarItem;
  private config = ConfigService.getInstance();
  private disposables: vscode.Disposable[] = [];

  constructor(private store: Store) {
    const alignment = vscode.StatusBarAlignment.Right;

    this.itemWeekly = vscode.window.createStatusBarItem(alignment, 104);
    this.itemWeekly.name = 'AI Status Hub Weekly';
    this.itemWeekly.command = 'aiStatusHub.showDashboard';
    this.itemWeekly.text = '$(sync~spin) Kimi…';
    this.itemWeekly.show();

    this.itemWindow = vscode.window.createStatusBarItem(alignment, 103);
    this.itemWindow.name = 'AI Status Hub Window';
    this.itemWindow.command = 'aiStatusHub.refresh';
    this.itemWindow.show();

    this.itemPause = vscode.window.createStatusBarItem(alignment, 102);
    this.itemPause.name = 'AI Status Hub Pause';
    this.itemPause.command = 'aiStatusHub.togglePause';
    this.itemPause.text = '\u23F8\uFE0F';
    this.itemPause.show();

    const unsub = store.subscribe((state) => this.render(state));
    this.disposables.push({ dispose: unsub });

    // Initial render
    this.render(store.getState());
  }

  private render(state: AppState): void {
    try {
      // Pause item always visible
      this.itemPause.text = '\u23F8\uFE0F';
      this.itemPause.tooltip = state.ui.isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';

      // When paused, hide data items and show only pause button
      if (state.ui.isPaused) {
        this.itemWeekly.hide();
        this.itemWindow.hide();
        return;
      }

      if (state.authStatus === 'missing') {
        this.itemWeekly.text = '$(key) Kimi: sign in';
        this.itemWeekly.command = 'aiStatusHub.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWeekly.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.itemWindow.hide();
        return;
      }

      if (state.error && state.authStatus === 'failed') {
        this.itemWeekly.text = '$(warning) Kimi: auth failed';
        this.itemWeekly.command = 'aiStatusHub.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWindow.hide();
        return;
      }

      const hasApiData = !!state.quota;
      const hasEstimate = !!state.localEstimate;

      if (!hasApiData && !hasEstimate) {
        this.itemWeekly.text = '$(sync~spin) Kimi…';
        this.itemWeekly.backgroundColor = undefined;
        this.itemWindow.hide();
        return;
      }

      // Prefer API data; fallback to local estimate
      const weeklyPct = hasApiData ? state.quota!.weeklyUsedPct : state.localEstimate!.weeklyPct;
      const windowPct = hasApiData ? state.quota!.windowUsedPct : state.localEstimate!.windowPct;
      const weeklyUtil = weeklyPct / 100;
      const windowUtil = windowPct / 100;

      const isStale = state.lastSuccessfulFetchAt
        ? Date.now() - state.lastSuccessfulFetchAt > STALE_THRESHOLD_MS
        : !hasApiData;
      const staleIndicator = isStale ? ' \uD83D\uDCA4' : '';
      const estimateIndicator = !hasApiData && hasEstimate ? ' \uD83D\uDD0D' : ''; // 🔍 for estimate
      const errorIndicator = state.error && (state.error.includes('network') || state.error.includes('ECONN'))
        ? ' \u26D3\uFE0F\u200D\uD83D\uDCA5'
        : '';

      if (this.config.displayMode === 'absolute') {
        if (hasApiData) {
          this.itemWeekly.text = `\uD83C\uDF18 Kimi:${state.quota!.weeklyUsed}/${state.quota!.weeklyLimit}${errorIndicator}`;
          this.itemWindow.text = `5\uFE0F\u20E3 ${state.quota!.windowUsed}/${state.quota!.windowLimit}${staleIndicator}`;
        } else {
          this.itemWeekly.text = `\uD83C\uDF18 Kimi:~${Math.round(weeklyPct)}%${estimateIndicator}${errorIndicator}`;
          this.itemWindow.text = `5\uFE0F\u20E3 ~${Math.round(windowPct)}%${staleIndicator}`;
        }
      } else {
        this.itemWeekly.text = `\uD83C\uDF18 Kimi:${formatPercent(weeklyPct, 1)}${estimateIndicator}${errorIndicator}`;
        this.itemWindow.text = `5\uFE0F\u20E3 ${buildMiniBar(windowUtil, 5)} ${formatPercent(windowPct, 1)}${staleIndicator}`;
      }

      this.itemWeekly.command = 'aiStatusHub.showDashboard';
      this.itemWeekly.color = utilizationToColor(weeklyUtil);
      this.itemWindow.color = utilizationToColor(windowUtil);
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.show();
      this.itemWindow.show();

      // Tooltip: lazy build
      this.itemWeekly.tooltip = this.buildTooltip(state);
      this.itemWindow.tooltip = this.itemWeekly.tooltip;
    } catch (err) {
      console.error('StatusBar render error', err);
    }
  }

  private buildTooltip(state: AppState): vscode.MarkdownString {
    const locale = this.config.effectiveLanguage;
    const t = makeT(locale);
    const md = new vscode.MarkdownString();

    if (state.authStatus === 'missing') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.notLoggedIn')}\n\`\`\``);
      return md;
    }

    if (state.authStatus === 'failed') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.authFailed')}\n\`\`\``);
      return md;
    }

    const hasApiData = !!state.quota;
    const hasEstimate = !!state.localEstimate;

    if (!hasApiData && !hasEstimate) {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\nLoading…\n\`\`\``);
      return md;
    }

    const q = state.quota;
    const le = state.localEstimate;
    const weeklyPct = hasApiData ? q!.weeklyUsedPct : le!.weeklyPct;
    const windowPct = hasApiData ? q!.windowUsedPct : le!.windowPct;
    const weeklyUtil = weeklyPct / 100;
    const windowUtil = windowPct / 100;

    const weeklyBar = buildBar(weeklyUtil, 10);
    const windowBar = buildBar(windowUtil, 10);

    const weeklyReset = q && q.weeklyResetAt > Date.now()
      ? fmtHours((q.weeklyResetAt - Date.now()) / 3600000)
      : '?';
    const windowReset = q && q.windowResetAt > Date.now()
      ? fmtHours((q.windowResetAt - Date.now()) / 3600000)
      : '?';

    let sourceLabel = '';
    if (state.dataSource === 'stale') sourceLabel = ' ' + t('tooltip.stale');
    else if (state.dataSource === 'local-only') sourceLabel = ' (estimate)';

    md.appendMarkdown(`\`\`\`text\n`);
    md.appendMarkdown(`${t('tooltip.title')}${sourceLabel}\n`);
    md.appendMarkdown(`${'─'.repeat(29)}\n`);
    md.appendMarkdown(`${t('tooltip.window5h')}  ${formatPercentPadded(windowPct, 2)} [${windowBar}] ${t('tooltip.resetsIn')} ${windowReset}\n`);
    md.appendMarkdown(`${t('tooltip.window7d')}  ${formatPercentPadded(weeklyPct, 2)} [${weeklyBar}] ${t('tooltip.resetsIn')} ${weeklyReset}\n\n`);

    if (q) {
      md.appendMarkdown(`${t('tooltip.table.col.used')} | ${t('tooltip.table.col.limit')} | ${t('tooltip.table.col.remaining')}\n`);
      md.appendMarkdown(`5h: ${q.windowUsed} | ${q.windowLimit} | ${q.windowRemaining}\n`);
      md.appendMarkdown(`7d: ${q.weeklyUsed} | ${q.weeklyLimit} | ${q.weeklyLimit - q.weeklyUsed}\n`);
      if (q.parallelLimit) {
        md.appendMarkdown(`\nParallel: ${q.parallelLimit}\n`);
      }
    }

    md.appendMarkdown(`\n${t('tooltip.lastUpdate')} ${state.lastFetchAt ? new Date(state.lastFetchAt).toLocaleString() : '—'}\n`);
    md.appendMarkdown(`\`\`\``);

    return md;
  }

  dispose(): void {
    this.itemWeekly.dispose();
    this.itemWindow.dispose();
    this.itemPause.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}

function buildBar(util: number, width: number): string {
  const safe = Math.max(0, Math.min(1, isFinite(util) ? util : 0));
  const filled = Math.round(safe * width);
  return '\u25B0'.repeat(filled) + '\u25B1'.repeat(width - filled);
}

function buildMiniBar(util: number, width = 5): string {
  return buildBar(util, width);
}
```

---

## 11. presenters/dashboard.ts

Phase 1 基础结构不变，以下为 Phase 2 新增/修改部分的关键差异：

- WebView `sendUpdate` 推送完整 `AppState`（含 `localEstimate`）
- JavaScript 渲染逻辑优先使用 `quota`，无 `quota` 时 fallback 到 `state.localEstimate`
- 新增 `.estimate-badge` CSS 类，无 API 数据时显示 `(estimate)`
- footer 显示 `local-only` 数据源标记

完整文件见实际源码 `src/presenters/dashboard.ts`。

---

## 12. 测试覆盖

Phase 2 新增 21 个测试，全部通过。

### `test/calc.test.ts` 新增测试

```typescript
describe('calibrateTokenCapacity', () => {
  it('calculates capacity from API pct and local tokens', () => {
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
    const cap = calibrateWindowCostCapacity(30, 45.67);
    expect(cap).to.be.closeTo(152.23, 0.01);
  });
  it('returns null for zero API pct', () => {
    expect(calibrateWindowCostCapacity(0, 45.67)).to.be.null;
  });
});

describe('estimateWeeklyPct', () => {
  it('estimates percentage from local tokens and capacity', () => {
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
    const old = Date.now() - 8 * 24 * 3600 * 1000;
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
```

### `test/store.test.ts` 新增测试

```typescript
it('LOCAL_ESTIMATE sets localEstimate fields', () => {
  const store = new Store();
  store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 62.5, windowPct: 30.1 } });
  const s = store.getState();
  expect(s.localEstimate).to.not.be.null;
  expect(s.localEstimate!.weeklyPct).to.equal(62.5);
  expect(s.localEstimate!.windowPct).to.equal(30.1);
  expect(s.dataSource).to.equal('local-only');
});

it('LOCAL_ESTIMATE merges with existing estimate', () => {
  const store = new Store();
  store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 50, windowPct: 20, tokenCapacity: 1000 } });
  store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { windowPct: 25 } });
  expect(store.getState().localEstimate!.weeklyPct).to.equal(50);
  expect(store.getState().localEstimate!.windowPct).to.equal(25);
  expect(store.getState().localEstimate!.tokenCapacity).to.equal(1000);
});

it('LOCAL_ESTIMATE does not change dataSource when quota exists', () => {
  const store = new Store();
  store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
  store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 70 } });
  expect(store.getState().dataSource).to.equal('api');
});
```

### `test/scheduler.test.ts` 修改

- 构造函数增加 `LocalUsageService` 参数
- `beforeEach` 中 stub `localUsageService.getLocalUsage` 返回空聚合
- `afterEach` 中重置 `LocalUsageService.instance`
- `start()` 后首次 tick 强制为 long tick（`lastLongTick = Date.now() - LONG_MS`）

---

## 13. 与 Phase 1 的关键差异

| 维度 | Phase 1 | Phase 2 |
|---|---|---|
| **定时器** | 单一 long tick（60s） | short（5s）+ long（60s）双 tick |
| **本地文件扫描** | 空壳，返回全 0 | 完整 JSONL 扫描，多窗口聚合，fileStates 增量更新 |
| **校准** | 无 | API 成功时自动校准 token/cost 容量 |
| **估算** | 无 | short tick 基于校准值估算百分比 |
| **缓存** | quota + fetchedAt | 新增 calibration 字段 |
| **状态栏** | 仅 API 数据 | 无 API 时 fallback 到估算，显示 🔍 |
| **仪表盘** | 仅 API 数据 | 无 API 时显示估算进度条 + `(estimate)` 徽章 |
| **数据源** | `api` / `cache` / `no-data` | 新增 `local-only`、`stale` |
| **测试数** | 41 | 62（+21） |

---

---

## 14. API 调用历史记录 (ApiHistory) — v0.5.4 新增

### 14.1 目的

保存最近 N 次 API 调用和短周期估算结果，用于离线评估线性增量模型 (`ILinearEstimator`) 的估算准确性。

### 14.2 数据模型 (`EstHistoryEntry`)

```typescript
interface EstHistoryEntry {
  timestamp: number;            // 原始整数时间戳（ms）
  source: 'api' | 'short';      // 数据来源
  apiWeeklyPct: number | null;  // API 返回的 7d 百分比（ground truth；short 时为 null）
  apiWindowPct: number | null;  // API 返回的 5h 百分比（ground truth；short 时为 null）
  estimatedWeeklyPct: number;   // 本地估算的 7d 百分比
  estimatedWindowPct: number;   // 本地估算的 5h 百分比
  localCost7d: number;          // 当前 7d 本地费用（c）
  localCost5h: number;          // 当前 5h 本地费用（c）
  weeklyP: number;              // 校准快照 P
  weeklyC: number;              // 校准快照 C
  weeklyK: number;              // 7d 模型 k 值
  windowP: number;
  windowC: number;
  windowK: number;              // 5h 模型 k 值
}
```

### 14.3 状态管理

- `AppState.estHistory: EstHistoryEntry[]` — 内存滑动窗口（FIFO）
- `API_HISTORY` action：追加单条，reducer 内根据 `maxEntries` 淘汰最早
- `API_HISTORY_LOAD` action：启动时从磁盘批量加载

### 14.4 磁盘持久化 (`ApiHistoryService`)

- 文件：`~/.codex/ai-status-hub-est-history-{provider}.jsonl`
- 格式：每行一个 `JSON.stringify(EstHistoryEntry)`
- 写入时机：`extension.ts` `deactivate()` 时（当 `apiHistoryPersistOnExit` 为 true）
- 读取时机：`extension.ts` `activate()` 时，加载后通过 `API_HISTORY_LOAD` 注入 store
- `SIGN_OUT` 保留 `apiHistory`（切换 provider 时历史应保留）

### 14.5 配置项

| 配置键 | 类型 | 默认值 | 范围 |
|---|---|---|---|
| `aiStatusHub.apiHistoryMaxEntries` | number | 10000 | 1–100000 |
| `aiStatusHub.apiHistoryPersistOnExit` | boolean | false | — |

### 14.6 数据来源

`Scheduler.doLongTick()` API 成功分支末尾和 `doShortTick()` 末尾均追加：

```typescript
this.store.dispatch({
  type: 'API_HISTORY',
  payload: {
    maxEntries: config.apiHistoryMaxEntries,
    entry: { timestamp: Math.round(now), apiWeeklyPct, apiWindowPct, ... },
  },
});
```

---

*文档结束。Phase 2 已实现并通过全部 62 个测试。*

### 定价配置核验（2026-10-25）

`src/config.ts` 保留 customModels → Provider 专属 → 全局 → fallback 的价格优先级。官方日期默认值更新为 2026-10-25；Codex 官方链接指向 OpenAI API 定价文档，Kimi 指向开放平台定价，避免跳转订阅套餐页。新增模型配置键及四项费率见 [Provider 定价设计](v2-provider-abstraction.md#claude-pricing)。

### 多 Provider 运行实例（0.6.0，2026-10-25）

`extension.ts` 按 Provider 保存独立运行实例：Provider、Store、CacheService、LocalUsageService、ApiHistoryService、Scheduler 及可选 StatusBarPresenter。扩展入口只调用服务读写缓存及历史，不增加直接文件 IO。每个服务实例固定归属一个 Provider；不同 Provider 的异步任务不会再依赖修改同一服务的 Provider ID。

选择变更和命令通过 Promise 队列串行执行。初始化时恢复每个 Provider 的历史、quota 及校准参数，已选或当前查看模型才启动调度器；其他调度器停止。记录 started 状态，避免重复 start 或重建服务。退出时逐一停止调度器并持久化各模型窗口锚点、历史。

`ConfigService.getPricing(modelName, providerId?)` 增加可选显式 Provider 参数，三家价格 Provider 始终传入自己的 ID；后台价格解析不受当前仪表盘上下文影响。`currencyForProvider()` 同样支持显式 Provider，并保留用户 currency 覆盖。`statusBar.providers` 自 0.6.4 起在未设置或显式空数组时均默认 Kimi。

`StatusBarPresenter` 每个模型只有一个 cell；整项文本由 calc 生成，整项颜色取周剩余额度。tooltip 和主点击带 Provider 参数，暂停/缺失登录/认证失败时仍可打开对应仪表盘。销毁后忽略异步 tooltip 回调，清理订阅与动画计时器。双语认证状态通过 makeT 获取。

内存估算：不增加每条 UsageEntry 字段或副本镜像；Dashboard 直接绑定目标 Store。三个真实数据 Provider 按编码规范样本估算，365 天有效用量年均约 3×22.6=67.8MB，单日峰值折年约 3×86.3=258.9MB，分别低于 200MB/400MB；GLM/Cursor 当前无真实日志条目。各 Store 继续受 dataRetentionDays 限制，实际内存仍依数据量而异；仪表盘内存明细针对当前 Provider。

### 状态栏勾选的设置注册兼容（0.6.1）

`ConfigService.initializeSelectionStorage(context.globalState)` 在激活时注入扩展持久存储，停用时解除引用。`setStatusBarProviders()` 返回保存结果：正常配置写入失败时尝试 globalState，以 `aiStatusHub.statusBar.providers` 为键保存，getter 优先读取尚未迁移的降级选择；正常写入成功后清理降级键。自 0.6.4 起显式空数组回退为 Kimi，保留状态栏入口。

`extension.ts` 注册内部命令 `aiStatusHub.syncStatusBars`，使用已有 Promise 队列运行 reconcile。Dashboard 每次 checkbox 保存成功后显式等待该命令完成，再回传确认选择，解决设置未注册时既无法持久化、又不会触发配置变更事件的问题。配置事件路径仍兼容用户直接修改设置；重复协调不会重复启动 Scheduler。

### Codex 周额度与 COST 实时刷新（2026-10-25）

QuotaData 新增可选 `has5hLimit`。Scheduler 对 Codex 本地限额按实际窗口时长映射；短周期扫描同步发布已计价的 `entries`，使仪表盘聚合、成本曲线和明细同步更新，避免初始空明细持续显示零成本。状态栏与额度 tooltip 在 `has5hLimit=false` 时隐藏五小时额度，其他 Provider 及旧缓存保持原有显示。

### 周额度账号的本地统计边界（0.6.3）

无五小时限额时，Scheduler 以当前时刻为本地五小时分析窗口终点；短周期读取锚点时覆盖旧缓存的五小时边界，保留官方每周边界。状态栏 tooltip 的额度、重置时间和本地用量表全部隐藏五小时行，保留今日和每周数据。

### 状态栏默认入口（0.6.4，2026-10-26）

ConfigService 的 statusBarProviders getter 与 setStatusBarProviders setter 共用 calc.normalizeStatusBarProviders：过滤不支持的 ID、去重，最终没有有效项时返回 [kimi]。正常配置和 globalState 降级存储均保存归一化选择；旧空数组在读取时也回退为 Kimi。manifest 默认值同步为 [kimi]，不再根据当前仪表盘 Provider 推导初始勾选。

### Kimi 登录复用与登录命令（0.6.5，2026-10-26）

CacheService.readKimiCredentials() 封装新版、旧版及自定义根目录的凭据读取，文件 IO 和 JSON.parse 均有异常防护。KimiAuthProvider 读取共享有效 token 时优先于插件私有缓存，兼容 expires_at 秒/毫秒，且不写入官方凭据文件。结构校验、坏文件和过期回退见 Provider 文档 #kimi-auth。

extension.ts 的 signIn 命令仅在队列中解析运行实例，浏览器授权在队列外等待；成功后回到队列更新 AuthStatus、失效登录/本地缓存并立即调用对应 Scheduler.force。避免等待授权阻塞 checkbox 和仪表盘切换。登录异常有用户提示且不暴露响应 token。

StatusBar 缺失登录分支的 tooltip 提供携带自身 Provider ID 的登录链接。新增双语提示与仪表盘登录按钮；未增加用量字段、历史副本或持久缓存条目，凭据读取只产生临时小对象。

### 官方提前重置后的 Codex 同步（0.6.6，2026-10-26）

Scheduler.processQuotaData 对官方使用率下降，或官方重置时间变化超过 60 秒的窗口，直接采用新官方百分比，丢弃旧平滑小数并重新建立本地成本基线；两个窗口独立处理。官方原始数据、校准和窗口锚点照常写缓存，重启不会恢复充值前用量。

短周期在已有官方 quota、但 k=0（例如官方已清零）时保持校准基准 P，不再把累计费用金额当作百分比回填。Token、COST 和历史明细仍照常更新，官方额度重置不会删除实际发生的费用记录。

Codex 已有 API/cache/stale 权威额度时，后续 API 失败不能以旧 JSONL rate_limits 或旧磁盘缓存覆盖它；保留最后官方值、记录错误并继续扫描本地用量。尚无官方数据时仍允许本地 JSONL 降级。其他 Provider 的 fallback 行为保持不变。

CacheService.readCodexAccountId() 负责读取 ~/.codex/auth.json 中的 tokens.account_id，IO/JSON.parse 均有异常防护，失败返回 undefined。CodexApiProvider 的网络查询只读取用量。

### 状态栏过期判定修复（0.6.7，2026-10-28）

StatusBarPresenter 的普通渲染、动画开始与动画帧均向 `calc.formatProviderStatus` 传入当前 `config.refreshIntervalSeconds`。配额成功时间超过“配置刷新间隔 + 两分钟宽限”后才显示 💤，避免默认五分钟刷新配额、两分钟即标记过期的矛盾。💤 表示配额数据过期，不用于判断 Kimi/其他 Provider 的交互活动；本地交互不会伪造 API 新鲜度。

### 调度串行与缓存新鲜度修复（0.6.8，2026-10-28）

Scheduler 通过 tickInFlight 串行执行长短 tick。执行期间 force() 合并为一个 refreshPending；当前任务完成后清除 Provider API 缓存并执行一次长 tick，防止旧请求回填缓存导致手动刷新仍读取旧数据。普通 force 保持立即失效缓存和 50ms 调度。tick 的 watchdog 在完成或 stop 时清理；60 秒超时会记录错误，但不会误认为底层 Promise 已取消，仍等待其结束后才允许下一任务，以避免迟到响应覆盖新状态。若底层请求一直不结束，后续刷新将等待它结束；此处不伪造请求取消。停止后不会由迟到任务重新启动调度。新增每实例两个布尔值和一个定时器引用，为常数内存，不随 retention 增长。

Store 的 CACHE_LOADED 将缓存 fetchedAt 同步恢复到 lastSuccessfulFetchAt（缺失则 null），过期判断采用缓存原时间，包含 Unix epoch 0；无时间的缓存按过期处理。缓存恢复不修改已有错误，不伪装成刚刚成功请求。

短 tick 的 LOCAL_ESTIMATE 补齐今日及本周期的输出、缓存读取、缓存创建 Token，与长 tick 字段保持一致，确保 tooltip 和 dashboard 不保留旧值。

### 未登录账号本地优先与调度停止保护（0.6.14，2026-11-09）

Scheduler 长 tick 先按已有窗口锚点（内存 → 磁盘 → fallback）扫描并发布本地用量，再解析凭据、请求官方配额。认证或网络等待期间，Dashboard 可从 Store 显示历史记录；配额返回后仍按官方窗口重新聚合及校准，保留官方提前重置和小数平滑规则。本地首次扫描失败会记录日志，继续尝试官方数据。

长 tick 在开始时记录尝试时间，异常后按正常刷新间隔重试，避免失败时以零延迟循环扫描。异常和 60 秒 watchdog 超时都会清除 isLoading；watchdog 仍保留底层任务所有权直到其结束，避免并发请求与缓存覆盖，不声称已取消网络请求。未结束的请求仍会阻止该实例的后续刷新，但已发布的本地记录和其他 Provider 的切换、勾选保持可用。

stop() 清除加载状态并递增 generation。长短 tick 在异步读取后核对 generation，丢弃停止前任务的迟到结果；官方数据处理和缓存写入间也设置检查，避免已停止任务继续发布状态或追加窗口缓存。已经发出的磁盘写入不能撤销。每实例仅新增一个数字计数器，无新增历史集合，内存为常数，不影响 retention 预算。

### 状态栏独立可见性标识（0.6.15，2026-11-09）

StatusBarPresenter 使用带显式 id 的 createStatusBarItem 重载，标识固定为 `provider.<providerId>`，优先使用注入 Provider 的 id，缺省时使用 Store.activeProvider；保留已有对齐和优先级 104。重新创建相同 Provider 时 id 不变，VS Code 可独立记忆各模型的可见性。

旧实现未传 id，所有模型归入扩展级 `kayuii.ai-status-hub`。本机排查确认该标识位于 VS Code 的 workbench.statusbar.hidden 隐藏列表，即使扩展成功激活、配额持续刷新，状态栏也不可见；重装不会清除这一偏好。新模型标识独立于旧标识，首次使用新标识时恢复默认可见性，之后尊重用户对每个模型的隐藏选择。无需修改 VS Code 数据库或其他状态栏设置。

## 0.6.23 火山配置与状态栏

- `config.ts` 增加 Claude 日志会话/模型归属配置读取，火山默认模型为 glm-5.3-flash，自动货币为 CNY，定价链接指向方舟官方模型价格；`getPricing` 可由供应商指定私有配置键，用于峰谷价格。
- 状态栏的可选供应商增加 `volcengine`，保留每供应商独立实例与稳定 ID；tooltip 通过双语文案提示火山费用估算范围、K2.8 单价缺项和同名模型配置限制。
- `IPricingProvider.getPricing` 接受可选记录时间，不影响原供应商实现。

0.6.23 补充：Scheduler 在重新分流后扫描为空且原 state 仍有 entries 时，长/短 tick 均发布零用量与空 entries，保留官方 quota 和百分比，防止 GLM 与火山界面同时残留旧统计。GLM 图标为 `Ζ`，火山为 `🌋`。

0.6.24 配置补充：`claudeLog.glmVolcengineCutover` 默认 `2026-11-16T13:00:00+08:00`，用于用户确认的 GLM 官方→火山切换；空字符串禁用，读取原始 ISO 8601 字符串，由日志扫描器解析后交给 calc.ts 纯函数决定逐条归属。

## 0.6.26 火山 API Key 登录

extension.ts 的既有 signIn 命令现在通过 VolcengineAuthProvider 直接弹出密钥输入框，成功保存后清除本地解析缓存、标记凭据已配置并触发刷新。signOut 优先调用供应商可选的 signOut，失败不清空 UI；成功才执行原有本地状态重置。base/types.ts 同步可选接口，不影响现有供应商。密钥保存成功不等于服务端验证通过，未接入套餐配额。

## 0.6.27 Coding Plan 查询链路

VolcengineApiProvider 替换 local-only 占位接口。登录成功验证 AK/SK 后由现有扩展命令清理本地缓存、标记认证并强制刷新；Scheduler 调用同一个供应商 API，沿用旧快照及本地统计回退。QuotaData / UnifiedQuota 增加 percentOnly、monthlyUsedPct、monthlyResetAt，CredentialType 增加 access-key；不新增磁盘访问点。状态栏 percentOnly 模式保持百分比，tooltip 显示月额度与查询错误，未返回的重置时间不自行编造。

0.6.27 图标补充：GLM 状态栏图标按最新用户要求改为 ⚡，火山仍为 🌋，自动化图标断言已同步。

## 0.6.30 Kimi 月度显示

types.ts 与 Provider UnifiedQuota 增加可选 monthlyCodeUsedPct / monthlyCodeResetAt，KimiUsageData 增加对应月度显示字段。既有 Store 的 API_SUCCESS 替换 quota，旧月字段不会在后续不含月数据的快照中残留；缓存仍沿用完整 quota 序列化，无新增磁盘访问。状态栏 tooltip 区分会员月共享与 Code 月额度，只有月窗口时主状态显示月百分比。其他供应商既有月度显示不变。

## 0.6.31 仪表盘刷新与版本诊断

extension.ts 在展示已有缓存/已请求过的供应商 Dashboard 时调用其 scheduler.force；新实例沿用 start 的立即 tick，加载中不追加刷新。激活日志包含 context.extension.packageJSON.version，便于识别多个窗口运行不同旧版本。KimiUsageData 新增 monthlyUnavailableText，描述没有获取到月度数据，不断言实时 API 一定未返回。真实月额度仍来自接口。

## 0.6.32：窗口费用展示字段

KimiUsageData 新增必填 cost5hText 与 cost7dText，由 Dashboard 使用共享 fmtCurrency 和 state.activeProvider 对应币种生成。数值 cost5h / cost7d 保留用于统计；零值与正值均明确展示，供应商隔离及窗口锚点逻辑不变。

## 0.6.33：GLM 滚动五小时锚点

Scheduler 的 GLM window5hStartMs 取查询/刷新时刻减五小时，长 tick、短 tick、状态锚点与磁盘回退均保持此规则；window5hResetAtMs 保留官方报告值用于配额恢复提示。周锚点继续取 weeklyResetAt−7d，与套餐下单周期一致。其他供应商的固定窗口不变。

## 0.6.35：DeepSeek 余额状态

ConfigService 增加官方 DeepSeek 默认模型、人民币默认币种、官方价格链接和额外空闲日期配置；Provider 列表与状态栏选项增加 deepseek。QuotaData / UnifiedQuota 通过 balance 保存官方账户余额，供应商缓存仍分开。formatProviderStatus 余额分支显示真实货币金额及刷新来源，余额不可用显示警告；Tooltip 展示余额、赠送、充值组成，不生成配额图表。首次查询失败时显示余额不可用而不是永久加载。DeepSeek 的私有 signOut 通过已有通用命令协议调用。

## 0.6.36：无周配额时保留本地最近七天

Scheduler 处理 has7dLimit=false 的 API 快照时，以当前时刻作为本地七天范围终点，起点为 now−7d；不再将缺失 weeklyResetAt 传给固定周期推算器后得到 now 起点。短 tick 和磁盘锚点回退都重建这个滚动边界，修复已持久化的错误锚点。官方有周限额的订阅仍按官方 resetAt−7d 统计。

DeepSeek 仅提供余额，无论是否登录/取得余额，都保持本地五小时与七天的滚动范围，不依赖不存在的官方重置时间。此改动不制造套餐周配额，官方余额及其真实币种、赠送/充值组成保持独立。

## 0.6.38：会员月度来源和连接命令

QuotaData / UnifiedQuota 增加可选 monthlyFromMembership / monthlyCodeIsShared，缓存沿用可选字段兼容；KimiUsageData 增加已翻译 monthlyCodeLabel。状态栏 Tooltip 使用来源标签和到期文本，避免将网页 Code 比率显示为独立上限。

extension.ts 注册 aiStatusHub.kimiConnectMembership：绑定 Kimi runtime，在选择队列之外等待密码框流程，成功后只刷新 Kimi。Kimi signOut 删除独立网页 SecretStorage key，其他供应商密钥保持隔离。auth/getter 与 api 构造器回调连接，不把网页令牌发送给 Coding API；不记录令牌或账户响应原文。

## 0.6.39：月度组成视图数据

KimiUsageData 新增可选 monthlyBreakdown，包含 kimiPct、codePct 以及由 calc.ts 生成的 kimiText、codeText。仅 Kimi 共享池有合法组成时传给 WebView；原始 QuotaData 口径和本地费用汇总保持不变。

## 0.6.40：图例视图字段

KimiUsageData.monthlyBreakdown 新增 kimiLegend/codeLegend 已格式化字符串，WebView 按独立文本节点显示，避免替换图例内的色块元素。

## 0.6.41：可选价格覆盖的空值语义

ConfigService.getPricing 按 provider 私有值 → 全局同模型值 → Provider 计算费率 → 通用缺省顺序，使用 nullish coalescing 回退。undefined/null 均表示未覆盖；明确数值 0 仍是有效覆盖，不能使用逻辑或代替。DeepSeek 16 个可选价格配置项声明 number|null 并显式 default:null，避免 VS Code 为未声明默认值的 number 自动补 0，覆盖 Provider 的动态 CNY/USD 峰谷费率。

根因依据：VS Code configurationRegistry.ts 的 updatePropertyDefaultValue/getDefaultValue 对 number 缺省返回 0：https://github.com/microsoft/vscode/blob/main/src/vs/platform/configuration/common/configurationRegistry.ts#L1068 。此前单元测试仅在缺失配置时返回调用方 fallback，未模拟平台补默认值，导致扫描结果正常但真实宿主费用为零的差异。

## 0.6.42：DeepSeek 显式价格覆盖

0.6.41 通过 null schema 默认值修复零价，但 get() 仍可能接受宿主注册中的隐式零默认值。ConfigService 新增 readPriceOverride；DeepSeek 动态费率使用 inspect() 的显式层级值，忽略 defaultValue/defaultLanguageValue。优先级依次为文件夹语言、工作区语言、用户语言、文件夹、工作区、用户；取最高已定义层级，null 表示该字段回退，明确 0 仍保留。随后按私有覆盖 → 全局同模型覆盖 → Provider 自动费率回退。缺失、非有限值、负数、非法类型或 inspect 异常均不替代自动费率。其他 Provider 仍使用注册的固定价格默认值。

现场日志确认 0.6.41 已激活，用户确认 Pricing 四项仍为零；已检查用户配置及相关工作区配置，未发现显式价格覆盖。无法获取真实宿主 inspect 快照：隔离 Code 测试实例因 Crashpad 启动失败。因此宿主遗留默认值是待实际窗口确认的解释；回归测试覆盖该失败模式，不能冒称已观察到真实宿主配置内容。

## 0.6.43：DeepSeek 网页账号统计

DeepseekBilling 仅包含 currency、spent、available 及可选 recharged/refunded 汇总；QuotaData/UnifiedQuota 添加 accountBilling/accountBillingError，Dashboard 视图添加已格式化账单信息。缓存只持久化汇总，不存令牌、完整订单或账单原文；原普通缓存已有余额，新增的汇总同样是本地明文财务信息，不能当成凭据存储。

extension.ts 新增 aiStatusHub.deepseekConnectWeb：密码交互在调度队列外，成功后仅 force DeepSeek。Provider 创建时将网页令牌 getter 接入 DeepseekApiProvider，模型 Key 验证独立执行，不混入旧网页账号数据。statusBar.ts Tooltip 使用 calc.ts 格式化，状态文本保留余额并增加官网资金使用比例。

## 0.6.44：DeepSeek 本地初始金额

ConfigService 新增 deepseekBaseCost（默认 0）、deepseekInitialAmount（默认 10）及 setDeepseekInitialAmount。设置项 aiStatusHub.deepseek.baseCost / initialAmount 为 machine scope、ignoreSync=true，校正写入本机用户设置（global target），不写项目工作区。初始金额必须有限且为正，基础费用必须有限且非负。设置更新失败返回 false，保留原初始金额；不把金额写入凭据字段或日志。

修改金额设置会触发 DeepSeek API 余额刷新；手动校正完成也只 force 余额 API。DeepseekBilling 添加可选 initialAmount/baseCost，状态栏比例跟随余额 API 生成的数据；Tooltip 使用紧凑消费/余额/初始金额摘要，取消重复的赠送/充值余额行。切换账号或币种、充值/退款后应由用户校正或手动修改初始金额，金额单位跟随余额币种。

## 0.6.45：初始金额保存失败后备

现场 0.6.44 已激活，用户设置 JSON 有效且文件非只读；旧代码吞掉 WorkspaceConfiguration.update 异常，无法确定本次宿主拒绝写入的具体原因。错误提示所在分支证明官网校正已成功，失败发生在保存初始金额阶段，不应误报网页登录失败。

setDeepseekInitialAmount 使用显式 ConfigurationTarget.Global 写入用户设置；失败时复用已初始化的 context.globalState 本机 Memento，保存 aiStatusHub.deepseek.initialAmountFallback={amount,configuredValue}。配置值未改变时采用后备金额，重启后恢复；显式用户值改变时优先使用新值，配置变更事件清除旧后备，避免后续重置时恢复过时金额。用户设置写入成功也清理后备。无效/损坏的后备不覆盖合法设置；只有两种存储都不可用才返回失败。

后备仅保存金额及旧显式设置值，不保存密钥、网页令牌或账单原文；该 globalState key 未注册同步。日志仅记录固定的后备保存说明，不输出异常原文或金额。

## 0.6.46：金额直接编辑与统一后备

ConfigService 将初始金额和基础费用统一通过金额读写方法管理，保留原 initialAmountFallback 键和数据结构，新增 baseCostFallback；两者优先写 Global 用户设置，失败时保存本机 globalState。基础费用允许 0，初始金额必须为正；非法数值不写入。显式设置改变或写入成功会清理各自后备，后备中的旧 globalValue 用于识别后续手动修改。配置变更与编辑成功都会触发余额 API 刷新，网页账单仍只手动校正。

## 0.6.47：金额在用户设置页面编辑

DeepSeek 的两个金额设置继续注册为 machine / ignoreSync，默认基础费用 0、初始金额 10。Edit Setting 恢复并精确定位标准图形用户设置页面；本机金额后备及已有配置变更刷新逻辑保留，用户在设置页修改后显式配置优先。移除插件内金额选择/输入步骤。

## 0.6.49：金额展示项数据

KimiUsageData.accountBilling 展示数据扩展可选 items 数组（text/label），承载格式化金额与对应本地化悬停说明；仍属于 DeepSeek 仪表盘展示层数据，不写账号凭据或新增账单网络查询。
