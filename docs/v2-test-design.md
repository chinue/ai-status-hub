# AI Status Hub v2 测试设计文档

> 版本：v1.0.0-draft  
> 日期：2026-05-10  
> 状态：Phase 1 配套文档  
> 前置文档：`v2-phase1-implementation.md`

---

## 1. 测试策略

### 1.1 测试金字塔

```
        ▲
       / \
      / E2E \      1-2 个：扩展激活/仪表盘打开（可选）
     /-------\
    / 集成测试 \   4-5 个：Scheduler tick 流程、StatusBar render
   /-----------\
  /  单元测试    \  15-20 个：reducer、calc、Service 方法
 /---------------\
/_________________\
```

### 1.2 测试原则

| 原则 | 说明 |
|---|---|
| **纯函数优先** | `calc.ts`、`store.ts` reducer 必须 100% 覆盖，零 mock |
| **Service 边界测试** | 每个 Service 的 public 方法独立测试，内部私有方法不直接测 |
| **Presenter 集成测试** | mock Store，验证 `subscribe → render` 链路 |
| **不测 vscode API** | `vscode.*` 全部 mock，不测 VS Code 自身行为 |
| **不测网络** | `fetch` 全部 mock，用固定 JSON 响应 |

---

## 2. 测试框架配置

沿用旧工程的 **Mocha + ts-node**，无需切换。VS Code 扩展生态以 Mocha 为主流。

### 2.1 依赖

```json
{
  "devDependencies": {
    "mocha": "^10.2.0",
    "@types/mocha": "^10.0.6",
    "chai": "^4.4.1",
    "@types/chai": "^4.3.11",
    "ts-node": "^10.9.2",
    "sinon": "^17.0.1",
    "@types/sinon": "^17.0.3"
  }
}
```

### 2.2 `.mocharc.json`

```json
{
  "extension": ["ts"],
  "spec": ["test/**/*.test.ts"],
  "require": [
    "ts-node/register/transpile-only",
    "test/setup.ts"
  ],
  "reporter": "spec",
  "timeout": 5000
}
```

### 2.3 `tsconfig.test.json`

```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2020"
  },
  "include": ["src/**/*", "test/**/*"]
}
```

---

## 3. VS Code Mock 方案

沿用旧工程的 `test/mocks/vscode.ts`，但扩展以覆盖 v2 新增 API。

### 3.1 `test/mocks/vscode.ts`

```typescript
// Minimal vscode API stub for unit tests.
// Only implements surface area touched by v2 modules.

export class MemorySecretStorage {
  private data = new Map<string, string>();
  async get(key: string): Promise<string | undefined> { return this.data.get(key); }
  async store(key: string, value: string): Promise<void> { this.data.set(key, value); }
  async delete(key: string): Promise<void> { this.data.delete(key); }
}

export class MemoryMemento {
  private data = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    return this.data.has(key) ? (this.data.get(key) as T) : defaultValue;
  }
  async update(key: string, value: unknown): Promise<void> {
    if (value === undefined) this.data.delete(key);
    else this.data.set(key, value);
  }
}

export const Uri = {
  file: (path: string) => ({ fsPath: path, path, scheme: 'file' })
};

export const StatusBarAlignment = { Left: 1, Right: 2 };

export class MarkdownString {
  value = '';
  isTrusted = false;
  appendMarkdown(value: string): this { this.value += value; return this; }
}

export class ThemeColor {
  constructor(public id: string) {}
}

export const window = {
  createStatusBarItem: (_alignment?: number, _priority?: number) => ({
    text: '', tooltip: '', color: undefined, backgroundColor: undefined,
    command: undefined, name: '', show: () => {}, hide: () => {}, dispose: () => {}
  }),
  createOutputChannel: (_name: string) => ({
    appendLine: () => {}, append: () => {}, clear: () => {}, show: () => {}, hide: () => {}, dispose: () => {}
  }),
  showInformationMessage: () => Promise.resolve(undefined),
  showWarningMessage: () => Promise.resolve(undefined),
  showErrorMessage: () => Promise.resolve(undefined),
};

export const workspace = {
  getConfiguration: (section?: string) => ({
    get: <T>(key: string, defaultValue?: T): T | undefined => defaultValue,
    update: () => Promise.resolve(),
  }),
  onDidChangeConfiguration: () => ({ dispose: () => {} }),
};

export const env = { language: 'en' };

export const commands = {
  registerCommand: () => ({ dispose: () => {} }),
};

export type SecretStorage = MemorySecretStorage;

export function makeContext(initial?: Record<string, unknown>) {
  const globalState = new MemoryMemento();
  if (initial) {
    for (const [k, v] of Object.entries(initial)) {
      void globalState.update(k, v);
    }
  }
  return {
    secrets: new MemorySecretStorage(),
    globalState,
    subscriptions: [] as Array<{ dispose: () => void }>,
    extensionUri: Uri.file('/tmp/ext'),
    globalStorageUri: Uri.file('/tmp/globalStorage'),
  };
}
```

### 3.2 `test/setup.ts`

```typescript
import * as path from 'path';
import Module = require('module');

const mockPath = path.resolve(__dirname, 'mocks/vscode.ts');
const originalResolve = (Module as any)._resolveFilename;

(Module as any)._resolveFilename = function (request: string, parent: any, ...rest: any[]) {
  if (request === 'vscode') return mockPath;
  return originalResolve.call(this, request, parent, ...rest);
};
```

---

## 4. 测试用例详情

### 4.1 `test/store.test.ts` — Store + reducer（纯函数，零 mock）

```typescript
import { expect } from 'chai';
import { Store, defaultState } from '../src/store';
import { Action } from '../src/types';

describe('Store', () => {
  it('initial state matches defaultState', () => {
    const store = new Store();
    expect(store.getState()).to.deep.equal(defaultState());
  });

  it('CACHE_LOADED sets quota and dataSource', () => {
    const store = new Store();
    const quota = makeQuota();
    store.dispatch({ type: 'CACHE_LOADED', payload: quota });
    expect(store.getState().quota).to.deep.equal(quota);
    expect(store.getState().dataSource).to.equal('cache');
  });

  it('API_SUCCESS sets quota, lastFetchAt, lastSuccessfulFetchAt', () => {
    const store = new Store();
    const before = Date.now();
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    const s = store.getState();
    expect(s.dataSource).to.equal('api');
    expect(s.error).to.be.null;
    expect(s.lastFetchAt).to.be.at.least(before);
    expect(s.lastSuccessfulFetchAt).to.be.at.least(before);
  });

  it('API_ERROR sets error and preserves lastSuccessfulFetchAt', () => {
    const store = new Store();
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    const prevSuccess = store.getState().lastSuccessfulFetchAt;
    store.dispatch({ type: 'API_ERROR', payload: { error: 'network' } });
    expect(store.getState().error).to.equal('network');
    expect(store.getState().lastSuccessfulFetchAt).to.equal(prevSuccess);
  });

  it('API_ERROR with authFailed sets authStatus to expired', () => {
    const store = new Store();
    store.dispatch({ type: 'AUTH_STATUS', payload: 'authenticated' });
    store.dispatch({ type: 'API_ERROR', payload: { error: '401', authFailed: true } });
    expect(store.getState().authStatus).to.equal('expired');
  });

  it('UI_SET_PAUSED toggles isPaused', () => {
    const store = new Store();
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    expect(store.getState().ui.isPaused).to.be.true;
    store.dispatch({ type: 'UI_SET_PAUSED', payload: false });
    expect(store.getState().ui.isPaused).to.be.false;
  });

  it('LOADING_START/END toggles isLoading', () => {
    const store = new Store();
    store.dispatch({ type: 'LOADING_START' });
    expect(store.getState().isLoading).to.be.true;
    store.dispatch({ type: 'LOADING_END' });
    expect(store.getState().isLoading).to.be.false;
  });

  it('SIGN_OUT resets to default but preserves UI settings', () => {
    const store = new Store();
    store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: 'absolute' });
    store.dispatch({ type: 'SIGN_OUT' });
    const s = store.getState();
    expect(s.quota).to.be.null;
    expect(s.ui.displayMode).to.equal('absolute');
  });

  it('notifies subscribers on state change', () => {
    const store = new Store();
    let called = 0;
    store.subscribe(() => called++);
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    expect(called).to.equal(1);
  });
});

function makeQuota(): import('../src/types').QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
    windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
    parallelLimit: 30,
  };
}
```

### 4.2 `test/calc.test.ts` — 纯计算函数

```typescript
import { expect } from 'chai';
import { computeUtilization, buildBar, formatPercent, formatPercentPadded, fmtHours, calculateCost } from '../src/calc';

describe('calc', () => {
  describe('computeUtilization', () => {
    it('returns zero for null quota', () => {
      const r = computeUtilization(null);
      expect(r.weeklyPct).to.equal(0);
      expect(r.windowPct).to.equal(0);
    });

    it('computes percentages correctly', () => {
      const r = computeUtilization(makeQuota({ weeklyUsed: 250, weeklyLimit: 1000, windowUsed: 100, windowLimit: 200 }));
      expect(r.weeklyUtil).to.equal(0.25);
      expect(r.windowUtil).to.equal(0.5);
      expect(r.weeklyPct).to.equal(25);
      expect(r.windowPct).to.equal(50);
    });

    it('caps at 100%', () => {
      const r = computeUtilization(makeQuota({ weeklyUsed: 1500, weeklyLimit: 1000 }));
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
      expect(buildBar(1, 10)).to.equal('▰▰▰▰▰▰▰▰▰▰');
    });
    it('renders empty bar at 0%', () => {
      expect(buildBar(0, 10)).to.equal('▱▱▱▱▱▱▱▱▱▱');
    });
    it('renders partial bar', () => {
      expect(buildBar(0.25, 10)).to.equal('▰▰▰▱▱▱▱▱▱▱');
    });
  });

  describe('formatPercentPadded', () => {
    it('pads short percentages for alignment', () => {
      expect(formatPercentPadded(5, 2)).to.equal(' 5.00%');
      expect(formatPercentPadded(25, 2)).to.equal('25.00%');
      expect(formatPercentPadded(100, 2)).to.equal('100.00%');
    });
  });

  describe('calculateCost', () => {
    it('calculates cost from tokens and pricing', () => {
      const cost = calculateCost(
        { input_tokens: 1_000_000, output_tokens: 500_000, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
        { inputPerMillion: 3, outputPerMillion: 15, cacheReadPerMillion: 0.3, cacheCreatePerMillion: 3.75 }
      );
      expect(cost).to.equal(10.5); // 3 + 7.5
    });
  });

  describe('fmtHours', () => {
    it('formats seconds', () => {
      expect(fmtHours(0.0083)).to.equal('30s');
    });
    it('formats minutes and seconds', () => {
      expect(fmtHours(0.5)).to.equal('30m 0s');
    });
    it('formats hours and minutes', () => {
      expect(fmtHours(2.5)).to.equal(' 2h30m');
    });
    it('formats days and hours', () => {
      expect(fmtHours(50)).to.equal(' 2d 2h');
    });
    it('pads single digits with space', () => {
      expect(fmtHours(0.0167)).to.equal(' 1m 0s');
      expect(fmtHours(1)).to.equal(' 1h 0m');
      expect(fmtHours(24)).to.equal(' 1d 0h');
    });
  });
});

function makeQuota(partial: Partial<import('../src/types').QuotaData>): import('../src/types').QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 0, weeklyUsedPct: 0, weeklyResetAt: 0,
    windowLimit: 200, windowUsed: 0, windowRemaining: 200, windowUsedPct: 0, windowResetAt: 0,
    parallelLimit: 30,
    ...partial,
  };
}
```

### 4.3 `test/cacheService.test.ts`

```typescript
import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CacheService } from '../src/services/cacheService';

describe('CacheService', () => {
  let tempDir: string;
  let svc: CacheService;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kimi-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
    svc = new CacheService(tempDir);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('write → read roundtrip', async () => {
    const data = { quota: makeQuota(), fetchedAt: Date.now() };
    await svc.write(data);
    const read = await svc.read();
    expect(read?.quota).to.deep.equal(data.quota);
  });

  it('returns null for non-existent file', async () => {
    const read = await svc.read();
    expect(read).to.be.null;
  });

  it('returns null for old schema version', async () => {
    const bad = { version: 1, schema: 'v1', data: {} };
    await fs.writeFile(path.join(tempDir, 'cache.json'), JSON.stringify(bad));
    const read = await svc.read();
    expect(read).to.be.null;
  });

  it('returns null for corrupted JSON', async () => {
    await fs.writeFile(path.join(tempDir, 'cache.json'), 'not json');
    const read = await svc.read();
    expect(read).to.be.null;
  });
});

function makeQuota(): import('../src/types').QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
    windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
    parallelLimit: 30,
  };
}
```

### 4.4 `test/authService.test.ts`

```typescript
import { expect } from 'chai';
import { AuthService } from '../src/services/authService';
import { makeContext } from './mocks/vscode';

describe('AuthService', () => {
  it('returns undefined when no credentials stored', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    const token = await auth.resolveToken();
    expect(token).to.be.undefined;
  });

  it('returns API key when stored', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test123');
    const token = await auth.resolveToken();
    expect(token).to.equal('sk-test123');
  });

  it('caches token for 60s', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');
    const t1 = await auth.resolveToken();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-changed'); // 修改存储
    const t2 = await auth.resolveToken(); // 应返回缓存值
    expect(t1).to.equal('sk-test');
    expect(t2).to.equal('sk-test');
  });

  it('invalidate clears cache', async () => {
    const auth = AuthService.getInstance();
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');
    await auth.resolveToken();
    auth.invalidate();
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-new');
    const token = await auth.resolveToken();
    expect(token).to.equal('sk-new');
  });
});
```

### 4.5 `test/apiService.test.ts` — API 调用测试（mock fetch，禁止真实网络）

**核心原则**：测试必须 100% mock `fetch`，严禁调用真实 Kimi API，避免频繁请求导致限流或封禁。

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as nodeFetch from 'node-fetch';
import { ApiService } from '../src/services/apiService';

describe('ApiService', () => {
  let api: ApiService;

  beforeEach(() => {
    api = ApiService.getInstance();
  });

  afterEach(() => {
    sinon.restore();
    (ApiService as any).instance = undefined;
  });

  it('parses real Kimi API shape correctly', async () => {
    sinon.stub(nodeFetch, 'default').resolves({
      ok: true, status: 200,
      json: async () => ({
        usage: {
          limit: '10000', used: '2500', remaining: '7500',
          resetTime: new Date(Date.now() + 86400000).toISOString(),
        },
        limits: [
          {
            detail: {
              limit: '2000', used: '500', remaining: '1500',
              resetTime: new Date(Date.now() + 18000000).toISOString(),
            },
          },
        ],
        parallel: { limit: '30' },
      }),
    } as any);

    const result = await api.fetchQuota('sk-test');
    expect(result.ok).to.be.true;
    expect(result.data!.weeklyLimit).to.equal(10000);
    expect(result.data!.weeklyUsed).to.equal(2500);
    expect(result.data!.weeklyUsedPct).to.equal(25);
    expect(result.data!.windowLimit).to.equal(2000);
    expect(result.data!.windowUsed).to.equal(500);
    expect(result.data!.windowUsedPct).to.equal(25);
    expect(result.data!.windowRemaining).to.equal(1500);
    expect(result.data!.parallelLimit).to.equal(30);

    const stub = nodeFetch.default as sinon.SinonStub;
    expect(stub.getCall(0).args[1].headers['User-Agent']).to.equal('KimiCLI/1.6');
  });

  it('uses API-provided used_pct when present', async () => {
    sinon.stub(nodeFetch, 'default').resolves({
      ok: true, status: 200,
      json: async () => ({
        usage: { limit: '1000', used: '300', used_pct: 33.3 },
        limits: [{ detail: { limit: '200', used: '50', used_pct: 25.5 } }],
      }),
    } as any);

    const result = await api.fetchQuota('sk-test');
    expect(result.data!.weeklyUsedPct).to.equal(33.3);
    expect(result.data!.windowUsedPct).to.equal(25.5);
  });

  it('returns authFailed on 401', async () => {
    sinon.stub(nodeFetch, 'default').resolves({ ok: false, status: 401, json: async () => ({}) } as any);
    const result = await api.fetchQuota('bad-token');
    expect(result.authFailed).to.be.true;
  });

  it('returns networkError on timeout', async () => {
    sinon.stub(nodeFetch, 'default').rejects(new Error('ETIMEDOUT'));
    const result = await api.fetchQuota('sk-test');
    expect(result.networkError).to.be.true;
  });
});
```

**重要约束**：
- 所有 `ApiService` 测试必须 stub `node-fetch`，绝不允许真实 HTTP 出站。
- 如需验证端到端 API 连通性，使用独立的手动脚本（`scripts/manual-api-check.ts`），不在 CI/测试套件中执行。

### 4.6 `test/scheduler.test.ts` — 集成测试（mock fetch + time）

```typescript
import { expect } from 'chai';
import * as sinon from 'sinon';
import { Scheduler } from '../src/services/scheduler';
import { Store } from '../src/store';
import { AuthService } from '../src/services/authService';
import { ApiService } from '../src/services/apiService';
import { CacheService } from '../src/services/cacheService';
import { makeContext } from './mocks/vscode';

describe('Scheduler', () => {
  let clock: sinon.SinonFakeTimers;
  let store: Store;
  let auth: AuthService;
  let api: ApiService;
  let cache: CacheService;
  let scheduler: Scheduler;

  beforeEach(() => {
    clock = sinon.useFakeTimers();
    store = new Store();
    auth = AuthService.getInstance();
    api = ApiService.getInstance();
    cache = new CacheService('/tmp/test-cache');
    scheduler = new Scheduler(store, auth, api, cache);
  });

  afterEach(() => {
    scheduler.stop();
    clock.restore();
  });

  it('tick dispatches LOADING_START → API_SUCCESS → LOADING_END', async () => {
    const ctx = makeContext();
    auth.init(ctx.secrets);
    await ctx.secrets.store('aiStatusHub.apiKey', 'sk-test');

    const quota = {
      weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
      windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
      parallelLimit: 30,
    };
    const fetchStub = sinon.stub(api, 'fetchQuota').resolves({ ok: true, data: quota });
    sinon.stub(cache, 'write').resolves();

    scheduler.start();
    await clock.tickAsync(100);
    await Promise.resolve();

    expect(store.getState().dataSource).to.equal('api');
    expect(store.getState().quota).to.not.be.null;

    fetchStub.restore();
  });

  it('pauses tick when isPaused is true', async () => {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    scheduler.start();
    clock.tick(100);
    expect(store.getState().dataSource).to.equal('no-data'); // 未触发 API
  });
});
```

### 4.7 `test/statusBar.test.ts` — 集成测试（mock Store）

```typescript
import { expect } from 'chai';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { Store } from '../src/store';

describe('StatusBarPresenter', () => {
  let store: Store;
  let presenter: StatusBarPresenter;

  beforeEach(() => {
    store = new Store();
    presenter = new StatusBarPresenter(store);
  });

  afterEach(() => {
    presenter.dispose();
  });

  it('renders loading state initially', () => {
    const state = store.getState();
    // 验证 itemWeekly 被设置了 loading 文本
    // 由于 presenter 内部使用 vscode API，mock 后可通过 presenter['itemWeekly'].text 读取
  });

  it('hides data items when paused', () => {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    // 验证 itemWeekly.hide() 和 itemWindow.hide() 均被调用
    // 暂停时只保留暂停按钮，不显示数据
  });

  it('shows ⛓️‍💥 on network error', () => {
    store.dispatch({ type: 'API_ERROR', payload: { error: 'ECONNREFUSED', networkError: true } });
    // 验证 itemWeekly.text 包含 ⛓️‍💥
  });

  it('shows 💤 when data is stale', () => {
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    // 快进时间超过 refreshIntervalSeconds
    // 验证 itemWindow.text 包含 💤
  });
});
```

---

## 5. 测试运行命令

```bash
# 运行全部测试
npm test

# 运行单个文件
npx mocha --require ts-node/register test/store.test.ts

# 带覆盖率
npx nyc mocha
```

---

## 6. CI 配置建议

```yaml
# .github/workflows/test.yml
name: Test
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm test
```

---

## 7. 覆盖率目标

| 模块 | 目标覆盖率 | 说明 |
|---|---|---|
| `store.ts` reducer | 100% | 所有 action 分支必须覆盖 |
| `calc.ts` | 100% | 纯函数，零 mock，容易覆盖 |
| `cacheService.ts` | 90% | 文件 IO 边界分支 |
| `authService.ts` | 80% | OAuth refresh 需要 mock HTTPS |
| `apiService.ts` | 80% | 需要 mock fetch |
| `scheduler.ts` | 70% | 集成测试，time-based 逻辑 |
| `statusBar.ts` | 60% | UI 渲染，断言较繁琐 |
| `extension.ts` | 0% | 纯编排，E2E 测试覆盖 |
