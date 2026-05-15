# AI Status Hub v2 重建设计文档

> 版本：v2.0.0-draft  
> 日期：2026-05-10  
> 状态：待评审  

---

## 1. 为什么重建

v0.3.x 的补丁式修复已触及架构极限：

- **状态修改点分散**：`DataManager` 单例被 4+ 个独立组件（short timer / long timer / sessionMonitor / command handlers）同时修改
- **定时器重叠**：双定时器 + `isRefreshing` 锁 + `forceRefresh` 手动重置，导致竞态条件难以复现和修复
- **认证与数据不同步**：UI 层每次更新都重新读取 `SecretStorage`，而数据已从缓存恢复，造成"有数据但提示未登录"
- **文件 I/O 阻塞主线程**：`sessionMonitor` 使用 `fs.readSync`，tooltip 每次渲染都重新扫描整个 `~/.kimi/sessions`
- **缓存版本碎片化**：v1 → v2 只是字段增减，没有统一的 schema migration 机制

**重建目标**：保留全部业务功能，用 1/3 的代码量实现，核心原则是**单一状态源 + 明确的状态机 + 所有副作用隔离在边界**。

---

## 2. 架构总览

```
┌─────────────────────────────────────────────────────────────┐
│                    VS Code Extension Host                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  StatusBar  │  │  Dashboard  │  │  Commands / Events  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘  │
│         │                │                    │             │
│         └────────────────┴────────────────────┘             │
│                          │                                  │
│                    ┌─────┴─────┐                            │
│                    │  Store    │  ← 单一状态源，只读给 UI     │
│                    │ (QuotaState + UIState)                 │
│                    └─────┬─────┘                            │
│                          │                                  │
│         ┌────────────────┼────────────────┐                 │
│         │                │                │                 │
│    ┌────┴────┐    ┌─────┴─────┐   ┌──────┴──────┐         │
│    │  Auth   │    │  Scheduler│   │  Persistor  │         │
│    │ Service │    │ (唯一定时)│   │ (Cache/Log) │         │
│    └────┬────┘    └─────┬─────┘   └──────┬──────┘         │
│         │               │                 │                │
│    ┌────┴────┐    ┌─────┴─────┐   ┌──────┴──────┐         │
│    │ Secret  │    │  API      │   │  FileSystem │         │
│    │ Storage │    │  Client   │   │             │         │
│    └─────────┘    └───────────┘   └─────────────┘         │
└─────────────────────────────────────────────────────────────┘
```

### 核心原则

1. **单一状态源**：所有 UI 组件只从 `Store.getState()` 读取，`Store` 只通过明确的 `dispatch(action)` 修改
2. **副作用隔离**：所有异步操作（API 调用、文件读取、 SecretStorage 访问）封装在 Service 层，Service 层**不直接修改状态**，只返回数据给 Store
3. **唯一定时器**：只有一个 `Scheduler`，通过 `setTimeout` 链（非 `setInterval`）实现，避免重叠和漂移
4. **永不崩溃**：每个 Service 入口都有 `try/catch`，错误转为 `state.error`，不会抛到 Extension Host

---

## 3. 状态管理

### 3.1 State 结构

```typescript
interface AppState {
  // --- 数据层 ---
  quota: QuotaData | null;          // API 返回的配额数据
  lastFetchAt: number | null;       // 最后一次 API 成功时间
  error: string | null;             // 当前错误信息
  authStatus: 'unknown' | 'authenticated' | 'missing' | 'expired' | 'failed';

  // --- 本地估算层 ---
  localEstimate: {
    weeklyPct: number;
    windowPct: number;
    calibratedAt: number;           // 上次校准时间
    tokenCapacity: number | null;   // 基于 API 校准的容量
    costCapacity: number | null;    // 基于 API 校准的 5h 成本容量
  } | null;

  // --- UI 层 ---
  ui: {
    displayMode: 'percent' | 'absolute';
    isPaused: boolean;
    dashboardOpen: boolean;
  };
}

interface QuotaData {
  weeklyLimit: number;
  weeklyUsed: number;
  weeklyUsedPct: number;
  weeklyResetAt: number;
  windowLimit: number;
  windowUsed: number;
  windowRemaining: number;
  windowUsedPct: number;
  windowResetAt: number;
  parallelLimit: number;
}
```

### 3.2 状态修改：Action 驱动

```typescript
type Action =
  | { type: 'CACHE_LOADED'; payload: QuotaData }
  | { type: 'API_SUCCESS'; payload: QuotaData }
  | { type: 'API_ERROR'; payload: { error: string; authFailed?: boolean } }
  | { type: 'LOCAL_ESTIMATE'; payload: { weeklyPct: number; windowPct: number } }
  | { type: 'AUTH_STATUS'; payload: AppState['authStatus'] }
  | { type: 'UI_SET_DISPLAY_MODE'; payload: 'percent' | 'absolute' }
  | { type: 'UI_SET_PAUSED'; payload: boolean }
  | { type: 'SIGN_OUT' };
```

```typescript
class Store {
  private state: AppState;
  private listeners = new Set<(s: AppState) => void>();

  dispatch(action: Action): void {
    const next = reducer(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach(fn => {
        try { fn(this.state); } catch (e) { log('listener error', e); }
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

**关键变化**：UI 层（StatusBar、Dashboard）不再直接调用 `readOAuth()` 判断鉴权，而是从 `state.authStatus` 读取。`authStatus` 由 `AuthService` 在适当时机（启动时、API 401 时、用户主动登出时）更新。

---

## 4. 定时器与刷新策略

### 4.1 旧架构的问题

- `setInterval`：回调可能重叠，需要 `isRefreshing` 锁
- 双定时器：short（5s）和 long（60s）独立运行，状态竞争
- `forceRefresh()`：手动重置 `longTimer`，容易和正在执行的 tick 冲突

### 4.2 新架构：单一 `setTimeout` 链

```typescript
class Scheduler {
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private nextTickAt = 0;

  constructor(
    private readonly shortMs: number,
    private readonly longMs: number,
    private readonly onTick: (mode: 'short' | 'long') => Promise<void>
  ) {}

  start(): void {
    if (this.running) return;
    this.running = true;
    this.schedule(Date.now() + 100); // 启动后 100ms 首次执行
  }

  stop(): void {
    this.running = false;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  /** 用户手动刷新：取消当前等待，立即执行 long tick */
  force(): void {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.schedule(Date.now() + 50);
  }

  private schedule(at: number): void {
    if (!this.running) return;
    this.nextTickAt = at;
    const delay = Math.max(0, at - Date.now());
    this.timer = setTimeout(() => this.tick(), delay);
  }

  private async tick(): Promise<void> {
    if (!this.running) return;
    const now = Date.now();
    const isLong = now - lastLongTick >= this.longMs;
    const mode: 'short' | 'long' = isLong ? 'long' : 'short';

    try {
      await this.onTick(mode);
    } catch (err) {
      log('Scheduler tick error', err);
    }

    // 计算下次触发时间
    const sinceLong = now - lastLongTick;
    const nextLong = lastLongTick + this.longMs;
    const nextShort = now + this.shortMs;
    this.schedule(Math.min(nextLong, nextShort));
  }
}
```

**关键点**：
- 只有一个 `setTimeout`，不会重叠
- `force()` 只是重新安排时间，不会和正在执行的 tick 冲突（因为 tick 内部是 `await`，执行完才会 schedule 下一次）
- 没有 `isRefreshing` 锁，因为不会有两个 tick 同时执行

---

## 5. 认证设计

### 5.1 AuthService

```typescript
class AuthService {
  private cachedToken: string | null = null;
  private cachedAt = 0;

  constructor(private secrets: vscode.SecretStorage) {}

  /** 启动时调用一次，之后只在 token 失效时重新获取 */
  async resolveToken(): Promise<string | null> {
    if (this.cachedToken && Date.now() - this.cachedAt < 60_000) {
      return this.cachedToken; // 缓存 60s，避免频繁读 SecretStorage
    }
    const token = await this.fetchFreshToken();
    this.cachedToken = token;
    this.cachedAt = Date.now();
    return token;
  }

  async fetchFreshToken(): Promise<string | null> {
    // 1. 读 OAuth
    // 2. 过期则 refresh
    // 3. 无 OAuth 则读 API Key
    // 4. 无 API Key 则读 CLI credentials 文件
    // 5. 都没有返回 null
  }

  invalidate(): void {
    this.cachedToken = null;
  }
}
```

### 5.2 认证状态流转

```
unknown → authenticated  (启动时 resolveToken 成功)
unknown → missing         (启动时 resolveToken 返回 null)
authenticated → expired   (API 返回 401)
authenticated → failed    (API 返回 403 或其他 auth 错误)
expired → authenticated   (refresh 成功)
any → missing             (用户 sign out)
```

**UI 层不再直接读 SecretStorage**，只从 `store.state.authStatus` 读取。

---

## 6. 缓存设计

### 6.1 缓存文件结构

```json
{
  "version": 2,
  "schema": "ai-status-hub-cache-v2",
  "writtenAt": "2026-05-10T21:00:00.000Z",
  "data": {
    "quota": { ... },
    "calibration": {
      "tokenCapacity": 12345678,
      "costCapacity": 45.67,
      "calibratedAt": 1715355600000
    }
  }
}
```

### 6.2 CacheService

```typescript
class CacheService {
  private readonly SCHEMA = 'ai-status-hub-cache-v2';
  private readonly CURRENT_VERSION = 2;

  async read(): Promise<{ quota: QuotaData; calibration: Calibration } | null> {
    try {
      const raw = await fs.readFile(this.path, 'utf-8');
      const parsed = JSON.parse(raw);
      if (parsed.schema !== this.SCHEMA || parsed.version !== this.CURRENT_VERSION) {
        return null; // 版本不匹配，丢弃
      }
      return parsed.data;
    } catch {
      return null;
    }
  }

  async write(data: { quota: QuotaData; calibration: Calibration }): Promise<void> {
    const payload = {
      version: this.CURRENT_VERSION,
      schema: this.SCHEMA,
      writtenAt: new Date().toISOString(),
      data
    };
    await fs.writeFile(this.path, JSON.stringify(payload, null, 2));
  }
}
```

**关键变化**：
- `schema` 字段用于语义版本控制，不只是数字版本号
- 缓存只包含 `QuotaData` 和 `Calibration`，不包含任何 UI 状态
- 读写完全封装在 `CacheService`，其他模块不直接操作文件

---

## 7. 状态栏与仪表盘

### 7.1 StatusBar

```typescript
class StatusBarPresenter {
  private items: {
    weekly: vscode.StatusBarItem;
    window: vscode.StatusBarItem;
    pause: vscode.StatusBarItem;
  };

  constructor(private store: Store) {
    this.items = { ... };
    store.subscribe((state) => this.render(state));
  }

  private render(state: AppState): void {
    // Pause button always visible
    this.items.pause.text = '⏸️';
    this.items.pause.tooltip = state.ui.isPaused ? 'Resume auto-refresh' : 'Pause auto-refresh';

    // When paused, hide data items and show only pause button
    if (state.ui.isPaused) {
      this.items.weekly.hide();
      this.items.window.hide();
      return;
    }

    if (state.authStatus === 'missing') {
      this.items.weekly.text = '$(key) Kimi: sign in';
      this.items.weekly.command = 'aiStatusHub.signIn';
      this.items.window.hide();
      return;
    }

    if (state.authStatus === 'failed') {
      this.items.weekly.text = '$(warning) Kimi: auth failed';
      this.items.weekly.command = 'aiStatusHub.signIn';
      this.items.window.hide();
      return;
    }

    if (!state.quota) {
      // 数据加载中，显示 spinner
      this.items.weekly.text = '$(sync~spin) Kimi…';
      return;
    }

    // 正常状态：从 state.quota 读取，不再调任何异步方法
    const metrics = computeUtilization(state.quota);
    this.items.weekly.text = `🌘 Kimi:${formatPercent(metrics.weeklyPct, 1)}`;
    this.items.window.text = `5️⃣ ${metrics.windowMiniBar} ${formatPercent(metrics.windowPct, 1)}`;
    this.items.weekly.show();
    this.items.window.show();
  }
}
```

**关键变化**：`render()` 是纯同步函数，不调用 `readOAuth()`、不构建 tooltip。Tooltip 在 `statusBar.ts` 的 `buildTooltip()` 中通过 `vscode.MarkdownString` 直接构建，鼠标悬停时懒加载。

### 7.2 Dashboard

- 打开时从 `store.getState()` 读取当前状态
- 订阅 store 更新，通过 `postMessage` 推送
- WebView 加载完成后发送 `ready` 消息，extension 立即推送当前状态，解决初始数据同步问题
- 每个进度条下方显示 `resets in XhYm` 倒计时，数据来自 `quota.windowResetAt` / `quota.weeklyResetAt`
- 内部使用独立的 `requestAnimationFrame` 节流渲染，不依赖外部 throttle

---

## 8. 错误处理策略

### 8.1 三层防护

| 层级 | 职责 | 实现 |
|---|---|---|
| **Service 边界** | 捕获所有异步错误 | 每个 Service 方法 `try/catch`，错误转为返回值 `{ ok: false, error }` |
| **Store 边界** | 确保 reducer 永不抛错 | reducer 对非法 action 静默忽略 |
| **UI 边界** | 确保渲染永不抛错 | `subscribe` 回调包裹 `try/catch`，单个 listener 失败不影响其他 |

### 8.2 错误状态机

```
API_SUCCESS → error = null, authStatus = 'authenticated'
API_ERROR (401) → error = 'Unauthorized', authStatus = 'expired', 触发 token refresh
API_ERROR (403) → error = 'Forbidden', authStatus = 'failed'
API_ERROR (其他) → error = message, authStatus 保持不变
NETWORK_ERROR → error = 'Network error', authStatus 保持不变
```

---

## 9. 文件结构

```
ai-status-hub/
├── src/
│   ├── extension.ts          # 入口：初始化 Store + Services + Presenters
│   ├── store.ts              # Store + reducer（单一状态源）
│   ├── types.ts              # 所有类型定义
│   ├── calc.ts               # 计算函数（纯函数，无副作用）
│   ├── i18n.ts               # 国际化
│   ├── config.ts             # 配置读取
│   ├── services/
│   │   ├── authService.ts    # 认证 + token 管理
│   │   ├── apiService.ts     # HTTP 调用
│   │   ├── cacheService.ts   # 磁盘缓存读写
│   │   ├── localUsageService.ts  # 本地 JSONL 扫描（独立 Service，不直接改状态）
│   │   └── scheduler.ts      # 单一 setTimeout 调度器
│   ├── presenters/
│   │   ├── statusBar.ts      # 状态栏 + Tooltip 构建（纯渲染，无业务逻辑）
│   │   └── dashboard.ts      # 仪表盘 webview
│   └── utils.ts              # 通用工具
├── test/
│   └── ...                   # 单元测试
├── package.json
├── tsconfig.json
└── esbuild.js
```

---

## 10. 与旧版本的关键差异

| 维度 | v0.3.x | v2 |
|---|---|---|
| **状态管理** | `DataManager` 单例，多处直接修改 `this.state` | `Store` + `reducer`，所有修改通过 `dispatch(action)` |
| **定时器** | `setInterval` 双定时器 + `isRefreshing` 锁 | 单一 `setTimeout` 链，天然防重叠 |
| **认证检查** | UI 层每次更新都读 `SecretStorage` | `AuthService` 统一解析，`UI` 只读 `state.authStatus` |
| **本地文件扫描** | `sessionMonitor` 同步 `fs.readSync` + tooltip 每次都扫 | `localUsageService` 异步扫描，结果缓存 30s |
| **缓存版本** | 数字版本号，无 schema | `schema` 字符串 + 版本号，明确淘汰旧缓存 |
| **错误处理** | 局部 `try/catch`，异常可能传播 | 三层防护：Service → Store → UI，每层独立捕获 |
| **代码量预估** | ~3000 行 | ~1500 行（保留全部功能） |

---

## 11. MVP 范围与迭代计划

### Phase 1：MVP（核心功能，2-3 小时）

> **实现文档**：`v2-phase1-implementation.md`

- [x] 状态栏显示 weekly/window 百分比
- [x] 每 60s 自动刷新 API
- [x] 磁盘缓存（启动时恢复）
- [x] OAuth + API Key 登录
- [x] 手动刷新命令
- [x] 基础仪表盘（显示百分比和进度条）

### Phase 2：本地估算（1 小时）

> **设计文档**：`v2-local-estimation-design.md`  
> **实现文档**：`v2-phase2-implementation.md`

- [x] 本地 JSONL 扫描（异步，缓存 30s）
- [x] Token 容量校准
- [x] Short tick（5s）本地估算
- [x] 缓存持久化校准数据
- [x] UI fallback 到本地估算

### Phase 3：高级功能（1-2 小时）

> **设计文档**：`v2-dashboard-design.md`  
> **实现文档**：`v2-phase3-implementation.md`（待开发）

- [ ] 成本计算与显示
- [ ] 费用变化曲线（5h + 7d）
- [ ] 热力图 / 趋势图
- [ ] 预算告警
- [ ] 模型明细（多模型预留）
- [ ] Session 监控（可选，默认关闭）

---

## 12. 重建位置建议

**方案 A：当前目录内 `v2/` 子目录（推荐）**
```
d:\code\vscode\kimi-usage\        # 当前工程（保留，作为参考）
├── src/                          # 旧代码
├── v2/                           # 新工程
│   ├── src/
│   ├── package.json
│   └── ...
```
- 优点：同一 VS Code 窗口内可对比旧代码；共用 git 仓库；`node_modules` 可软链接
- 缺点：`.gitignore` 需要忽略 `v2/` 的构建产物

**方案 B：同级目录新建文件夹**
```
d:\code\vscode\kimi-usage\        # 旧工程
d:\code\vscode\ai-status-hub-v2\ # 新工程
```
- 优点：完全隔离，无交叉污染
- 缺点：需要新开 VS Code 窗口，无法快速对比旧代码

**建议**：选方案 A，新代码放在 `v2/` 目录，稳定后迁移到根目录覆盖旧代码。

---

## 13. 待确认事项

1. **是否保留本地 JSONL 扫描？** 这是当前崩溃的高危区域，但提供了精确的本使用量。建议 Phase 2 再加回。
2. **是否保留 Session Monitor（文件系统监听器）？** 建议 Phase 3 再加回，默认关闭。
3. **仪表盘是否保留 retainContextWhenHidden？** 建议保留，否则用户切换标签页后数据丢失。
4. **重建位置**：确认 `v2/` 子目录还是同级新文件夹？

---

*文档结束。确认后我开始 Phase 1 开发。*
