# AI Status Hub v2 Phase 2 详细实现文档

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

---

## 5. calc.ts

Phase 2 在 Phase 1 基础上新增以下纯函数（Phase 1 部分同前，此处仅列出新增）：

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
    const window5hStart = opts?.windowResetAtMs ? opts.windowResetAtMs - 5 * 3600 * 1000 : default5hStart;
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
