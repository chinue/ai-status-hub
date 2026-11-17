# AI Status Hub v2 本地估算设计文档

## 0.6.22 提交前计价审查（2026-11-09）

pricingModelKey 的 GLM-5.3 版本只识别紧跟版本号且具有词边界的 Flash / FlashX 后缀。命名空间 flash-gateway/glm-5.3、未登记后缀 superflash/flashxy 均采用旗舰参考价，避免在整个模型字符串中搜索 flash 而误套低价。标准模型、命名空间和显示名映射继续兼容。

## 0.6.19 GLM 模型费率修正（2026-11-09）

calc.pricingModelKey 新增 GLM-5.3/5.2、Flash、FlashX 的别名映射，支持厂商命名空间及显示名称，并用数字边界区分 5.30。LocalUsageService 仍逐条按实际模型重算费用，不直接采纳 Cline metadata.totalCost（可能使用其他币种/单价），不混入套餐积分。

按官方标准 API 价重扫副本：GLM-5.3 48 请求，未缓存输入费用 1.161632 元、输出 0.256424 元、缓存读取 8.141184 元，合计 9.55924 元；Claude 内 GLM-5.3-Flash 一请求 0.02547432 元；今日合计 9.58471432 元。总 Token 4,256,270 中缓存读 4,070,656，约 95.6%。旧固定占位费率算出 2.230329 元，明显低估。该重算为 API 等价金额，不是订阅成本分摊或实扣账单。

## 0.6.18 拷回的新版 Cline 会话（2026-11-09）

根因：之前只扫描 `~/.cline/data/tasks` 等目录中的 `ui_messages.json`，遗漏新版 CLI 的 `~/.cline/data/sessions/<sessionId>/<sessionId>.messages.json`。新增 data/sessions 与 sessions 默认扫描根；磁盘访问仍在 LocalUsageService，只读取消息文件，不采用副本中指向另一台机器的 messages_path，不读取 secrets/providers 等认证配置，也不读取 SQLite 数据库。

`calc.parseClineSessionUsage()` 解析 messages 数组内 assistant 的逐请求 metrics，兼容 `modelInfo.id` 与 modelId、直接 inputTokens/outputTokens/cacheReadTokens/cacheWriteTokens 及 SDK tokens.prompt/completion/cached。inputTokens 是包含缓存的输入总量：扣除缓存分类后得到未缓存输入，缓存分类限制在输入范围内；总量由互斥的输入、输出、缓存读、缓存写四类相加。不会再将缓存输入重复加到 inclusive prompt 上。

仅使用消息 ts（毫秒或 ISO 字符串）进行今日、配额窗口和 retention 聚合，忽略文件拷贝时间。按 sessionId+message.id 去重，缺少 id 时退到消息时间；复制到另一目录的同一会话只计一次。不累加伴随会话元数据中的 usage/aggregateUsage 等累计摘要，不猜测缺少明确模型的历史记录。坏文件、未完成消息、用户消息、零用量及非法时间跳过；后续扫描可读到更新、删除或拷贝完成后的文件。

本机副本实测：两份 Cline 会话共 48 请求；含缓存输入 4,215,796、输出 9,158，总计 4,224,954 Token。其中缓存读为 4,070,592，未缓存输入为 145,204。合并 Claude 一次请求后，今日共 49 请求、4,256,270 Token。网站报告 4.32M 为今日账号数据，仍有约 6.4 万差额，现有副本不能确认来源；不将官方积分或网站总数伪造成本地请求补齐。用户原始消息及凭据不写入测试或仓库。

## 0.6.17 GLM 远端配额解析（2026-11-09）

新增纯函数 calc.parseGlmQuota，解析国内站个人 Coding Plan 配额；支持 CREDIT_LIMIT/TOKENS_LIMIT、5h/周窗口、秒/毫秒重置时间、数值字符串、百分比上限及缺失字段验证。排除 MCP 月额度，不将缺少或错误响应视为清零。formatProviderStatus 对 has7dLimit=false 仅显示实际 5h 配额，保持本地 Token/费用独立于配额。具体接口及响应依据见 v2-provider-abstraction.md 的 GLM provider。

## 0.6.16 离线展示与 Cline 合并（2026-11-09）

`calc.hasQuotaData()` 区分真实配额/已校准估算与单纯本地成本。没有配额或校准依据时，不显示虚假的 0%。`formatProviderStatus()` 改为显示本地今日输入 Token 与费用，接受有效语言及货币符号；完整输入、输出、缓存、请求数与周期费用仍由 tooltip / Dashboard 展示。

`LocalUsageService` 为 Kimi/GLM 额外扫描 Cline：`~/.cline/data/tasks`、`~/.cline/tasks`，以及 Code、Code Insiders、VSCodium、Cursor 的 User/globalStorage 和 User/profiles 中 `saoudrizwan.claude-dev` 目录；兼容 VS Code Server。Windows 使用 APPDATA，macOS 使用 Library/Application Support，Linux 使用 XDG_CONFIG_HOME 或 ~/.config。限定扩展目录，跳过 checkpoints、node_modules、.git，不跟随符号链接，递归最多七层。

读取 `ui_messages.json` 的 `api_req_started`，按 `modelInfo.modelId`（兼容 payload.model/modelId）归属模型；旧记录按 `task_metadata.json` 中 `model_usage` 的 ts 查找请求时刻的 model_id，支持任务切换模型。没有明确模型依据、partial、零用量、坏 JSON 或非法时间的记录忽略，不依当前配置猜测历史模型。保留 tokensIn/tokensOut/cacheReads/cacheWrites，按现有 Provider 定价估算费用；GLM 仍使用现有固定估算费率，不代表账单。Cline 请求用 taskId+ts 去重，再与原生/Claude 日志合并应用 retention。原有 Claude projects 扫描与 Kimi 原生合并继续生效。

新增磁盘访问均位于 LocalUsageService，异常隔离当前文件/请求；原生扫描失败仍可展示 Cline 用量。每次刷新重读任务文件，删除或写入变化可在后续刷新反映。无法可靠归属的记录会漏计，不按任务总数重复累加。

格式依据：[Cline 消息字段](https://github.com/cline/cline/blob/main/apps/vscode/src/shared/ExtensionMessage.ts)、[模型元信息](https://github.com/cline/cline/blob/main/apps/vscode/src/shared/messages/metrics.ts)、[模型时间线](https://github.com/cline/cline/blob/main/apps/vscode/src/core/context/context-tracking/ContextTrackerTypes.ts)、[任务文件名](https://github.com/cline/cline/blob/main/apps/vscode/src/core/storage/disk.ts)。

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

k3.0（Kimi Code）起 session 迁移至 `~/.kimi-code`，解析器同时扫描新旧两个位置：

```
~/.kimi-code/sessions/                 ← k3.0 新位置
└── wd_<project>_<hash>/
    └── <session-id>/
        └── agents/
            └── main/
                └── wire.jsonl        ← 目标文件

~/.kimi/sessions/                      ← k2.6 旧位置（只读兼容）
├── <session-id-1>/
│   ├── <conversation-id-1>/
│   │   └── wire.jsonl          ← 目标文件
│   └── <conversation-id-2>/
│       └── wire.jsonl
└── <session-id-2>/
    └── ...
```

枚举方式为递归查找两个根目录下所有 `wire.jsonl`（深度上限 6 层）。两个目录数据不重叠（迁移后新目录不含旧格式记录），不会重复计数。

### 2.2 日志文件格式

每行一个 JSON 对象。k3.0 与 k2.6 的用量记录格式不同，解析器两种都支持。

**k3.0（Kimi Code）`usage.record` 格式**：

```json
{
  "type": "usage.record",
  "model": "kimi-code/k3",
  "usage": {
    "inputOther": 977,
    "output": 334,
    "inputCacheRead": 25600,
    "inputCacheCreation": 0
  },
  "usageScope": "turn",
  "time": 1784255459897
}
```

**关键字段**：
- `time`：Unix 时间戳（毫秒）
- `model`：模型别名（如 `kimi-code/k3`），经 `normalizeKimiModel()` 归一化为 `kimi-k3`
- `usage.inputOther` / `output` / `inputCacheRead` / `inputCacheCreation`：四类 token 数
- `usageScope`：仅统计 `'turn'`（逐轮增量）；其他 scope（如未来的累计值）跳过
- 无 messageId：每个 session 独立 wire 文件，不会跨文件重复

**k2.6 旧格式**：只关心 `type === 'StatusUpdate'` 的消息：

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
- 旧格式无 model 字段，计费/展示回退为 `kimi-k2.6`

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

**默认定价**（RMB，按模型族区分，见 `src/providers/kimi/pricing.ts`）：

2026-10-25 新增 K3.1 Pro（含 Highspeed）与 K2.7 Code（含 Highspeed），完整四项费率、模型映射和估算边界见 [Provider 定价设计](v2-provider-abstraction.md#kimi-pricing)。`pricingModelKey()` 统一维护三家模型的版本映射，Kimi Provider 复用映射，防止 K3.1 套用 K3 价格。

kimi-k3（Kimi 开放平台 2026-07-16 公示）：
- Input（cache miss）：¥20.00 / 1M tokens
- Output：¥100.00 / 1M tokens
- Cache read（cache hit）：¥2.00 / 1M tokens
- Cache creation：¥20.00 / 1M tokens

kimi-k2.6：
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

<a id="quota-percentage-resolution"></a>

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

Claude Fable 5 使用独立的 `resolveFableWeeklyPct()`：从未观察到该额度时返回 `undefined` 并隐藏进度条；额度存在且重置时间到达后立即返回 `0`，保持进度条可见。`resolveResetTime()` 对 `resetAt <= now` 必须推进到严格晚于 `now` 的下一个周期，包括刚好落在重置时刻的边界。

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
  "schema": "ai-status-hub-cache-v1",
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
| `~/.kimi-code/sessions` 与 `~/.kimi/sessions` 均不存在 | 返回空聚合结果，所有计数为 0 |
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

### 多模型状态栏格式与估算隔离（0.6.0）

`calc.ts` 新增纯函数 `formatProviderStatus()`，将周与 5h 窗口合并为同一状态栏文本，复用 resolveWeeklyPct / resolveWindowPct 与来源提示，兼容百分比、绝对值和动画。`remainingQuotaColor()` 根据周剩余额度选择现有颜色阈值，边界及非有限值有测试覆盖。

每个 Provider 由扩展入口分配独立 LocalUsageService、Store 和 Scheduler，后台价格解析显式携带 Provider ID，避免切换仪表盘导致其他模型金额或校准受影响。UsageEntry 结构、retention 策略和聚合算法保持不变。

### Codex 每周单窗口适配（2026-10-25）

`calc.ts` 的 `codexRateLimitsToQuota` 按 `window_minutes` 区分 300 分钟和 10080 分钟；无时长的旧记录保留 primary=5h、secondary=7d 兼容行为。只有 primary=10080 的记录映射到周额度，并返回 `has5hLimit=false`。API headers 与本地 rate_limits 使用同一转换函数，避免错误锚点把有效成本窗口推到未来。COST 仍为本地 Token × 模型单价的估算值。

### 无五小时限额的本地分析（0.6.3）

`codexRateLimitsToQuota` 在 `has5hLimit=false` 时将本地分析终点设为当前时刻，避免 now+5h 导致起点为 now，从而排除已有记录。该终点仅供成本分析使用，不显示为套餐重置时间。

### 状态栏选择归一化（0.6.4，2026-10-26）

calc.ts 新增纯函数 normalizeStatusBarProviders(value)，供 ConfigService 读取和保存共用：保留已支持 Provider 的顺序、去重并过滤未知 ID；没有有效模型时默认 Kimi。首次启动及取消最后一个选择后均保留状态栏入口；不改变计价和用量估算。

### 提前重置的权威用量与校准（0.6.6，2026-10-26）

calc.parseCodexUsage(value, now) 解析官方只读用量 JSON，校验数字、保留 0，复用 codexRateLimitsToQuota 的按时长映射。没有合法窗口时返回 null，避免把失败响应解释为额度清零。

收到官方用量下降或窗口变化时，Scheduler 丢弃该窗口旧平滑值、重建 P/C/k；官方值为 0 且 k 不可用时，短周期保持 P=0，历史累计成本不再被误认为百分比。已知官方 Codex 快照也不能被旧会话降级覆盖。此修复不删除 Token、费用、会话或历史数据；不增加 UsageEntry 字段和历史副本。

### 配额过期提示与刷新周期（0.6.7，2026-10-28）

`formatProviderStatus` 接收 `refreshIntervalSeconds`（默认 300），将配额过期阈值设为刷新间隔 + 120 秒宽限。默认每五分钟查询 API 时，七分钟内不显示 💤，超过七分钟才显示。该标记表示 API 快照过期，与本地会话是否正在交互无关；本地用量更新不刷新 API 成功时间。`buildIndicatorSuffix` 保留显式阈值参数，来源与认证指示器保持原行为。无成功时间且无配额时仍显示过期提示，不增加历史或内存字段。

### 缓存过期判定与短周期 Token 同步（0.6.8，2026-10-28）

calc.buildIndicatorSuffix 用显式 null 判定成功时间，支持时间戳 0；CACHE_LOADED 从原 fetchedAt 恢复该时间。没有时间的 cache 数据视为过期，继续使用配置轮询间隔 + 两分钟宽限。短周期同步今日和本周期输出/缓存读取/缓存创建 Token，不新增 UsageEntry 字段或数据副本。

### Claude 日志跨模型归属（0.6.10，2026-11-05）

- `calc.claudeLogProvider(model)` 根据显式模型名称分流：路径片段中的 `kimi-*` / `kimi-code/*` / `moonshot-*` 归 Kimi，末段 `glm-*`（大小写不敏感，兼容 `z-ai/GLM-*`）归 GLM；缺失、非字符串、未知名称保留原 Claude 归属。不能从被代理隐藏为 Claude 名称的记录反推真实模型。
- `ClaudeLocalParser(providerId, projectsDir)` 默认仍为 Claude；只缓存属于目标 Provider 的条目。扫描 `~/.claude/projects` 下 JSONL，递归最多 6 层以覆盖 session/subagents；不跟随符号链接。请求 ID 优先作为去重标识，缺失时使用 message ID，避免重复内容块和跨文件副本重复计费。无标识的记录保留。
- `KimiLocalParser` 保留新版和旧版原生会话扫描，并合并一个目标为 Kimi 的 Claude parser；合并按非空标识去重。`invalidate()` / force 同时失效两个来源。目录缺失、坏行、删除文件及保留天数沿用安全跳过行为。
- GLM Provider 的 localUsage 使用目标为 GLM 的 Claude parser；LocalUsageService 继续按目标 Provider 的计价器聚合今日、窗口和周期的输入、输出、缓存读取、缓存创建、请求与费用。Kimi 使用现有按模型定价；GLM 使用现有占位费率，属于估算费用，尚无官方配额 API。
- 读取复用现有本地 parser 的 IO 边界，不在 Presenter 或编排 Service 增加直接磁盘访问；不增加 UsageEntry 字段。三个目标 parser 的缓存按模型互斥，不复制全部 Claude 条目；新增开销为目录状态和 Map 元数据，不改变每条记录的存储量及原有 365 天内存预算。聚合数组仅保存现有条目引用。
- 回归：`test/claudeLocalParser.test.ts` 覆盖归属、混合模型、子代理、重复请求、保留天数、坏行、缓存更新、删除及 Kimi 合并计价；原生 Kimi 测试注入独立 Claude 目录，避免读取用户日志。

## 火山与同名模型分流

ClaudeLocalParser 现在支持 `volcengine`。按以下顺序确定归属，每条 Claude 请求只进入一个供应商：

1. `aiStatusHub.claudeLog.sessionProviders`：会话 ID 的显式归属，优先级最高；适用于历史同名 GLM 会话。
2. 模型命名空间：`volcengine/`、`ark/`、`volcengine-coding-plan/`、`volcengine-agent-plan/` 识别为火山；其他带命名空间的模型沿用原供应商规则。
3. `aiStatusHub.claudeLog.modelProviders`：裸模型完整名的归属，忽略大小写及首尾空格。
4. 原有模型族识别：DeepSeek v4.1 Flash Economy（含 v4-1 拼写/日期后缀）归火山；裸 GLM 仍归智谱、裸 Kimi 仍归 Kimi；未知别名保留 Claude 归属。

不能根据当前 API Key、当前 Base URL 或历史模型名推断过去的请求渠道。本机已观察到 `glm-5.3-flash` 和 `glm-5-3-flash` 两种拼写，但日志未保留请求域名，不能据此保证区分。会话中途切换渠道而模型名未变化时，会话级配置也无法按请求区分，需补充可审计的渠道信息后再细分；不猜测历史流量。

扫描开始时读取归属配置快照；配置签名变化自动清除文件解析缓存，即使 JSONL 的大小和 mtime 未变化也会重算归属。保留原请求去重、递归扫描、保留期和缓存 Token 分类；Cline 的现有归属规则不应用 Claude 专用覆盖。LocalUsageService 用记录时间获取火山峰谷单价，所有 Dashboard 聚合继续消费同一份重新计价的 entries。

归属变化后即使某供应商结果变为空，Scheduler 也会清除旧 entries 和本地费用，不改变官方配额，避免残留统计导致界面看似重复。

### 0.6.24 GLM 5.3 按时间切换渠道

根据用户提供的渠道历史，新增 `aiStatusHub.claudeLog.glmVolcengineCutover`，默认 `2026-11-16T13:00:00+08:00`。裸名 GLM 5.3 系列（包括 `glm-5.3-flash`、`glm-5-3-flash`）在该时刻之前归 GLM 官方，从该时刻起归火山。使用每条 assistant 日志时间，能够在同一会话内分开切换前后的请求；不依赖当前扫描时间。该信息来自用户声明，并非根据模型拼写推断。

当前优先级：会话显式覆盖 > 明确命名空间 > 有效 GLM 5.3 切换时间规则 > 完整裸模型覆盖 > 原模型族规则。留空或无效切换时间会禁用该规则；GLM 5.30 等其他版本不匹配。缓存签名包含切换时间，设置或清空都会重算。Cline 不应用 Claude 专用切换时间规则。

### 0.6.25 火山 Kimi 与官方 Kimi 费用隔离

依据用户的实际提问及本机 Claude JSONL，resolveClaudeLogProvider 在显式会话、命名空间和模型覆盖后，将 kimi-k2-8-preview / kimi-k2.8-preview、kimi-k3.1-pro / kimi-k3-1-pro 自动归火山；k3.1-pro / k3-1-pro 和 kimi-for-coding 归官方。支持大小写、首尾空格、日期后缀及 [1m] 归属标记，未知型号后缀不误匹配。

火山 Kimi 别名仅应用于 Claude 日志。原生 Kimi 的 kimi-code/k3.1-pro 也会规范化为 kimi-k3.1-pro，因此不能在合并原生日志后再次按该名字分流。通用 claudeLogProvider 补充官方裸名和 moonshotai 命名空间，保留 Cline/原生模型族语义。各供应商先过滤自己的 entries，再使用私有价格聚合，每条 Claude 请求只进入一个供应商。Kimi 无需 14:35 分界，GLM 保留 13:00 规则；K2.8 未配置价格仍仅计 Token。

### 0.6.27 官方套餐与本地费用口径

新增 parseVolcengineCodingQuota 和 fmtReportedResetTime，分别解析官方三窗口百分比与格式化实际返回的重置时间。套餐配额并非本地费用或 Token 换算，不能把内部归一化的总量 100 标记为请求次数。月重置未知时显示破折号，不推算固定 30 天；本地火山/官方 Kimi 分流与独立计价保持既有规则。

### 0.6.30 Kimi 用量解析

新增 parseKimiQuota 解析官方新旧 API 结构：月度共享和 Code 专用池、5 小时/周窗口均独立。使用严格有限非负数判断，合法 0 不视作缺失，未知/非法字段不转成 0%；旧格式优先由 limit / used / remaining 解析并按 duration/timeUnit 找到 5 小时窗口。月数据只能来自服务端，不从本地日志费用、周额度或加油包余额推导。formatProviderStatus 支持只有月窗口的快照。

## 0.6.33：GLM 官方切回与动态窗口修复

现场日志证据：同一 Claude 会话内，火山返回 message.model=glm-5-3-flash，17:22 后切回官方返回 glm-5.3-flash；两者 requestedModel 均为 glm-5.3-flash[1m]，不能用于渠道判断。旧的 13:00 时间规则误将后续官方请求划入火山。修正 resolveClaudeLogProvider：会话覆盖 → 命名空间 → 模型覆盖 → 已核对的官方点号 Flash 回复名 → 剩余 GLM 5.3 时间规则 → 其他已核对名称。时间配置仍可禁用，显式归属仍可覆盖。

官方文档 https://docs.bigmodel.cn/cn/coding-plan/overview 说明五小时积分按每次消耗五小时后动态恢复，周积分从套餐下单时起按七天刷新。GLM LocalUsageService 的五小时费用、Token 与请求数统一按 now−5h 汇总，不用 nextResetTime−5h 划桶；周窗口继续采用官方 weeklyResetAt−7d，不把积分百分比换算为金额。其他供应商沿用原边界策略。归属修复会重新读原日志，不修改原记录，火山不再包含这批 GLM 官方请求。

## 0.6.35：DeepSeek 官方本地估算

ClaudeLogProviderId 增加 deepseek；先识别显式 Ark 命名空间及 Economy 模型为火山，再识别 DeepSeek 命名空间和裸 DeepSeek 模型为官方。显式会话/模型覆盖仍优先。deepseek-flash、deepseek-v4-flash（含 vision-exp）、deepseek-v4.1-flash（含版本后缀）共用官方 Flash 费率，deepseek-v4-pro 使用官方 Pro 费率；Economy 不套官方费率。

不同渠道可能返回相同裸模型名（尤其 v4-pro、v4-flash）；日志未记录端点时无法可靠自动识别来源，需显式会话/模型归属。当前凭据不能用来推断历史请求。官方 Claude 日志独立扫描、去重与保留，不纳入火山 Economy 请求。原始日志不改写。

calc.ts 新增 parseDeepseekBalance（严格校验响应币种、数值及布尔可用状态，真实零/负余额有效，优先显示配置币种，无该币种则显示实际可用币种），formatAccountBalance（统一双语余额/赠送/充值文本），isDeepseekPeak（UTC+8 时段及假期排除）。余额不用于本地额度校准、分母或虚构请求总数。

## 0.6.37：有界 JSONL 流式读取

现场扩展宿主三次崩溃的 minidump 异常码为 Chromium OUT_OF_MEMORY（0xe0000008）；本机 Claude 日志合计约 1.6 GiB，最大文件约 396 MiB。旧实现 readFile 全文后 split，多个供应商并行扫描时会同时保留大文本和数组，存在明显内存峰值风险。不能仅凭转储将所有其他扩展因素排除。

LocalUsageService.readJsonl 集中管理流式磁盘访问：64 KiB 字节块、增量 MD5 指纹、逐行回调，不保存原始会话正文；先拼接完整记录字节再 UTF-8 解码，正确处理跨块多字节字符、CRLF 和无末尾换行。单条记录上限 8 MiB，超长记录跳过至下一换行并记录数量警告，不打印原文或密钥、不修改源日志。若超长记录自身包含 usage，该条用量不会计入，需在诊断中注意日志警告。读取或回调失败返回 null，finally 关闭流，调用方保留既有缓存以便下次重试。

ClaudeLocalParser、KimiLocalParser 只保留精简用量条目，不再整文件读取/拆分。跨文件去重、模型归属和保留期不变。Codex 原生扫描也复用此服务，详见 Provider 设计。

独立进程以 --max-old-space-size=128 启动，七个扫描器并行读取现场日志成功；采样 JS heap 峰值约 39 MiB、进程 maxRSS 约 155 MiB。Node 报告的总 heap limit 为约 320 MiB，该命令仅限制 old space，不能称为总内存上限。未重启或修改用户正在运行的 VS Code。

## 0.6.38：Kimi 网页会员比例解析

calc.ts 新增 parseKimiMembershipUsage，解析实际 protobuf JSON 的 subscription_balance.amount_used_ratio / kimi_code_used_ratio，兼容对应 camelCase。必须存在有限非负的总比率才算有效；真实零值有效、显示封顶 100%，缺失字段不当 0。比率乘 100 成为现有月度显示字段；Code 是总月池的一部分，不能与总比例相加。expiry 只采用响应 expire_time，不猜测自然月重置。

monthlyFromMembership 和 monthlyCodeIsShared 标记网页来源与 Code 占比口径；只补充缺失的 Coding 月总量。该路径不变更本地日志归属、费用和 token 汇总，不把账户余额或会员池量转换为金额。

## 0.6.39：Kimi 月度组成

formatKimiMonthlyBreakdown 仅对 monthlyCodeIsShared=true 且总量/Code 均为有限合法百分比、Code 不大于总量的快照生成分段。Kimi=总量−Code，Code 保持原值；宽度按完整月池百分比计算（不是占已用比例），空白仍代表剩余额度。返回两段宽度与中英文详情，分别说明占月额度、占已用额度。零值有效，不将独立 Code 月额度相减，不为缺失/矛盾数据推算分类。

## 0.6.40：月度图例格式化

formatKimiMonthlyBreakdown 新增 kimiLegend/codeLegend，通过双语 dashboard.kimiMonthLegend 与 formatPercent(..., 2) 生成标签和占月池百分比，供 Dashboard 直接绑定文本；保留原详细悬停说明和共享池校验。
