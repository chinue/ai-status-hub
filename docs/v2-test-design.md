# AI Status Hub v2 测试设计文档

## 0.6.22 提交前回归

新增三个模型计价回归，先复现 flash-gateway/glm-5.3、glm-5.3-superflash、glm-5.3-flashxy 被误判为低价型号，再收紧版本后缀匹配。Cline 会话测试仅模拟 Date 到固定本地中午，避免跨午夜时昨日记录落入当前小时的测试假设失效，保留真实异步文件 IO。完整测试共 341 项通过。

## 0.6.19 GLM 按模型 API 计价

新增 test/glmPricing.test.ts，先复现占位费率及模型映射导致的 8 项失败，再实现：覆盖 GLM-5.3/5.2/Flash/FlashX、命名空间/显示名、四类 Token、CNY、零费率及自定义覆盖、未知模型参考价/默认模型，以及匿名审计用量应重算为 9.58471432 元。其他 Provider 的定价回归继续通过。测试验证 API 等价估算，不验证实际账单或套餐积分算法。

## 0.6.18 新版 Cline 会话回归

新增 test/clineSessions.test.ts，先确认默认路径和 messages.json 均无法识别的失败，再实现解析。覆盖拷回目录、文件拷贝时间不影响请求日期、模型逐消息归属、Kimi/GLM 隔离、包含缓存的输入拆分、SDK 嵌套格式、非法及未完成消息、ISO 时间、缓存写入、今日与 5h 范围、retention、复制去重、编辑重读、坏 JSON 和删除。仅使用匿名结构与数值合计回归，验证副本 Cline 总量 4,224,954 Token 和 Dashboard 聚合字段一致，不带原始会话文本或密钥。

## 0.6.17 GLM 只读配额与验证登录

新增 test/glmApi.test.ts，先运行确认占位接口、未校验保存、旧环境变量覆盖新密钥及虚假周 0% 等回归失败，再实现修复。覆盖只读 GET/原始 Authorization、新旧配额格式、MCP 排除、数值字符串/真实零/上限/非法响应、HTTP 与业务鉴权错误、限流和服务器失败、网络及 JSON 异常、超时及计时器释放、登录失败保留旧密钥、显式密钥优先、仅 5h 展示以及无本地记录时显示查询失败原因。既有登录引导测试注入成功的只读响应，避免测试访问真实账号。总计 322 项测试通过。

## 0.6.16 离线展示、GLM 登录与 Cline 回归

`test/localOnly.test.ts` 覆盖 missing/expired/failed 时本地费用展示、无配额不渲染百分比、Dashboard 协议与实际 WebView 警告/费用/恢复渲染、GLM 手动登录链接与 SecretStorage 保存、取消/保存失败/浏览器失败、Cline 请求级模型和旧日志模型时间线、保留期、坏 JSON、重复扫描与文件删除。更新 calc.test.ts 无配额断言，禁止将缺失配额显示成 0%。

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

### Claude API

`test/claudeApi.test.ts` 测试 OAuth usage 与 header 两条路径：`limits[]` 中 Fable `weekly_scoped` 解析、`label`/model id 与 `percent`/`utilization` 字段变体、Fable-only 部分响应和 Messages 总额度合并、共享窗口 fallback、异常 payload、`null`/空字符串占位额度过滤、5 分钟缓存及显式失效、429 `Retry-After`（含零值）退避、`claude-code/<version>` User-Agent、API Key endpoint/header 分流、Messages fallback，以及 `7d_oi` header 的正常解析、字段缺失和利用率钳制。Scheduler 测试额外覆盖 Messages fallback 缺少 Fable 字段时保留未过期缓存窗口、过期窗口清零并推进到下一周期，以及手动刷新使 Provider 缓存失效。

### Dashboard Current Usage

`test/dashboard.test.ts` 的 Dashboard chart refresh 在 VM 中执行生成的 WebView 图表代码，使用受控定时器和 canvas 高度 setter 验证：5h/7d 同窗口响应延迟超过 150ms 仍保留曲线、复用实例并无动画更新、不覆盖高 DPI 画布尺寸、高度比例配置改变时复用实例并仅触发一次 resize；切换到其他窗口时保留延迟清空行为，及时收到响应时取消清空。测试使用模拟 Chart.js，尚需在 VS Code 中目测确认视觉效果。

`test/dashboard.test.ts` 验证 Fable 行仅对 Claude Provider 暴露、HTML 首屏不带隐藏样式、scoped 数据暂不可用时以 `0%` 固定显示、重置后保持可见且归零，并检查 Fable 进度条位于总 7d 进度条之后。`test/calc.test.ts` 覆盖 Fable 百分比重置解析及 `resetAt === now` 的严格下一周期边界。

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

### Codex usage

`test/codexUsage.test.ts` 覆盖 Pro primary=10080、Plus 双窗口、无时长旧记录、未知窗口、API headers 映射、Dashboard 可见性、真实格式 Token 事件的非零估算成本、短周期明细刷新，以及状态栏隐藏无效五小时额度。

`codexUsage.test.ts` 另覆盖每周单窗口账号最近历史成本不为零、旧锚点下的滚动分析边界，以及中英文 tooltip 中彻底隐藏五小时额度和本地用量行。

### 空选择默认入口回归（0.6.4）

calc.test.ts 覆盖未设置、空数组、无效输入、未知 Provider、合法多选和去重。multiProvider.test.ts 验证首次启动创建 Kimi 状态栏项、当前仪表盘为 Codex 时仍默认 Kimi、配置注册缺失时取消全部回退 Kimi 并持久化。dashboard.test.ts 的连续 checkbox 测试验证最后一项取消后恢复 Kimi。

### Kimi 登录复用回归（0.6.5）

kimiAuth.test.ts 验证共享新凭据优先于旧私有登录、token 轮换即时可见、秒/毫秒时间、坏字段/过期回退、已有登录直接复用、轮询异常、浏览器失败及成功保存。kimiCredentialStorage.test.ts 验证新版和旧版目录、坏 JSON 跳过、自定义 KIMI_CODE_HOME/KIMI_SHARE_DIR 不混用默认账号。

多 Provider 测试断言登录成功立即 force 所属 Scheduler，等待授权仍可切换 Dashboard；Dashboard 与状态栏测试断言按钮存在、命令 Provider 参数和 missing tooltip 登录链接。测试凭据和请求均为本地模拟数据。

### Codex 官方提前重置回归（0.6.6）

codexApi.test.ts 覆盖只读 GET、不创建模型请求、账户头、两次查询间 90→0、双窗口、坏数据与 401。codexUsage.test.ts 保留 Pro 周窗口映射回归，并改用官方 JSON 测试。

scheduler.test.ts 验证官方 90→0 后舍弃旧平滑小数、短周期保持 0、断网后拒绝旧本地 90% 和旧磁盘 90% 覆盖，并保留实际费用明细；相同整数使用率但官方 resetAt 改变时也重建校准。既有精度回归改为验证保留权威值，不能再依赖旧日志重校准官方额度。

### 0.6.7 配额过期提示回归

`test/calc.test.ts` 覆盖默认五分钟轮询内无 💤、七分钟边界与超时，以及自定义 30 秒/600 秒刷新间隔。使用固定时间参数验证边界，无需实际等待；保留 `buildIndicatorSuffix` 原有缺失数据、来源和认证测试。

### 0.6.8 调度、缓存和 Token 回归

Scheduler 使用 fake timers 验证：任务执行期间重复 force 合并、短 tick 执行时 force 排队及缓存延后失效、60 秒超时后仍不重入、失败后恢复、停止后不重启以及 watchdog 清理。既有短 tick 完整数据测试增加与长 tick 不同的今日输出/缓存读取/缓存创建值，验证旧字段实际被替换。Store 测试覆盖新鲜与一天前缓存、时间戳 0，以及已有成功后载入缺失时间缓存的过期提示。

### Claude 日志模型归属回归（0.6.10，2026-11-05）

`test/claudeLocalParser.test.ts` 使用临时 JSONL 目录覆盖模型名称大小写、命名空间、未知/缺失别名、混合模型互斥归属、Token 四分类、子代理目录、请求跨文件去重、保留天数、坏行、增量刷新、缓存失效、文件删除、Kimi 原生日志合并及计价、GLM Provider 接线。`test/kimiLocalParser.test.ts` 注入隔离的 Claude 目录，确保原生测试不读取用户真实数据。


### Cost Curve 自动切窗回归（0.6.11，2026-11-05）

`test/dashboard.test.ts` 执行实际生成的 WebView 窗口选择代码，新增 6 项测试覆盖：5h 跨午夜连续切窗、历史 Hour 保持及选回当前后恢复跟随、刷新后事件使用新列表、历史日期保持、历史窗口移出列表后回退，以及 7d 自动跟随和独立历史选择。修复前 4 项失败，修复后全部通过；保留已有同窗口曲线不清空的回归测试。

### 未登录模型与失败重试回归（0.6.14，2026-11-09）

新增 8 项回归：认证挂起时先显示本地记录、API 挂起时先显示本地记录、认证异常清除 loading 且不密集重试、watchdog 清除 loading 并保留任务所有权、停止后忽略迟到认证、停止后忽略短 tick 的迟到本地扫描、本地首次扫描失败仍获取官方配额，以及真实 Scheduler 配合扩展命令验证切换和取消勾选期间其他状态栏保持可用。使用 fake timers 和隔离凭据/磁盘服务，避免真实网络与用户缓存写入。

原失败恢复测试改为验证下一正常刷新周期恢复，避免把立即重试当作正确行为。精度测试增加首次历史扫描快照，官方窗口断言验证最后一次重新聚合参数；平滑测试按实际配置推进到下一长周期，继续覆盖窗口校准、小数精度与空短 tick 不覆盖数据。全套共 299 项。

### 状态栏隐藏标识回归（0.6.15，2026-11-09）

`test/statusBar.test.ts` 新增两项回归：五个 Provider 使用稳定且互异的字符串 id，未注入 Provider 时从 Store 获取同一 id，并保留对齐与优先级；模拟旧扩展标识已隐藏时新入口仍可见，隐藏 Codex 不会隐藏 Kimi。两项在修复前均失败，修复后全套 301 项通过。VS Code mock 同时支持带 id 与不带 id 两种重载。

## 0.6.23 火山回归

`test/volcengine.test.ts` 覆盖供应商注册、人民币、状态栏白名单、独占路由、相同 GLM 名称按会话分开、模型覆盖、无文件变化时归属重算、非法覆盖和命名空间优先级、日期后缀、供应商私有价格覆盖、未定价模型，以及北京时间工作日 09:00/12:00/14:00/18:00 和周末的逐条计费。固定 Date 避免保留期和今日统计随运行日期漂移。状态栏稳定 ID 和 Dashboard 全供应商测试扩展到火山。

0.6.23 补充回归：长/短 tick 均覆盖归属迁移后的空统计发布，并断言官方 quota 不变；供应商图标断言为 GLM `Ζ`、火山 `🌋`。

0.6.24 新增 GLM 时间切换回归：同一会话中 12:59:59、13:00:00、13:01:00 逐条分流；覆盖两种版本拼写、精确边界、显式命名空间/会话优先、5.30 不误匹配、无效时间和清空配置后的文件缓存重算。

## 0.6.25 渠道隔离回归

新增测试先失败后修复。按用户五次实际测试的 model 和时间构造混合 Claude JSONL，加入 GLM 分界前后、普通 Claude、重复 assistant 块；逐供应商断言请求 ID 集合互斥且完备，以及独立累计金额。用 Kimi 官方 k3_1Pro 输入费率 99 和火山 K2.8 自定义费率验证私有价格不串用。另覆盖官方裸名、命名空间、完整型号边界、手动覆盖，以及原生 Kimi 规范化后与火山同名仍归官方。

## 0.6.26 火山密钥登录回归

test/volcengineAuth.test.ts 的七项用例先失败后通过，覆盖直接密码输入、trim 后安全保存、重新创建实例恢复、取消/空值保留原凭据、SecretStorage 缺失及读写异常、私有退出与删除异常。命令集成测试经过实际 activate/signIn/signOut，验证登录触发火山刷新、退出不删其他供应商密钥、删除失败保留状态。登录不调用配额或推理接口，避免将保存与服务端认证混淆。

## 0.6.27 Coding Plan 只读查询回归

新增 API 测试先失败后实现，覆盖三窗口、零值、缺失/非法数据、重置秒转毫秒、V4 固定请求/独立 Python 计算签名向量、推理密钥不发控制面请求、鉴权/HTTP/解析/网络失败和超时释放；UI 验证月额度载荷/tooltip 与 percentOnly 绝对值模式。认证测试覆盖已有模型密钥引导填写 AK/SK、先验证再原子保存、凭据恢复、验证失败/取消保留旧值。无真实用户 AK/SK，未宣称真实账户查询验收成功。

0.6.27 最新验证：GLM 图标回归先失败（Ζ）后通过（⚡），全部 372 项测试和类型检查通过。

## 0.6.28 TLS 安全回归

两个回归先失败后通过：一是环境变量为 0 时仍向请求传入 rejectUnauthorized=true 的 HTTPS Agent；二是本地真实 HTTPS 自签名服务器在同样环境下被拒绝，HTTP 请求计数为 0，返回 TLS 网络错误而非认证失败。test/fixtures/tls 中 PEM 为公开测试证书/私钥，不是应用或用户凭据；测试不依赖运行时 OpenSSL。额外不带密钥访问官方域名的检查返回网络超时，未据此认定证书错误或真实账户查询成功。

## 0.6.30 Kimi 月度回归

test/kimiApi.test.ts 新增八项回归：官方两个月字段、新套餐无周限额、旧 count 优先和 remaining 推算 used、乱序 5 小时窗口、非法值与合法 0、加油包预算不混入、仅月快照/后续快照清理、现有凭据与 TLS/禁止重定向、错误不伪造零值及月度 Dashboard/tooltip。新月度解析与显示在实现前失败后通过；使用官方源码同结构夹具，未读取用户密钥或宣称真实账户现场验证。

## 0.6.31 月度缺失可见与刷新回归

新增两个先失败后通过的回归：使用旧式无月字段快照执行生成的月度 DOM 更新脚本，断言区域可见、值为破折号、缺失提示/链接可见；随后用真实形状月度夹具更新，验证显示 42.00% 并隐藏链接。多供应商命令测试断言打开/切换有缓存的 Dashboard 会刷新对应供应商，保留已有认证挂起时的立即首轮加载回归。全部 384 项测试通过。现场检查不等于实时账户月额度已验收。

## 0.6.32：Current Usage 零费用回归

localOnly.test.ts 使用真实 Store → Dashboard 数据 → WebView renderCurrentUsage 路径，验证 GLM、Kimi、火山费用为双零、五小时零且周非零、双非零及回到双零时均保持费用标签与正确金额；缺失远程额度时仍保留本地费用。新增测试先复现零费用文本为空，再修复通过。

## 0.6.33：GLM 渠道与动态窗口回归

四项新回归先失败后通过：同会话 13 点后火山连字符回复与官方点号回复分开且支持显式模型覆盖；LocalUsageService 按滚动五小时计费并保留官方周边界；Dashboard 使用同一滚动边界；Scheduler 在长/短 tick 更新滚动起点且不改官方重置时间。现场原日志重新扫描验证 GLM 两个当前窗口均恢复非零费用，并从火山排除这批官方请求。

## 0.6.34：提交前回归复核

新增 GLM 私有退出成功与存储缺失/失败回归，验证只删除 GLM 密钥、保留 Kimi 和火山凭据，失败返回 false；新增断言先失败后实现通过。Kimi 月度缺失区域测试校验实际可访问的 settings/subscription?tab=quota 链接。

## DeepSeek official

0.6.35 的 test/deepseek.test.ts 覆盖供应商/状态栏注册、官方与 Ark 命名空间及 Economy 分流、同一日志文件去重及互斥汇总、CNY/USD/零余额/非法响应、只读认证与 TLS/重定向选项、HTTP/网络错误脱敏、超时中止与计时器清理、密钥验证后存储、取消/失败保留旧密钥、退出隔离和存储异常、Flash/Pro 缓存峰谷单价、节假日/周末/精确边界、未知模型零估算、配置覆盖，以及真实 WebView 更新时余额显示/清除和隐藏虚构窗口。基础 10 项先失败再实现；首次网络错误永久加载另有先失败后通过回归。使用合成 fixture，不调用真实模型或账户。

## 0.6.36：余额账户七天窗口回归

DeepSeek 集成回归构造 1 天、6 天、8 天前的本地请求，通过 Scheduler.processQuotaData 处理实际余额结构，验证七天只包含前两条且费用非零；验证短 tick 随时间滚动、有/无旧锚点与无余额的 Dashboard 边界、磁盘旧锚点修复。原实现先失败（0 次而非 2 次），离线旧锚点也先失败，再修复通过。

## Bounded JSONL reading

0.6.37 的 jsonlStreaming.test.ts 先禁止 fs/promises.readFile 复现原解析器返回空记录，再以 LocalUsageService.readJsonl 流式实现通过。覆盖跨 64 KiB 边界的 UTF-8 字符、CRLF、EOF 非换行记录、超长记录丢弃和后继正常记录、末尾超长记录、纯指纹一致性、缺失文件/回调异常、安全保留旧缓存、Claude/Kimi/Codex 三种原生格式、Codex 累计差分、精确相同 mtime/size 的重写和 rate_limits 提取。

额外独立低内存进程扫描实际日志，五个 Claude 渠道解析器与原生 Codex、Kimi 并行完成；记录峰值内存，不把它当作整个 VS Code 宿主的内存数值或其他扩展无问题的证明。
