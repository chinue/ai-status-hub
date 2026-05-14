# KimiStatusPro v2 本地估算设计文档

> 版本：v2.0.0-draft  
> 日期：2026-05-10  
> 状态：待评审  

---

## 1. 为什么需要本地估算

Kimi API 的配额接口有调用频率限制（5h 窗口约 1000 次，7d 窗口约 100 次）。如果每次用户操作都调 API，很快会触发限流。本地估算通过读取 Kimi CLI 生成的 `wire.jsonl` 日志文件，在本地计算 token 使用量，实现：

1. **高频刷新**（每 5 秒）而不调 API
2. **更精确的百分比**（API 返回的 `weeklyUsedPct` 是整数，本地估算可到小数）
3. **成本计算**（API 不返回成本，本地根据 token × 定价计算）

---

## 2. 数据来源

### 2.1 日志文件位置

```
~/.kimi/sessions/
├── <session-id-1>/
│   ├── <conversation-id-1>/
│   │   └── wire.jsonl          ← 目标文件
│   └── <conversation-id-2>/
│       └── wire.jsonl
└── <session-id-2>/
    └── ...
```

### 2.2 日志文件格式

每行一个 JSON 对象，我们只关心 `type === 'StatusUpdate'` 的消息：

```json
{
  "timestamp": 1715355600.123,
  "message": {
    "type": "StatusUpdate",
    "payload": {
      "message_id": "msg_abc123",
      "token_usage": {
        "input_other": 1234,
        "output": 567,
        "input_cache_read": 89,
        "input_cache_creation": 12
      }
    }
  }
}
```

**关键字段**：
- `timestamp`：Unix 时间戳（秒）
- `message.payload.message_id`：去重 key
- `message.payload.token_usage.input_other`：普通输入 token
- `message.payload.token_usage.output`：输出 token
- `message.payload.token_usage.input_cache_read`：缓存读取 token
- `message.payload.token_usage.input_cache_creation`：缓存写入 token

### 2.3 读取策略

```typescript
interface FileState {
  mtimeMs: number;
  size: number;
  entries: UsageEntry[];
}

class LocalUsageService {
  private fileStates = new Map<string, FileState>();

  async getLocalUsage(opts: {
    cycleStartMs?: number;
    weeklyResetAtMs?: number;
    windowResetAtMs?: number;
  }): Promise<LocalAggregatedUsage> {
    return this.scanAllFiles(opts);
  }

  private async updateFileState(filePath: string): Promise<FileState> {
    const existing = this.fileStates.get(filePath);
    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(filePath);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return existing ?? { mtimeMs: 0, size: 0, entries: [] };
    }
    if (existing && existing.mtimeMs === stat.mtimeMs && existing.size === stat.size) {
      return existing;
    }
    // 读取新增内容并解析
    const entries = await this.readNewEntries(filePath, existing);
    const next: FileState = { mtimeMs: stat.mtimeMs, size: stat.size, entries };
    this.fileStates.set(filePath, next);
    return next;
  }
}
```

**性能优化**：
- `fileStates` Map 增量更新：按文件路径缓存解析结果，通过 `mtimeMs + size` 检测文件变化
- 文件未变化时直接复用缓存的 `entries`，避免重复解析
- 所有文件并行读取：`Promise.all(filePaths.map(fp => readFile(fp)))`
- 单文件增量读取：记录上次读取的 offset，只读新增内容
- 去重：按 `message_id` 去重，避免同一消息被重复计数

---

## 3. 聚合逻辑

### 3.1 时间窗口定义

| 窗口 | 起始时间 | 说明 |
|---|---|---|
| 今日 | `todayStart = new Date().setHours(0,0,0,0)` | 本地时区 0 点 |
| 5h | `windowResetAtMs - 5 * 3600 * 1000` | 以 API 返回的 resetAt 为终点 |
| 7d | `weeklyResetAtMs - 7 * 24 * 3600 * 1000` | 以 API 返回的 resetAt 为终点 |
| 当前周期 | `cycleStartMs` | 由 `getCycleStartMs()` 计算 |

### 3.2 聚合结果结构

```typescript
interface LocalAggregatedUsage {
  // 今日（本地时区 0 点至今）
  tokensToday: number;          // input + output + cacheRead + cacheCreate
  costToday: number;            // ¥
  requestsToday: number;        // 消息数

  // 5h 窗口（以 windowResetAt 为终点）
  tokensIn5h: number;           // input_other
  tokensOut5h: number;          // output
  tokensCacheRead5h: number;    // input_cache_read
  tokensCacheCreate5h: number;  // input_cache_creation
  cost5h: number;               // ¥
  requests5h: number;

  // 7d 周期（以 weeklyResetAt 为终点）
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  cost7d: number;
  requests7d: number;

  // 当前计费周期
  tokensThisCycle: number;      // input + output + cacheRead + cacheCreate
  costThisCycle: number;        // ¥
  requestsThisCycle: number;

  // 原始 entries（用于热力图、仪表盘明细）
  entries: UsageEntry[];
}

interface UsageEntry {
  timestamp: number;  // ms
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  cost: number;       // ¥
  messageId: string | null;
  model?: string;     // 预留多模型
}
```

### 3.3 成本计算

```typescript
function calculateCost(tokens: {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}, pricing: TokenPricing): number {
  const cost = (
    (tokens.inputOther / 1_000_000) * pricing.inputPerMillion +
    (tokens.output / 1_000_000) * pricing.outputPerMillion +
    (tokens.inputCacheRead / 1_000_000) * pricing.cacheReadPerMillion +
    (tokens.inputCacheCreation / 1_000_000) * pricing.cacheCreatePerMillion
  );
  return isFinite(cost) && cost >= 0 ? cost : 0;
}
```

**默认定价**（kimi-k2.6 RMB）：
- Input（cache miss）：¥6.50 / 1M tokens
- Output：¥27.00 / 1M tokens
- Cache read（cache hit）：¥1.10 / 1M tokens
- Cache creation：¥6.50 / 1M tokens

---

## 4. 线性增量估算器（Linear Incremental Estimator）

### 4.1 为什么需要新模型

旧模型使用**容量校准**（capacity-based）：在 API 成功时计算 `capacity = localTokens / (apiPct / 100)`，之后用 `currentTokens / capacity * 100` 估算。这存在三个问题：

1. **度量不统一**：7d 用 token 数，5h 用金额，跨厂商切换时需要重新校准。
2. **5h 小数不跳动**：`cost5h` 只在完整请求完成后变化，5 秒 short tick 间通常不变。
3. **低百分比误差大**：当 `apiPct < 5%` 时校准值极不稳定。

新模型改用**线性增量外推**：维护 `(P, C, k)` 三个变量，基于费用增量估算百分比变化。

### 4.2 状态变量

每个窗口（5h 和 7d）独立维护一组状态：

```typescript
interface ILinearEstimator {
  P: number;   // 最近一次 API 成功时的官方百分比
  C: number;   // 同一时刻的本地费用
  k: number;   // 比例系数，k = P / C

  update(apiPct: number, localCost: number): void;
  estimate(currentCost: number): number;
}
```

### 4.3 更新规则（API 成功时）

```typescript
function update(apiPct: number, localCost: number): void {
  if (apiPct > 5 && localCost > 0) {
    this.k = apiPct / localCost;
  }
  this.P = apiPct;       // P 总是更新
  this.C = localCost;    // C 总是更新
}
```

**关键设计**：
- `P` 和 `C` **总是更新**，无论百分比高低。
- `k` **仅在 `P > 5%` 且 `C > 0` 时更新**；否则保持上一次有效值。
- 当 `P < 5%` 时，使用旧的可靠 `k` 配合最新的 `P` 作为基准，避免低百分比时的巨大误差。

### 4.4 估算规则（Short Tick）

```typescript
function estimate(currentCost: number): number {
  if (this.k <= 0 || !isFinite(this.k)) {
    return Math.max(0, Math.min(100, currentCost));
  }
  const p = this.P + this.k * (currentCost - this.C);
  return Math.max(0, Math.min(100, p));
}
```

**公式说明**：
- `p = P + k * (c - C)` = 基准百分比 + 比例系数 × 费用增量
- 边界处理：`p < 0` 截断为 `0`，`p > 100` 截断为 `100`
- Fallback：`k = 0` 时返回 `currentCost`（费用值本身作为粗略百分比）

---

## 5. 估算逻辑（Estimation）

### 5.1 统一公式

| 维度 | 7d 周期 | 5h 窗口 |
|------|---------|---------|
| **官方百分比 P** | `weeklyP` | `windowP` |
| **基准费用 C** | `weeklyC` | `windowC` |
| **比例系数 k** | `weeklyK` | `windowK` |
| **本地度量 c** | `costThisCycle` | `cost5h` |
| **估算公式** | `p7d = weeklyP + weeklyK * (costThisCycle - weeklyC)` | `p5h = windowP + windowK * (cost5h - windowC)` |

### 5.2 估算 vs API 的优先级

```
API 可用且有效
  → 使用 API 返回的百分比（精确）
  → 同时更新线性估算器 (P, C, k)
  → **百分数平稳化**：若本地估算值四舍五入后的整数与 API 返回的整数一致，保留更精细的估算值；不一致时强制更新为 API 值

API 不可用（限流/网络错误）
  → 使用本地估算
  → 如果 k > 0：用线性增量公式估算
  → 如果 k = 0：fallback 到 currentCost

从未调过 API（首次使用）
  → fallback 到 currentCost
  → 显示提示：数据基于本地日志估算
```

### 5.3 状态流转

```
API_SUCCESS
  → state.weeklyUsedPct = apiWeeklyUsedPct（经平稳化后可能保留本地小数估算）
  → state.windowUsedPct = apiWindowUsedPct（经平稳化后可能保留本地小数估算）
  → state.dataSource = 'api'
  → 触发线性模型更新：weeklyP/weeklyC/weeklyK, windowP/windowC/windowK

API_ERROR (非 401/403)
  → state.weeklyUsedPct = weeklyEstimator.estimate(costThisCycle)
  → state.windowUsedPct = windowEstimator.estimate(cost5h)
  → state.dataSource = 'stale'
  → state.error = errorMessage

NO_CREDENTIALS
  → state.weeklyUsedPct = 0
  → state.windowUsedPct = 0
  → state.dataSource = 'no-credentials'

FIRST_LAUNCH (无缓存)
  → state.weeklyUsedPct = costThisCycle (fallback)
  → state.windowUsedPct = cost5h (fallback)
  → state.dataSource = 'local-only'
```

---

## 6. 定时器调度

### 6.1 Short Tick（5 秒）

```typescript
async function onShortTick(store: Store): Promise<void> {
  // 1. 读取本地 JSONL（fileStates 增量更新）
  const localUsage = await localUsageService.getLocalUsage({
    weeklyResetAtMs: store.getState().quota?.weeklyResetAt,
    windowResetAtMs: store.getState().quota?.windowResetAt,
  });

  // 2. 构建线性估算器
  const weeklyEstimator: ILinearEstimator = {
    P: store.getState().localEstimate?.weeklyP ?? 0,
    C: store.getState().localEstimate?.weeklyC ?? 0,
    k: store.getState().localEstimate?.weeklyK ?? 0,
    update() {},
    estimate(currentCost: number) {
      if (this.k <= 0 || !isFinite(this.k)) {
        return Math.max(0, Math.min(100, currentCost));
      }
      const p = this.P + this.k * (currentCost - this.C);
      return Math.max(0, Math.min(100, p));
    },
  };
  const windowEstimator: ILinearEstimator = {
    P: store.getState().localEstimate?.windowP ?? 0,
    C: store.getState().localEstimate?.windowC ?? 0,
    k: store.getState().localEstimate?.windowK ?? 0,
    update() {},
    estimate(currentCost: number) {
      if (this.k <= 0 || !isFinite(this.k)) {
        return Math.max(0, Math.min(100, currentCost));
      }
      const p = this.P + this.k * (currentCost - this.C);
      return Math.max(0, Math.min(100, p));
    },
  };

  // 3. 估算百分比
  const weeklyPct = weeklyEstimator.estimate(localUsage.costThisCycle);
  const windowPct = windowEstimator.estimate(localUsage.cost5h);

  // 4. 更新状态
  store.dispatch({
    type: 'LOCAL_ESTIMATE',
    payload: {
      weeklyPct,
      windowPct,
      localUsage,
    },
  });
}
```

**注意**：Short tick **不调 API**，只做本地估算。如果当前 `k = 0`（从未满足 `P > 5%` 条件），fallback 到 `currentCost`，百分比可能不准确，但这是预期行为。

### 6.2 Long Tick（60 秒）

```typescript
async function onLongTick(store: Store, authService: AuthService): Promise<void> {
  const token = await authService.resolveToken();
  if (!token) {
    store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
    return;
  }

  try {
    const apiData = await apiService.fetchQuota(token);

    // 读取本地数据用于校准
    const localUsage = await localUsageService.getLocalUsage({
      weeklyResetAtMs: apiData.weeklyResetAt,
      windowResetAtMs: apiData.windowResetAt,
    });

    // 百分数平稳化
    const currentEstimate = store.getState().localEstimate;
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

    // 更新线性估算器
    const weeklyEstimator = createLinearEstimator();
    const windowEstimator = createLinearEstimator();
    weeklyEstimator.update(weeklyPct, localUsage.costThisCycle);
    windowEstimator.update(windowPct, localUsage.cost5h);

    // 写入缓存
    await cacheService.write({
      quota: apiData,
      fetchedAt: Date.now(),
      calibration: {
        weeklyP: weeklyEstimator.P,
        weeklyC: weeklyEstimator.C,
        weeklyK: weeklyEstimator.k,
        windowP: windowEstimator.P,
        windowC: windowEstimator.C,
        windowK: windowEstimator.k,
        calibratedAt: Date.now(),
        reset5hAt: apiData.windowResetAt,
        reset7dAt: apiData.weeklyResetAt,
      },
    });

    // 更新状态
    store.dispatch({ type: 'API_SUCCESS', payload: apiData });
    store.dispatch({
      type: 'LOCAL_ESTIMATE',
      payload: {
        weeklyPct,
        windowPct,
        weeklyP: weeklyEstimator.P,
        weeklyC: weeklyEstimator.C,
        weeklyK: weeklyEstimator.k,
        windowP: windowEstimator.P,
        windowC: windowEstimator.C,
        windowK: windowEstimator.k,
        calibratedAt: Date.now(),
      },
    });

  } catch (err) {
    if (err.status === 401) {
      store.dispatch({ type: 'API_ERROR', payload: { error: 'Unauthorized', authFailed: true } });
      authService.invalidate();
    } else if (err.status === 403) {
      store.dispatch({ type: 'API_ERROR', payload: { error: 'Forbidden', authFailed: true } });
    } else {
      store.dispatch({ type: 'API_ERROR', payload: { error: err.message } });
    }
  }
}
```

---

## 7. 缓存持久化

### 7.1 缓存文件结构

```json
{
  "version": 3,
  "schema": "codex-status-pro-cache-v1",
  "writtenAt": "2026-05-13T18:00:00.000Z",
  "data": {
    "quota": {
      "weeklyLimit": 100000000,
      "weeklyUsed": 62000000,
      "weeklyUsedPct": 62,
      "weeklyResetAt": 1715960400000,
      "windowLimit": 5000000,
      "windowUsed": 1500000,
      "windowRemaining": 3500000,
      "windowUsedPct": 30,
      "windowResetAt": 1715374800000,
      "parallelLimit": 10
    },
    "calibration": {
      "weeklyP": 62,
      "weeklyC": 10,
      "weeklyK": 6.2,
      "windowP": 30,
      "windowC": 3,
      "windowK": 10,
      "calibratedAt": 1715355600000,
      "reset5hAt": 1715374800,
      "reset7dAt": 1715960400
    }
  }
}
```

### 7.2 向后兼容

旧缓存（version < 3）中的 `tokenCapacity`/`windowCostCapacity` 无法直接转换为线性模型状态（缺少费用快照 C）。**策略**：升级 schema version 至 3，旧缓存自动失效。首次启动时 `k = 0`，使用 fallback 模式，等待下一次 API 成功后自然建立新的 k 值。

### 7.3 启动时恢复

```typescript
async function init(store: Store): Promise<void> {
  const cached = await cacheService.read();
  if (cached) {
    // 恢复配额数据
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });

    // 恢复线性估算器状态
    if (cached.calibration) {
      store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          weeklyP: cached.calibration.weeklyP ?? 0,
          weeklyC: cached.calibration.weeklyC ?? 0,
          weeklyK: cached.calibration.weeklyK ?? 0,
          windowP: cached.calibration.windowP ?? 0,
          windowC: cached.calibration.windowC ?? 0,
          windowK: cached.calibration.windowK ?? 0,
          calibratedAt: cached.calibration.calibratedAt,
        },
      });
    }

    // 判断缓存新鲜度
    const age = Date.now() - cached.quota.lastUpdated;
    const isFresh = age < config.cacheTtlSeconds * 1000;
    store.dispatch({
      type: 'API_SUCCESS',
      payload: { ...cached.quota, dataSource: isFresh ? 'cache' : 'stale' },
    });
  }
}
```

---

## 8. 错误处理

### 8.1 文件读取错误

| 场景 | 处理 |
|---|---|
| `~/.kimi/sessions` 不存在 | 返回空聚合结果，所有计数为 0 |
| 单个文件读取失败 | 跳过该文件，继续处理其他文件 |
| JSON parse 失败 | 跳过该行，继续处理下一行 |
| 文件被占用 | 跳过，下次 tick 重试 |

### 8.2 估算异常

```typescript
function safeEstimate(
  estimateFn: () => number | null,
  fallbackFn: () => number
): number {
  try {
    const result = estimateFn();
    return result !== null && isFinite(result) ? result : fallbackFn();
  } catch {
    return fallbackFn();
  }
}
```

### 8.3 校准异常

- `tokenCapacity` 或 `windowCostCapacity` 为 `NaN/Infinity/负数` → 视为 `null`
- 校准值异常大（如 > 1e15）→ 视为 `null`
- 校准后百分比 > 150% → 视为 `null`（说明容量模型已失效）

---

## 9. 与旧版本的改进

| 维度 | v0.3.x | v2 |
|---|---|---|
| **文件扫描** | 同步 `fs.readSync`，阻塞主线程 | 异步 `fs.readFile`，并行读取 |
| **缓存 TTL** | 无（每次 tooltip 都重新扫描） | 30 秒内存缓存 |
| **校准模型** | Capacity-based（`tokenCapacity`/`windowCostCapacity`） | **Linear incremental（`P/C/k`）** |
| **度量统一** | 7d 用 token 数，5h 用金额 | **统一为 cost-based** |
| **低百分比处理** | 容量校准在 `P < 5%` 时误差极大 | k 保持旧值，P 更新为最新基准，误差可控 |
| **校准过期** | 无过期检测 | 基于 `resetAt` 和时间双重检测 |
| **估算 Fallback** | fallback 逻辑散落在多处 | 统一的 `safeEstimate` 包装 |
| **错误处理** | 局部 try/catch，可能漏捕获 | 每个 Service 边界独立捕获 |
| **状态修改** | 直接修改 `this.state` | 通过 `dispatch` 统一更新 |

---

## 10. 文件结构

```
src/
├── services/
│   ├── localUsageService.ts    # 本地 JSONL 扫描 + 聚合
│   ├── cacheService.ts         # 磁盘缓存读写
│   └── apiService.ts           # API 调用
├── calc.ts                     # 成本计算 + 校准 + 估算（纯函数）
└── types.ts                    # LocalAggregatedUsage 等类型
```

---

*文档结束。本地估算的所有逻辑（扫描、聚合、校准、估算、缓存）均在此文档中描述，无需参考旧代码。*
