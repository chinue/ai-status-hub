# AI Status Hub 编码强制规范

> **本规范对 `src/` 下所有模块具有强制约束力。**
> 任何新增代码、重构、Bug 修复都必须通过本规范检查清单后方可合入。

---

## 1. 磁盘访问隔离（铁律）

**只有 `LocalUsageService` 和 `CacheService` 可以访问磁盘。**

| 模块 | 能否访问磁盘 | 说明 |
|---|---|---|
| `LocalUsageService` | ✅ | 唯一读取 `~/.kimi/sessions` 的模块 |
| `CacheService` | ✅ | 读写 `~/.kimi/ai-status-hub-cache-v2.json` |
| `Scheduler` | ✅ 间接 | 调用 `LocalUsageService` / `CacheService`，本身不直接 IO |
| `StatusBarPresenter` | ❌ | 只从 `store.getState()` 读取 |
| `DashboardPanel` | ❌ | 只从 `store.getState()` 读取 |
| `ApiService` / `AuthService` | ✅ 网络 | 允许 HTTP 请求，但禁止本地磁盘 IO（除 SecretStorage） |

**违规示例**：
```typescript
// ❌ 禁止 —— Presenter 直接访问磁盘
import { LocalUsageService } from '../services/localUsageService';
const usage = await LocalUsageService.getInstance().getLocalUsage();
```

**正确做法**：
```typescript
// ✅ 正确 —— 从内存 state 读取
const lu = store.getState().localEstimate;
```

---

## 2. 数据保留周期

### 2.1 配置项

`aiStatusHub.dataRetentionDays`：控制 LocalUsageService 保留历史 entries 的天数。

- **默认值**：365
- **范围**：30 – 3650（约 10 年）
- **单位**：天

### 2.2 过滤规则

`LocalUsageService.scanAllFiles()` 在解析 entry 后，必须丢弃超出 retention 的数据：

```typescript
const retentionStart = now - dataRetentionDays * 24 * 3600 * 1000;
if (entry.timestamp < retentionStart) continue; // 丢弃过期数据
```

聚合窗口（today / 5h / 7d）保持不变，只受 retention 上限控制。

---

## 3. 内存预算（双红线）

### 3.1 新增数据字段前必须做内存估算

新增字段（包括新增聚合指标、新增时间窗口、新增列式数组）前，按以下公式计算：

| 指标 | 公式 | 红线 |
|---|---|---|
| **年日均用量** | 有效天（用量 > 0 的天）总内存 ÷ 有效天数 | × dataRetentionDays ≤ **200MB** |
| **年内日最大用量** | 全年单日最大内存峰值 | × dataRetentionDays ≤ **400MB** |

> **注意**：年日均用量只统计**有效天**（用量 > 0 的天），0 用量天不纳入平均。

### 3.2 计算示例

假设用户实际数据（17 天有效）：
- 有效天总内存：1.05 MB
- 有效天数：17
- 年日均用量：1.05MB ÷ 17 ≈ **62 KB/天**
- 年内日最大用量：**242 KB**

标准年（365 天）：
- 62KB × 365 ≈ **22.6 MB** < 200MB ✅
- 242KB × 365 ≈ **86.3 MB** < 400MB ✅

### 3.3 超过红线的处理流程

如果任一指标超过红线：
1. **停止新增**，不得自行合入
2. **向用户报告**：
   - 当前内存估算结果
   - 超标指标和超标倍数
3. **给出可行建议**（至少提供 2 种）：
   - 缩短 `dataRetentionDays`
   - 改用列式存储（Struct-of-Arrays）
   - 数据采样（如只保留每 N 条）
   - 压缩存储（如用 TypedArray）
4. **等待用户确认**后方可继续

---

## 4. 格式化统一封装

**所有可能被多处使用的格式化、计算、显示逻辑必须封装为纯函数，统一放在 `src/calc.ts`。**

禁止在 Presenter、Service 或前端脚本中内联格式化逻辑。

### 4.1 已封装函数清单

| 函数 | 用途 | 使用位置 |
|---|---|---|
| `fmtDuration(totalSeconds)` | 时间格式（`2d03h` / `45m30s` / `5s`） | tooltip、dashboard、状态栏 |
| `fmtHours(hours)` | 小时 → 格式化时长 | tooltip 重置时间 |
| `fmtTokens(n)` | Token 数（`1.2M` / `3.5k`） | tooltip 表格、dashboard |
| `fmtCost(rmb)` | 成本（`¥12.34`） | tooltip 表格、dashboard |
| `formatPercent(pct, decimals)` | 百分比（`25.3%`） | 状态栏、dashboard |
| `formatPercentPadded(pct, decimals)` | 固定宽度百分比（` 25.34%`） | tooltip |
| `buildBar(util, width)` | Unicode 进度条 | 状态栏、tooltip |
| `drawBorderTable(header, rows, align)` | CJK 感知的边框表格 | tooltip |

### 4.2 前端 WebView 中的处理

Dashboard 的 WebView 无法直接导入后端模块。当前方案：
- `fmtDuration` 和 `formatPercent` 已内联到前端 `<script>` 中
- **禁止新增内联函数**；如需新增，必须先在后端 `calc.ts` 中定义，再同步内联到前端

---

## 5. i18n 强制规范

**所有用于显示的字符串（除纯数值、单位符号如 `%`、`¥`、`#`）必须通过 `makeT()` 翻译，禁止硬编码。**

### 5.1 已支持语言

- `en`（英文）
- `zh-CN`（简体中文）

### 5.2 添加新字符串的流程

1. 在 `src/i18n.ts` 的 `dict.en` 和 `dict['zh-CN']` 中同时添加键值对
2. 在代码中使用 `t('key')` 调用
3. **禁止只添加一种语言**（必须双语同时添加）

### 5.3 硬编码字符串检查清单

以下硬编码字符串已在 v0.1.5 中全部修复为 i18n 键：

| 位置 | 原硬编码 | i18n 键 | 修复版本 |
|---|---|---|---|
| statusBar.ts | `'Resume auto-refresh'` | `tooltip.resumeAutoRefresh` | v0.1.5 |
| statusBar.ts | `'Pause auto-refresh'` | `tooltip.pauseAutoRefresh` | v0.1.5 |
| statusBar.ts | `'Quota Summary'`（fallback） | `tooltip.table.quotaSummary` | v0.1.5 |
| statusBar.ts | `'Parallel'`（fallback） | `tooltip.table.col.parallel` | v0.1.5 |
| dashboard.ts | `'Loading…'` | `dashboard.loading` | v0.1.5 |
| dashboard.ts | `'5h window'` | `dashboard.window5h` | v0.1.5 |
| dashboard.ts | `'7d window'` | `dashboard.window7d` | v0.1.5 |
| dashboard.ts | `'just now'` | `dashboard.justNow` | v0.1.5 |
| dashboard.ts | `'m ago'` | `dashboard.minutesAgo` | v0.1.5 |
| dashboard.ts | `'Last updated: '` | `dashboard.lastUpdated` | v0.1.5 |

> 新增显示字符串时，必须同步添加到 `src/i18n.ts`（中英双语），并更新本清单。

---

## 6. 异常防护与防崩溃规范

**凡是可能引发异常的操作，必须添加 `try-catch` 或等效的错误处理机制，禁止裸抛异常导致扩展崩溃。**

### 6.1 必须加 try-catch 的场景（强制）

| 场景 | 示例 | 处理方式 |
|---|---|---|
| 磁盘 IO | `fs.readFileSync`、`fs.readdirSync` | `try-catch` + 返回安全默认值 |
| 网络请求 | `fetch`、`axios`、HTTP API | `try-catch` + 降级到缓存或显示错误状态 |
| JSON 解析 | `JSON.parse` | `try-catch` + 返回 `{}` / `[]` |
| 正则匹配（动态输入）| `new RegExp(userInput)` | `try-catch` + 使用转义后的备用正则 |
| 类型转换（外部数据）| `Number(x)`、`BigInt(x)` | 先校验再转换，异常时返回默认值 |
| 数组/对象访问（不确定键）| `arr[i]`、`obj[key]` | 先做 `in` / `hasOwnProperty` 检查 |
| 第三方库调用 | VS Code API、外部 npm 包 | `try-catch` + 记录日志，禁止向上抛 |

### 6.2 防御性编程清单

- **空值检查**：对函数参数、API 返回值、`store.getState()` 中的可选字段，使用 `??` 或 `?.` 提供默认值
  ```typescript
  // ✅ 正确
  const usage = store.getState().localEstimate?.today ?? { inputTokens: 0, outputTokens: 0 };
  // ❌ 错误
  const usage = store.getState().localEstimate.today; // 可能 undefined 导致崩溃
  ```

- **边界检查**：数组索引、字符串 slice 前确认长度
  ```typescript
  // ✅ 正确
  const item = i < arr.length ? arr[i] : fallback;
  // ❌ 错误
  const item = arr[i]; // i 可能越界
  ```

- **异步错误必须处理**：所有 Promise 必须 `await` 并包裹 `try-catch`，或至少附加 `.catch()`
  ```typescript
  // ✅ 正确
  async function refresh() {
    try { await api.fetch(); } catch (e) { log.error('refresh failed', e); }
  }
  // ❌ 错误
  api.fetch(); // 未处理的 rejection 会导致扩展崩溃
  ```

- **定时器生命周期管理**：所有 `setInterval`、`setTimeout` 必须在 `deactivate()` / `dispose()` 中清理
  ```typescript
  private intervalId: NodeJS.Timeout | undefined;
  start() { this.intervalId = setInterval(() => {...}, 1000); }
  dispose() { if (this.intervalId) { clearInterval(this.intervalId); this.intervalId = undefined; } }
  ```

- **事件监听器必须移除**：`vscode.Disposable`、DOM `addEventListener` 都要在卸载时清理

- **外部数据校验**：API 响应、文件内容、用户输入必须先校验类型和范围，再使用
  ```typescript
  // ✅ 正确
  if (!data || typeof data.tokens !== 'number' || data.tokens < 0) { return fallback; }
  // ❌ 错误
  const tokens = data.tokens; // data 可能是 null 或格式不符
  ```

- **WebView 消息校验**：Dashboard 与后端通信时，必须校验消息 `command` 字段，拒绝未知指令
  ```typescript
  // ✅ 正确
  if (message.command === 'refresh') { ... }
  else { log.warn('unknown command', message.command); }
  // ❌ 错误
  this[message.command](); // 任意命令执行风险
  ```

- **禁止阻塞主线程**：大量数据计算（如大文件解析）应使用 chunked 处理或 worker，避免 UI 冻结

- **资源释放**：文件句柄、网络连接、临时变量在使用完毕后及时释放或置为 `undefined`

### 6.3 错误处理原则

1. **优雅降级**：发生异常时，返回安全默认值或进入降级模式，禁止向上抛导致扩展崩溃
2. **日志记录**：所有 caught 异常必须记录（`console.error` 或日志系统），便于排查
3. **用户感知**：影响用户体验的错误（如网络失败）应在状态栏或 tooltip 中给出简要提示
4. **静默失败**：非核心功能（如缓存刷新）失败时，允许静默降级，不打扰用户

---

## 7. 审查检查清单

提交代码前，逐条确认：

- [ ] 没有 Presenter 直接导入 `LocalUsageService`
- [ ] 没有内联 `padStart` / `padEnd` / `toFixed` 格式化逻辑
- [ ] 没有新增未受 `dataRetentionDays` 限制的 entries 缓存
- [ ] 新增字段前已做内存估算，双红线均满足
- [ ] 所有新增/修改的显示字符串已添加到 `src/i18n.ts`（中英双语）
- [ ] 所有百分比显示统一使用 `formatPercent`（后端）或内联 `formatPercent`（前端）
- [ ] **所有可能异常的调用（IO、网络、JSON.parse、第三方库）已加 `try-catch`**
- [ ] **所有异步操作已处理 rejection，没有裸 `api.fetch()`**
- [ ] **所有 `setInterval` / `setTimeout` 已在 `dispose()` 中清理**
- [ ] **外部数据（API、文件、用户输入）已有类型/范围校验**
- [ ] 66+ 测试全部通过
- [ ] `node esbuild.js --production` 编译成功
