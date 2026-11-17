# AI Status Hub / ClaudeStatusEx Provider 抽象设计

> 版本：v1.0.0-draft  
> 日期：2026-05-10  
> 状态：后续参考（非 Phase 1 开发内容）  
> 前置文档：`v2-rebuild-design.md`

---

## 1. 背景

`claude-status`（参考工程）与 `ai-status-hub-v2`（重建工程）的核心架构高度重叠：

- 状态栏 3 条目 + tooltip
- Dashboard（进度条/成本曲线/热力图/历史数据）
- 本地 JSONL 扫描 + 容量校准
- 定时调度（短 tick 本地估算 / 长 tick API 刷新）
- 内存历史数据管理

**差异仅集中在 Provider 专属层**：鉴权方式、API 响应格式、JSONL 文件路径/格式、定价模型。

本文档定义一套 Provider 抽象接口，供后续提取公共库或构建双服务扩展时参考。

---

## 2. 架构重叠度分析

| 模块 | Claude | Kimi | 重叠度 | 抽象策略 |
|---|---|---|---|---|
| **Store + reducer** | `DataManager` 单例直接改状态 | `Store` + `dispatch` | 100% | 完全通用 |
| **Scheduler** | `setInterval` 双定时器 | `setTimeout` 单一调度 | 85% | 统一为 v2 的 setTimeout 链 |
| **状态栏** | 3 条目 + tooltip | 3 条目 + tooltip | 95% | 通用，文案/图标由 Provider 注入 |
| **Dashboard** | 多模型进度条/成本曲线/热力图 | 单模型进度条/成本曲线/热力图 | 90% | 通用，模型列表由 Provider 注入 |
| **本地估算** | JSONL 扫描 + 校准 | JSONL 扫描 + 校准 | 80% | 抽象 `ILocalUsageProvider` |
| **缓存** | JSON schema v7 | JSON schema v2 | 80% | 通用，schema version 由 Provider 注入 |
| **历史数据** | 内存驻留，退出持久化 | 内存驻留，退出持久化 | 100% | 完全通用 |
| **鉴权** | OAuth 凭证文件 | API Key / OAuth | 60% | 抽象 `IAuthProvider` |
| **配额 API** | Anthropic headers | Kimi JSON body | 50% | 抽象 `IQuotaApiProvider` |
| **定价** | USD 多模型 | RMB 单模型 | 60% | 抽象 `IPricingProvider` |
| **状态栏图标** | ✴️ Claude | 🌘 Kimi | 30% | 抽象 `IUIProvider` |

---

## 3. Provider 核心接口

```typescript
// providers/base/types.ts

export type ProviderId = 'claude' | 'kimi';
export type Currency = 'USD' | 'CNY';

/**
 * 每个 Provider 必须实现的能力。
 * 扩展激活时根据用户配置（或自动检测）选择对应的 Provider 实例。
 */
export interface IProvider {
  readonly id: ProviderId;
  readonly displayName: string;      // "Claude Code" / "Kimi Code"
  readonly currency: Currency;

  auth: IAuthProvider;
  api: IQuotaApiProvider;
  localUsage: ILocalUsageProvider;
  pricing: IPricingProvider;
  ui: IUIProvider;
}
```

### 3.1 鉴权接口

```typescript
export interface IAuthProvider {
  /** 解析当前可用的 token（可能从 SecretStorage、文件、环境变量获取） */
  resolveToken(): Promise<string | null>;

  /** token 是否过期，是否需要刷新 */
  isTokenExpired(): Promise<boolean>;

  /** 刷新 OAuth access token（如适用） */
  refreshToken?(): Promise<string | null>;

  /** 使缓存失效（登出后调用） */
  invalidate(): void;
}
```

**实现差异**：
- **Claude**：读取 `~/.claude/credentials.json` 中的 `claudeAiOauth.accessToken`
- **Kimi**：从 VS Code `SecretStorage` 读取 `aiStatusHub.apiKey` 或 OAuth credentials

### 3.2 配额 API 接口

```typescript
export interface QuotaData {
  weeklyLimit: number;
  weeklyUsed: number;
  weeklyUsedPct: number;
  weeklyResetAt: number;
  fableWeeklyUsedPct?: number;  // Claude Fable 独立 7d 窗口（可选）
  fableWeeklyResetAt?: number;

  windowLimit: number;
  windowUsed: number;
  windowUsedPct: number;
  windowResetAt: number;

  limitStatus: 'allowed' | 'allowed_warning' | 'denied';
  parallelLimit?: number;
}

export interface ApiResult {
  ok: boolean;
  data?: QuotaData;
  error?: string;
  authFailed?: boolean;
  networkError?: boolean;
}

export interface IQuotaApiProvider {
  fetchQuota(token: string, options?: FetchQuotaOptions): Promise<ApiResult>;
  invalidateCache?(): void;
}
```

**实现差异**：
- **Claude**：OAuth 登录时优先 `GET /api/oauth/usage`，从 `five_hour` / `seven_day` 读取总额度，并从 `limits[]` 中匹配 `kind: weekly_scoped` 的 Fable 模型级 7d 配额。标识兼容 `scope.model.display_name`、model id、`label`/`name`，百分比兼容 `percent` 与 `utilization`。即使 usage 响应缺少 session/weekly_all，Fable 部分结果也会与 Messages headers 的总额度合并。请求 User-Agent 包含 `claude-code/<version>`；`null`、空字符串等占位百分比视为缺失。成功响应缓存 5 分钟；用户手动刷新绕过成功缓存，但服务端 429 的 `Retry-After` 退避仍会保留，非正数按默认 5 分钟处理。API Key 凭据跳过 OAuth-only usage endpoint，并使用 `x-api-key` 请求 Messages API；OAuth 使用 Bearer 和 beta header。Messages 返回的 `7d_oi-{utilization,reset}` 仍作为 Fable 兼容来源。
- **Kimi**：`POST/GET` Kimi API，从 JSON body 解析 `usage` + `limits[]`

### 3.3 本地用量接口

```typescript
export interface LocalAggregatedUsage {
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
}

export interface ILocalUsageProvider {
  /** 扫描本地 JSONL 并聚合 */
  readAllUsage(opts?: {
    window5hStartMs?: number;
    window7dStartMs?: number;
    nowMs?: number;
  }): Promise<LocalAggregatedUsage>;

  /** 检测 JSONL 文件是否有变化（用于跳过无意义的扫描） */
  detectChanges(): Promise<boolean>;

  /** 使缓存失效 */
  invalidate(): void;
}
```

**实现差异**：
- **Claude**：`~/.claude/projects/<hash>/wire.jsonl`，`type === 'assistant'`，`message.usage`
- **Kimi**：双位置递归扫描 `wire.jsonl`。k3.0：`~/.kimi-code/sessions/wd_*/<session-id>/agents/main/wire.jsonl`，`type === 'usage.record'`，`usage.{inputOther,output,inputCacheRead,inputCacheCreation}`，model 归一化为 `kimi-k3`；k2.6 legacy：`~/.kimi/sessions/<session-id>/<conversation-id>/wire.jsonl`，`type === 'StatusUpdate'`，`message.payload.token_usage`

### 3.4 定价接口

```typescript
export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreatePerMillion: number;
}

export interface IPricingProvider {
  /** 货币符号 */
  readonly currencySymbol: string;  // '$' / '¥'

  /** 默认定价（单模型或 fallback） */
  readonly defaultPricing: TokenPricing;

  /** 获取指定模型的定价（多模型场景） */
  getPricingForModel?(model: string): TokenPricing;

  /** 计算成本 */
  calculateCost(usage: TokenUsage, pricing?: TokenPricing): number;
}
```

**实现差异**：
- **Codex**：USD；GPT-6 Astra、GPT-6 Sol、GPT-6 Luna 保持原价，新增 GPT-6.1 Sol 和 GPT-5.6 Sol 独立配置，避免新版本使用旧版本缓存价或通用 fallback。
- **Claude**：USD；新增 Fable/Mythos 5.1、Sonnet 5/5.5、Haiku 5.5 独立配置，保留旧版模型价格。
- **Kimi**：CNY；新增 K3.1 Pro、K2.7 Code 及各自 Highspeed 版；无 model 字段的旧格式条目仍回退 K2.6。
- 模型名→配置键统一由 `calc.ts#pricingModelKey()` 映射（键须与 `package.json` 中 `pricing.*.models.<key>` 一致）；`kimiModelFamily()` 复用该映射。
- 用户自定义 `aiStatusHub.pricing.customModels` 优先级最高，其次 Provider 专属配置，再次全局配置和默认价格。零价格覆盖有效。

#### Claude pricing

核验日期：2026-10-25。单位：USD / 百万 tokens；缓存写入使用默认 5 分钟档。

| 模型 | 配置键 | 输入 | 输出 | 缓存命中 | 缓存写入 |
|---|---|---:|---:|---:|---:|
| Fable / Mythos 5.1 | claudeFable5_1 | 10 | 50 | 0.25 | 12.5 |
| Fable / Mythos 5 | claudeFable | 10 | 50 | 1 | 12.5 |
| Opus 5.5 | claudeOpus5_5 | 4 | 20 | 0.2 | 5 |
| Opus 5 / 4.5–4.8 | claudeOpus | 5 | 25 | 0.5 | 6.25 |
| Sonnet 5.5 | claudeSonnet5_5 | 2 | 10 | 0.1 | 2.5 |
| Sonnet 5 | claudeSonnet5 | 2 | 10 | 0.2 | 2.5 |
| Sonnet 4 / 4.5 / 4.6 | claudeSonnet | 3 | 15 | 0.3 | 3.75 |
| Haiku 5.5（输入 ≤100K） | claudeHaiku5_5 | 0.1 | 0.5 | 0.01 | 0.125 |
| Haiku 4.5 | claudeHaiku | 1 | 5 | 0.1 | 1.25 |

来源：[Claude 官方定价](https://platform.claude.com/docs/en/about-claude/pricing)。Haiku 5.5 输入 >100K 的官方费率为 0.5 / 2.5 / 0.05 / 0.625；当前按模型固定四项单价的数据结构无法自动选档，因此默认使用 ≤100K 档，可通过自定义价格覆盖。

#### Codex pricing

核验日期：2026-10-25。单位：USD / 百万 tokens；Standard、短上下文、默认 30 分钟缓存写入。

| 模型 | 配置键 | 输入 | 输出 | 缓存命中 | 缓存写入 |
|---|---|---:|---:|---:|---:|
| GPT-6 Astra | gpt6Astra | 10 | 50 | 1 | 12.5 |
| GPT-6.1 Sol | gpt6_1Sol | 2 | 10 | 0.1 | 2.5 |
| GPT-6 Sol | gpt6Sol | 2 | 10 | 0.2 | 2.5 |
| GPT-6 Luna | gpt6Luna | 0.1 | 0.5 | 0.01 | 0.125 |
| GPT-5.6 Sol / GPT-5.6 | gpt5_6Sol | 4 | 20 | 0.4 | 5 |

来源：[OpenAI API 定价](https://developers.openai.com/api/docs/pricing)、[GPT-6 Sol](https://developers.openai.com/api/docs/models/gpt-6-sol)、[GPT-5.6 Sol](https://developers.openai.com/api/docs/models/gpt-5.6-sol)。GPT-5.6 Sol 促销价至少持续至 2026-11-21，需届时复核。裸 `gpt-6` 保持 Astra fallback；API 等价费用不代表订阅实际账单或额度消耗。

#### Kimi pricing

核验日期：2026-10-25。单位：CNY / 百万 tokens；K3 使用默认 5 分钟缓存写入，K2 的缓存创建字段沿用输入价以兼容本地日志分类，并非额外缓存写入费。

| 模型 | 配置键 | 输入 | 输出 | 缓存命中 | 缓存写入/创建 |
|---|---|---:|---:|---:|---:|
| K3.1 Pro | k3_1Pro | 13 | 68 | 1.3 | 13 |
| K3.1 Pro Highspeed | k3_1ProHighspeed | 26 | 136 | 1.3 | 26 |
| K3 | k3 | 20 | 100 | 2 | 20 |
| K2.7 Code | k2_7Code | 6.5 | 27 | 1.3 | 6.5 |
| K2.7 Code Highspeed | k2_7CodeHighspeed | 13 | 54 | 2.6 | 13 |
| K2.6 | k2_6 | 6.5 | 27 | 1.1 | 6.5 |

来源：[Kimi 开放平台定价](https://platform.kimi.com/docs/pricing/chat)、[K3.1 Pro 官方价格说明](https://www.kimi.com/resources/kimi-k3-1-pro-pricing)。支持 `kimi-code/k3.1-pro`、`kimi-code/k2.7-code-highspeed` 等前缀别名，不把新版归入 K3/K2.6。

**当前估算范围**：仍使用每模型固定四项费率；本次未增加长上下文自动加价、缓存 TTL 分档、Fast/Ultrafast/Batch/Flex、区域溢价或历史价格生效日期。旧模型的默认值保留；未知模型保持原有 fallback。回归测试见 `test/modelPricing.test.ts`，通过模拟 VS Code 实际注册默认值验证映射、费用合计、版本边界及自定义覆盖。

### 3.5 UI 文案/图标接口

```typescript
export interface IUIProvider {
  /** 状态栏主图标 */
  readonly mainIcon: string;           // '🌘' / '✴️'

  /** 状态栏条目名称 */
  readonly statusBarName: string;      // 'Kimi Code Usage' / 'Claude Code Usage'

  /** 仪表盘标题 */
  readonly dashboardTitle: string;

  /** 扩展 displayName */
  readonly extensionDisplayName: string;

  /** i18n key 前缀（用于避免 key 冲突） */
  readonly i18nPrefix: string;         // 'kimi' / 'claude'
}
```

---

## 4. 目录结构（双 Provider 扩展）

```
kimi-claude-status-ex/          # 未来可能的合并扩展
├── src/
│   ├── core/                   # 通用模块（可提取为 @shared/core）
│   │   ├── store.ts
│   │   ├── scheduler.ts
│   │   ├── cacheService.ts
│   │   ├── historyService.ts
│   │   ├── config.ts
│   │   └── i18n.ts
│   ├── presenters/             # 通用 UI 层
│   │   ├── statusBar.ts
│   │   └── dashboard.ts
│   ├── providers/              # Provider 专属实现
│   │   ├── base/
│   │   │   └── types.ts        # IProvider 接口定义
│   │   ├── claude/
│   │   │   ├── auth.ts
│   │   │   ├── api.ts
│   │   │   ├── jsonlReader.ts
│   │   │   ├── pricing.ts
│   │   │   └── ui.ts
│   │   └── kimi/
│   │       ├── auth.ts
│   │       ├── api.ts
│   │       ├── jsonlReader.ts
│   │       ├── pricing.ts
│   │       └── ui.ts
│   ├── extension.ts            # 根据配置选择 Provider
│   └── types.ts
├── package.json
└── ...
```

---

## 5. 配置设计

```json
// package.json contributes.configuration
{
  "claudeStatusEx.provider": {
    "type": "string",
    "enum": ["auto", "claude", "kimi"],
    "default": "auto",
    "description": "Which coding assistant to monitor"
  }
}
```

**auto 检测逻辑**：
1. 检测 `~/.claude/credentials.json` 存在 → 自动选择 `claude`
2. 检测 `~/.kimi/sessions/` 存在 → 自动选择 `kimi`
3. 两者都存在 → 默认 `claude`（或提示用户选择）

**运行时 Provider 选择**：
```typescript
// extension.ts
function selectProvider(): IProvider {
  const cfg = vscode.workspace.getConfiguration('claudeStatusEx');
  const providerId = cfg.get<string>('provider', 'auto');

  if (providerId === 'auto') {
    if (fs.existsSync(CLAUDE_CRED_PATH)) return new ClaudeProvider();
    if (fs.existsSync(KIMI_SESSIONS_DIR)) return new KimiProvider();
    return new ClaudeProvider(); // fallback
  }

  return providerId === 'kimi' ? new KimiProvider() : new ClaudeProvider();
}
```

---

## 6. 分阶段迁移计划

### Phase 1：Kimi v2 独立稳定

- 按当前计划完成 ai-status-hub-v2 的独立开发
- 不引入 Provider 抽象，避免增加复杂度
- **目标**：验证 v2 架构（Store + Scheduler + 内存历史数据）在真实场景下的稳定性

### Phase 2：提取公共库

Kimi v2 稳定运行后，将通用模块提取为 **私有 npm package** 或 **git submodule**：

```
@coding-status/core/
├── src/
│   ├── store.ts
│   ├── scheduler.ts
│   ├── cacheService.ts
│   ├── historyService.ts
│   ├── presenters/statusBar.ts
│   ├── presenters/dashboard.ts
│   └── providers/base/types.ts   # IProvider 接口
```

Kimi 和 Claude 各自依赖 `@coding-status/core`，只需实现各自的 Provider：

```typescript
// ai-status-hub/src/providers/kimi/index.ts
import { IProvider } from '@coding-status/core';
export const kimiProvider: IProvider = { ... };

// claude-status/src/providers/claude/index.ts
import { IProvider } from '@coding-status/core';
export const claudeProvider: IProvider = { ... };
```

### Phase 3（可选）：双服务扩展

如果用户有"一个扩展同时监控 Claude + Kimi"的需求，创建新扩展：

```
coding-status-ex/
├── src/
│   ├── providers/claude/     # 复用 claude-status 的 Provider 实现
│   ├── providers/kimi/       # 复用 ai-status-hub 的 Provider 实现
│   └── extension.ts          # 同时激活两个 Provider，状态栏显示两行
```

状态栏设计：
```
🌘 Kimi: 34.5% | 5️⃣ 67.2% | ⏸️    ✴️ Claude: 12.1% | 5️⃣ 45.0% | ⏸️
```

---

## 7. 风险与注意事项

| 风险 | 说明 | 缓解措施 |
|---|---|---|
| **发布耦合** | Claude 紧急 bug 修复必须和 Kimi 一起测试发布 | 保持独立仓库，通过 npm 包引用公共库 |
| **配置爆炸** | 合并后配置项从 30+ 增加到 50+ | Provider 配置按前缀隔离（`kimi.*` / `claude.*`） |
| **品牌混淆** | 用户下载 "ClaudeStatusEx" 却发现支持 Kimi | 双服务扩展使用全新品牌名（如 `coding-status-ex`） |
| **JSONL 格式差异** | Claude（assistant）和 Kimi（StatusUpdate）解析完全不同 | `ILocalUsageProvider` 完全隔离，不强行统一中间格式 |
| **API 响应差异** | Headers vs JSON body，字段语义不同 | `IQuotaApiProvider` 负责解析为统一的 `QuotaData` |
| **测试复杂度** | 一个改动需在两套 Provider 上验证 | CI 矩阵：分别跑 Claude Provider 和 Kimi Provider 的测试 |

---

## 8. 结论

> **代码层面 90% 可复用，但产品层面不建议在 Kimi v2 开发期间引入 Provider 抽象。**
>
> 先独立做稳 Kimi v2，待架构验证通过后，再将通用模块提取为 `@coding-status/core` 公共库。Provider 抽象是未来扩展的**技术储备**，而非当前的开发负担。

### 多 Provider 同时监控（0.6.0）

`extension.ts` 为每个 Provider 单独实例化依赖服务，替代反复修改全局服务上下文的做法。Claude、Codex、Kimi PricingProvider 调用 `ConfigService.getPricing(modelName, providerId)` 时显式指定自身 Provider，确保并发后台估算读取正确的私有费率；不修改既有费率、自定义关键词覆盖与 fallback 顺序。详见 [多模型仪表盘交互](v2-dashboard-design.md#多模型选择与状态栏联动0602026-10-25)。

### Codex 限额窗口兼容（2026-10-25）

Codex Pro 的 primary 可能是每周窗口（10080 分钟），secondary 为空。API Provider 保留 headers 的窗口时长，交由 `calc.ts#codexRateLimitsToQuota` 统一映射；不再固定认为 primary 是五小时。`UnifiedQuota.has5hLimit` 为 false 表示没有五小时额度，undefined 兼容旧缓存及其他 Provider。

### Kimi auth

0.6.5（2026-10-26）修复 Kimi Code VS Code 登录复用与无响应入口。

- 凭据文件由 CacheService.readKimiCredentials() 读取，AuthProvider 不直接访问磁盘。默认按 `~/.kimi-code/credentials/kimi-code.json`、`~/.kimi/credentials/kimi-code.json` 的顺序读取；设置 KIMI_CODE_HOME 或旧版 KIMI_SHARE_DIR 时只读取对应根目录，避免混用其他账号。缺失、损坏和不可读文件安全跳过。
- 每次 resolveToken 先读取共享有效凭据，再考虑插件自己的 SecretStorage 和 API Key。支持 expires_at 秒/毫秒，校验字段，跳过已过期共享 token；官方客户端更新 token 后不受插件 60 秒私有缓存遮挡。
- 共享凭据仅使用 access token，不复制 refresh token 到插件存储、不改写官方文件，也不尝试替官方客户端轮换共享 refresh token。共享文件过期且没有其他有效凭据时，可通过独立浏览器授权连接。插件自身 OAuth 的刷新失败不会删除已保存凭据。
- 登录动作先提示正在连接，有现成有效登录时直接复用。需要授权时打开 HTTPS 页面并显示验证码；浏览器失败、轮询异常、授权失败及超时均显示双语结果，异常不逃逸。重复登录共用进行中的 Promise。
- 登录按钮在 Dashboard Header 显示“登录 / 重新连接”；缺失凭据的状态栏 tooltip 增加带 Provider 参数的登录链接。成功后失效内存缓存并立即 force 刷新所属 Provider。
- 授权等待不占用扩展的 Provider 选择队列，因此用户仍可切换模型和更改 checkbox。

来源：[Kimi Code 官方数据目录](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/data-locations.md)、[环境变量](https://github.com/MoonshotAI/kimi-code/blob/main/docs/en/configuration/env-vars.md)。官方 VS Code 与终端共享同一 KIMI_CODE_HOME 时共享登录状态；本插件只读取同一用户下的公开约定凭据文件，不读取其他扩展的 SecretStorage。

测试：kimiAuth.test.ts、kimiCredentialStorage.test.ts，以及 Dashboard/StatusBar/多 Provider 命令测试。所有网络授权测试均使用模拟 token 和请求，不访问真实登录服务器。

### Codex API

0.6.6（2026-10-26）将 Codex 用量查询改为只读 `GET https://chatgpt.com/backend-api/wham/usage`，与官方 Codex 客户端的 ChatGptApi 路径一致。旧实现向 `/codex/responses` 发送模型请求并读取限额响应头；实际日志持续返回 `No rate limit headers found`，导致官方提前重置后仍显示旧 JSONL 快照。

请求携带现有 OAuth token、可选 chatgpt-account-id 和 no-cache；不创建模型消息，不请求或消费额度重置操作。账号 ID 由 CacheService.readCodexAccountId() 封装读取，API Provider 不直接访问磁盘。15 秒超时覆盖请求与 JSON 正文读取，最终释放计时器；错误不输出凭据或响应正文。

`calc.parseCodexUsage()` 验证 rate_limit.primary_window / secondary_window，将 limit_window_seconds、used_percent、reset_at / reset_after_seconds 转为 RateLimits 并复用按窗口时长映射。支持 Pro 每周单窗口和 Plus 双窗口，合法的 0 是权威重置值；缺失、坏 JSON、非法字段或没有可识别窗口时返回失败，不能伪造一次清零。

来源：[官方客户端用量路径与读取逻辑](https://github.com/openai/codex/blob/main/codex-rs/backend-client/src/client/rate_limit_resets.rs)、[官方用量响应回归测试](https://github.com/openai/codex/blob/main/codex-rs/app-server/tests/suite/v2/rate_limits.rs)。本次实际只读查询返回 HTTP 200，识别到账号 primary 周窗口；未调用任何付费、重置或模型生成接口。

### GLM provider

0.6.19（2026-11-09）移除 index.ts 内固定 1/2/0.5/1 的占位费率，改用独立 GlmPricingProvider；详情见下方 GLM pricing。模型缺失的参考名及 ConfigService 默认名统一为 glm-5.3。该费用是 API 按量等价估算，不能当作 Coding Plan 的实际扣款或按比例换算配额。

0.6.10（2026-11-05）接入 Claude Code 日志中 `glm-*` 模型的本地 Token、请求数及估算费用；`createGlmProvider()` 创建独立 `ClaudeLocalParser('glm')`。定价沿用当前固定估算费率。

0.6.16（2026-11-09）新增 `GlmAuthProvider`：提供模态登录指引，显示官方 API Keys 链接和“打开登录页面 / 输入 API Key”按钮，支持浏览器失败时手动访问。密钥通过 password 输入框获取，存入独立 SecretStorage 键 `aiStatusHub.glm.apiKey`；环境变量 `ZHIPUAI_API_KEY` / `GLM_API_KEY` 优先。取消或保存失败返回 false，不将打开网页当作登录完成；密钥仅保存，未向服务器验证。官方配额 API 仍未接入，界面明确提示配额不可用，本地统计不受影响。

官方依据：[API Key 获取与认证说明](https://docs.bigmodel.cn/cn/guide/develop/http/introduction)，其 API Keys 链接为 https://bigmodel.cn/usercenter/proj-mgmt/apikeys。本次不发送模型请求或付费校验调用。

0.6.17（2026-11-09）替换占位接口为 `GlmApiProvider`，固定查询国内站 `GET https://open.bigmodel.cn/api/monitor/usage/quota/limit`，按官方插件发送原始 Authorization API Key；不创建模型请求。15 秒超时覆盖网络及正文读取，finally 清除计时器，拒绝重定向，不输出密钥、原始响应或服务端消息。HTTP 401/403 和业务鉴权码返回 authFailed；429/5xx 标记可重试；其余缺失套餐与网络/解析异常使用中英翻译提示。本次用户确认使用 bigmodel.cn；不自动将密钥发送给 z.ai 国际站。

`calc.parseGlmQuota()` 兼容新 `CREDIT_LIMIT` 和旧 `TOKENS_LIMIT`，按 unit=3/number=5 与 unit=6/number=1 分别读取 5 小时和周窗口。旧版无 unit/number 的 TOKENS_LIMIT 仅视为 5h；TIME_LIMIT 为 MCP 月用量，不能作为周配额。支持 percentage 或 currentValue/usage 推导，合法 0 不判为缺失；非法、空数组和业务失败不伪造 0%。协议 `UnifiedQuota` / `QuotaData` 新增可选 has7dLimit，undefined 保留旧行为，false 表示缺失周配额。实际窗口的 nextResetTime 转为毫秒；缺少重置时间时沿用 Scheduler 现有 fallback 窗口，不声称是官方重置时间。

登录时先使用同一只读接口验证候选密钥，成功后才保存并提示连接成功；失败不覆盖已有密钥，不宣告登录成功。显式输入并保存的密钥优先于 ZHIPUAI_API_KEY / GLM_API_KEY，避免旧环境变量覆盖新输入。已保存的 0.6.16 密钥可直接用于下次刷新。未持有用户真实密钥，本次验证使用模拟接口响应，不声称已对用户账号完成实测。

接口及认证依据：[官方用量插件文档](https://docs.bigmodel.cn/cn/coding-plan/extension/usage-query-plugin)、[官方只读查询脚本](https://github.com/zai-org/zai-coding-plugins/blob/main/plugins/glm-plan-usage/skills/usage-query-skill/scripts/query-usage.mjs)；CREDIT_LIMIT 及周窗口响应参考 [zai-org 配额问题示例](https://github.com/zai-org/feedback/issues/1353)。

### GLM pricing

0.6.22 审查修正：Flash / FlashX 必须是版本号之后的完整型号后缀，不能由命名空间内的 flash 或未知型号后缀触发。未识别后缀保留 GLM-5.3 参考价，防止错误低估。

`src/providers/glm/pricing.ts` 维护国内站标准 API 定价（元/百万 Token，2026-11-09 核验）：

| 模型 | 未缓存输入 | 输出 | 缓存命中 | 缓存创建参考 |
|---|---:|---:|---:|---:|
| GLM-5.3 / GLM-5.2 | 8 | 28 | 2 | 8 |
| GLM-5.3-Flash | 0.8 | 2.8 | 0.23 | 0.8 |
| GLM-5.3-FlashX | 2 | 7 | 0.57 | 2 |

来源：[官方 API 定价](https://docs.bigmodel.cn/cn/guide/start/pricing)。缓存创建按普通输入价估算；存储时长、工具调用费用及临时折扣不在日志 Token 估算中。缓存存储当前限时免费不等于缓存命中免费。旧型号/未知别名没有伪造已核验专属费率，暂使用 GLM-5.3 参考价；可通过 customModels 自定义，历史分段价格尚未实现，不能声称是历史账单。

优先级：customModels > pricing.glm.models.<key> > pricing.models.<key> > 模型标准参考价；合法 0 覆盖保留。getPricing 的新增可选 defaults 参数只用于无配置时回退，其他 Provider 保持原有默认行为。计算复用 calc.calculateCost。package.json 登记四模型的 16 个 GLM 私有费率设置，币种为 CNY。

与套餐区别：[官方 Coding Plan 积分说明](https://docs.bigmodel.cn/cn/coding-plan/overview)按模型区分输入、缓存、输出系数，并在非高峰时段按 50% 抵扣。官方配额百分比继续来自远端 quota 接口，不按 API 等价费用除以某个人民币预算计算。此次实际本地日志重算为 9.58471432 元，旧占位费率为 2.230329 元；这不是用户账单实扣金额。

### Claude 日志模型分流（0.6.10）

Claude parser 默认排除明确的 Kimi/GLM 模型；Kimi parser 合并原生会话和 Claude 日志内的 Kimi 条目。分类由 calc.ts 的 `claudeLogProvider` 统一实现，不依据当前配置或 UI 选择推断历史模型；不明别名保留旧归属。详细扫描、去重、缓存与内存策略见 `v2-local-estimation-design.md` 的“Claude 日志跨模型归属”。

## Volcengine Provider

`src/providers/volcengine/index.ts` 注册独立供应商 `volcengine`，界面名称固定为“火山”，货币 CNY；复用 Claude JSONL 扫描器。当前只统计本地日志，不查询账户账单、套餐积分或配额，也不要求 API Key。注册表、状态栏选择白名单、配置枚举均包含火山，缓存与其他供应商隔离。

### Volcengine Pricing

`src/providers/volcengine/pricing.ts` 按模型及记录时间提供独立单价，单位元/百万 Token：

| 模型 | 未缓存输入 | 输出 | 缓存读取 | 缓存创建参考价 |
|---|---:|---:|---:|---:|
| deepseek-v4.1-flash-economy 空闲 | 0.8 | 3.2 | 0.016 | 0.8 |
| deepseek-v4.1-flash-economy 高峰 | 1.6 | 6.4 | 0.032 | 1.6 |
| kimi-k3.1-pro | 13 | 68 | 1.3 | 13 |
| glm-5.3-flash | 0.8 | 2.8 | 0.23 | 0.8 |
| kimi-k2.8-preview | 待配置 | 待配置 | 待配置 | 待配置 |

来源：[火山官方模型价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1)，核对日期 2026-11-16；用户入口为 https://ark.volcengine.com/region:cn-beijing/docs/model-pricing 。K2.8 Preview 未查到公开 API 单价，不能套用 K2.6、K3 或其他供应商价格；默认零仅用于保留 Token 聚合，界面明确提示费用缺项，可通过 `pricing.volcengine.models.k2_8Preview.*` 补充。

高峰定义为北京时间周一至周五 09:00–12:00、14:00–18:00，其余为空闲。`isVolcenginePeak` 使用固定 UTC+8；`IPricingProvider.getPricing(model, timestamp?)` 新增可选时间参数，由 LocalUsageService 传入每条日志的时间，避免所有历史记录按当前时刻重算。创建缓存暂按普通输入参考价，不计算缓存存储时长费、工具费、音频、批量折扣、套餐积分及活动折扣；K3 的 1h 缓存创建档无法由现有日志分类还原。

支持点号/连字符版本拼写、命名空间和日期后缀。火山特有 K2.8/DeepSeek 配置键只在 `pricingModelKey(model, 'volcengine')` 下启用，避免改变已有 Kimi 配置键。独立配置路径 `pricing.volcengine.models.<key>.*`，峰值键为 `deepseekV4_1FlashEconomyPeak`；现有 `pricing.customModels` 仍为全供应商共用覆盖，需分别设置同名 GLM 价格时应使用供应商私有字段。

火山的 `mainIcon` 固定为 🌋；GLM 的 `mainIcon` 按用户要求改为希腊大写 Zeta `Ζ`（U+0396），状态栏使用供应商 UI 图标。

0.6.24 用户确认 GLM 5.3 在 2026-11-16 13:00（UTC+8）切换到火山，默认 Claude 裸名 GLM 5.3 记录按此时间归属，具体优先级见本地估算设计。GLM 和火山各自按其私有费率重算归属后的记录。

### 0.6.25 Kimi 费用隔离

官方 k3.1-pro 使用 Kimi 的 k3_1Pro 私有价格；kimi-for-coding 沿用旧日志参考费率 k2_6，不根据自述推测后台版本。火山 kimi-k3.1-pro 使用火山 k3_1Pro，kimi-k2-8-preview 使用火山 k2_8Preview。相同费率族键不会跨供应商合并。渠道识别仅在 Claude 日志应用已核对的火山别名，官方原生来源继续归 Kimi，见本地估算设计。

### Volcengine Auth

0.6.26：新增 src/providers/volcengine/auth.ts，点击火山登录直接 showInputBox（password / ignoreFocusOut）输入 API Key，无前置选择或浏览器跳转。空白或取消不覆盖旧密钥；成功保存到 SecretStorage 的 aiStatusHub.volcengine.apiKey，不写配置/磁盘文件、不记录密钥或底层异常。resolveToken 每次从私有 secret 读取，重建实例可恢复；getCredentialType 为 api-key。暂不验证密钥、不执行模型推理或套餐配额查询，保存提示明确说明这一范围。

IAuthProvider 增加可选 signOut(): Promise<boolean>。火山只删除自己的私有密钥，返回 false 时保留界面登录状态并显示通用错误；扩展优先调用该接口，其他供应商沿用已有退出流程。本地 Token/费用统计继续独立于登录和配额服务。

### Volcengine API

0.6.27 接入个人 Coding Plan 的 GetCodingPlanUsage：POST https://open.volcengineapi.com/?Action=GetCodingPlanUsage&Version=2024-01-01，固定空 JSON body，仅只读查询。signing.ts 使用 Node crypto 实现 HMAC-SHA256 V4，scope 为 日期/cn-beijing/ark/request，签名头 host、x-content-sha256、x-date；不添加 AWS4 密钥前缀。签名规则参考[官方 Node SDK](https://github.com/volcengine/volc-sdk-nodejs/blob/main/src/base/sign.ts)。套餐窗口定义参考[官方 Ark CLI 用量说明](https://github.com/volcengine/ark-cli/blob/main/skills/arkcli-usage/references/arkcli-usage-plan.md)，区别于推理量和结算账单。

api.ts 只接受序列化的 AccessKey ID / Secret Access Key 对，模型 API Key 缺少这组凭据时直接返回配置指引，不向控制面发送 Bearer 推理密钥。15 秒 AbortController 超时，拒绝重定向，保护网络、JSON.parse 与返回结构；401/403/鉴权错误、无有效套餐、HTTP、网络/格式异常使用双语固定提示，不回显服务端原文、签名头或密钥。

calc.ts 的 parseVolcengineCodingQuota 解析 Result.QuotaUsage 中 Level=session/weekly/monthly、Percent（已用百分比）、ResetTimestamp（秒转毫秒）。缺失/非法数据不伪装成零，合法零值保留；超过 100% 的显示封顶。percentOnly 标记说明 windowLimit/weeklyLimit=100 仅供既有百分比计算兼容，不代表请求总额。monthlyUsedPct/monthlyResetAt 为可选字段，缓存沿用现有 quota 序列化。暂无真实用户 AK/SK，自动化使用响应夹具验证；真实账户需由用户在插件输入后完成只读验证。

认证：原模型 API Key 不变，新增 SecretStorage 私有键 aiStatusHub.volcengine.quotaCredentials，整对 JSON 原子保存。已有凭据时点击登录，选择“连接 Coding Plan 套餐”，依次以密码框输入 AK/SK，查询成功才替换旧对；取消或失败保留旧值。resolveToken 优先读取查询凭据，CredentialType 增加 access-key。退出删除火山模型密钥及查询凭据，不触碰其他供应商。无推理调用、无依赖 CLI，当前只支持个人 Coding Plan，不自动切 Agent Plan 或企业席位。

0.6.27 同步用户最新图标要求：GLM 的 mainIcon 从 Ζ 改为 ⚡，火山仍为 🌋。

### 0.6.28 火山 TLS 校验加固

VolcengineApiProvider 对每个配额请求显式创建 https.Agent({ rejectUnauthorized: true })，保留 Node 默认 CA/域名校验，不继承 NODE_TLS_REJECT_UNAUTHORIZED=0；finally 销毁 Agent 并释放超时。仍禁止重定向。没有手工设置 ca，所以 Node 启动时配置的 NODE_EXTRA_CA_CERTS 可继续用于可信组织代理。不得添加跳过证书检查或自动信任未知 CA 的后备路径。

证书链、自签名、过期、主机名或签名算法错误按固定错误码分类为 TLS 提示，networkError=true，不当作密钥失效，不输出底层错误或响应。当前仅加固火山套餐查询，不宣称修改其他供应商请求。实测用户级/系统级 NODE_TLS_REJECT_UNAUTHORIZED 未设置，当前工具进程值为 0，未确定其父进程来源；没有修改注册表或安装任何证书。

### Kimi API

0.6.30：继续调用 https://api.kimi.com/coding/v1/usages，复用现有 OAuth/API Key，不增加浏览器抓取或其他凭据。根据[官方 managed-usage 源码](https://github.com/MoonshotAI/kimi-code/blob/main/packages/oauth/src/managed-usage.ts)解析 usages.limit_5h、limit_7d、limit_month_total、limit_month_code 的 used_ratio / reset_time，比例乘 100。月总池为会员共享额度，Code 月池为独立字段，不能与加油包 boosterWallet 的月消费上限混用。

parseKimiQuota 位于 calc.ts。旧 usage / limits 格式保留，5 小时按窗口时长匹配而非固定取第一项；仅旧格式缺少 window 元数据且只有一个 limits 条目时沿用旧单项。旧的绝对 count 优先于并存 ratio，remaining 可推算 used；goods_version=2 未返回 limit_7d 时不制造周限额。仅返回月额度也可作为有效快照；缺失或非法月字段保持 undefined，零值有效，显示封顶 100%。月重置直接采用服务端时间，不按自然月或固定 30 天推算。

UnifiedQuota / QuotaData 新增 monthlyCodeUsedPct / monthlyCodeResetAt，与已有 monthlyUsedPct / monthlyResetAt 分开。原生只返回比率的窗口标记 percentOnly，避免显示虚假的 /100 请求总量。HTTP、网络、JSON/结构错误采用双语固定提示，不回显底层异常；30 秒超时，禁止重定向、显式 TLS 校验并 finally 销毁 Agent。缺少有效窗口时不以成功零额度覆盖旧快照。

### 0.6.31 Kimi 月度现场诊断

本机检查发现已安装 0.6.30 且 bundle 与 VSIX 一致，多个 VS Code 窗口仍在写共享缓存；读到的 Kimi 缓存是旧结构，没有月度字段。工具侧仅能读取过期的原生凭据，无法读取 VS Code SecretStorage 内当前有效登录，故未成功取得当前账户实时响应，不能据缓存就断言服务器一定不提供月数据。

KimiApiProvider 成功解析后输出固定字段可用性：Kimi quota fields: 5h=true/false, 7d=true/false, month_total=true/false, month_code=true/false。只记录字段是否有有效值，不记录密钥、比例、响应正文或任意服务端字段名。新版启动日志带版本，方便用户刷新后确认实际运行版本与 API 可用性。不使用未知接口、其他账号凭据或绕过 SecretStorage 获取数据。

## 0.6.34：GLM 退出凭据隔离

GlmAuthProvider 实现可选 signOut()，只删除 aiStatusHub.glm.apiKey。extension.ts 复用已有供应商私有退出协议，避免 GLM 落入通用分支删除 Kimi 的 aiStatusHub.apiKey / aiStatusHub.oauthCredentials 或其他凭据。未初始化存储、删除失败均返回 false，显示双语固定错误，不执行 SIGN_OUT 状态切换、不回显底层异常。环境变量凭据仍由启动环境管理，插件不会修改。

## DeepSeek provider

0.6.35 增加独立供应商 deepseek（🐋）：index.ts 注册官方 API 供应商；auth.ts 使用密码输入框，先通过只读余额接口验证，再将密钥保存到 aiStatusHub.deepseek.apiKey，支持 DEEPSEEK_API_KEY 环境变量回退。退出只删除自身 SecretStorage，失败返回 false。api.ts 仅 GET https://api.deepseek.com/user/balance，Bearer 认证、15 秒超时、显式证书校验、禁止重定向，错误不回显凭据或响应正文。

UnifiedQuota / QuotaData 新增可选 balance，保存实际 currency、total、granted、toppedUp、isAvailable；没有余额字段时不制造余额。DeepSeek 不提供本扩展所用的 5h/7d 套餐配额，窗口标记均为 false，不将账户余额换算为百分比。缓存沿用按供应商隔离的已有结构。

pricing.ts 按官方当前 Flash / Pro 分别提供 CNY 与 USD 单价，使用请求日志时间确定高峰/空闲；高峰是北京时间周一至周五 9–12、14–18，排除内置 2026 年中国节假日。额外年份假期通过 deepseek.offPeakDates 配置。基础与 Peak 独立配置，可在 pricing.deepseek.models.deepseekFlash/deepseekFlashPeak/deepseekPro/deepseekProPeak 下覆盖；无默认配置值，确保自动币种与时段规则不被配置注册默认值覆盖。未知历史模型仅计 Token，费用默认 0，可自定义费率。费用不含缓存存储时长、联网工具、语音或图像额外收费。

官方依据（2026-11-16）：https://api-docs.deepseek.com/api/get-user-balance/ 、https://api-docs.deepseek.com/zh-cn/quick_start/pricing/ 、https://api-docs.deepseek.com/guides/anthropic_api/ 。2026 假期依据 https://www.gov.cn/gongbao/2025/issue_12406/202511/content_7048922.html （国务院办公厅 2026 年节假日安排）。实际账号仍需在 VS Code 内输入自己的 Key 后核验。

## 0.6.37：Codex 原生日志的内存上限

CodexLocalParser 的 updateFileState 改用 LocalUsageService.readJsonl 流式解析；元数据不变时以增量 MD5 验证内容，保留同大小/mtime 重写检测。累计 token delta 的 previousTotals / lastTotals 按文件顺序保留，usage 条目仍是精简结构。getRateLimits 强制流式解析但不积累 usage entries，仅提取原有模型/额度状态，避免整文件文本和输出数组占用。

原私有 parseText / parseLines 保留供纯解析测试使用，不再用于磁盘路径。聚合文件条目改用迭代 push，避免超多条目展开为函数参数。其他模型归属和官方配额优先级不变。

## Kimi web membership

0.6.38 在 Coding API 缺少 monthlyUsedPct 时补充查询官方会员网页接口：POST https://www.kimi.com/apiv2/kimi.gateway.membership.v2.MembershipService/GetSubscriptionStats，固定 JSON body 为 {"mute_notice":false}。只读会员统计；15 秒超时、显式 TLS 校验、禁止重定向、finally 关闭 Agent，不回显响应正文、令牌和底层异常。已存在 Coding 月度字段则不额外查询，不以网页覆盖现有有效值。网页失败不导致 Coding 认证失效，也不清零有效五小时/周配额。

依据来自 2026-11-17 获取的官方公开网页资源：HTML data-entry 指向 cd8a2c06b64e8-Dr6oS1R5.js，其会员 balance store 调用 getSubscriptionStats({muteNotice:false})；总比例来自 subscriptionBalance.amountUsedRatio，Code 来自 kimiCodeUsedRatio，页面计算其他 Kimi 占比为 total−code。c41287b0f9bc1-C6A1DTyS.js 内嵌 protobuf FileDescriptor 定义 kimi.gateway.membership.v2.MembershipService.GetSubscriptionStats 以及 subscription_balance、amount_used_ratio、kimi_code_used_ratio、expire_time。传输默认基址 /apiv2，网页拦截器从自身 access_token 提供 Bearer。匿名实测请求返回 401/REASON_INVALID_AUTH_TOKEN。以上是公开静态代码和匿名网络证据，不是登录账户的运行结果。

KimiMembershipApi 独立于 Coding API。先尝试独立网页令牌，没有配置时尝试当前 Kimi 授权；尚未证明每种 Coding 授权均能访问网页接口。若不兼容，用户通过 Dashboard 或 aiStatusHub.kimiConnectMembership 连接同账号网页会员额度：引导登录订阅页并在浏览器开发者工具 Application > Local Storage > https://www.kimi.com 获取 access_token，密码框输入后先验证，再保存到独立 SecretStorage 键 aiStatusHub.kimi.membershipWebToken。令牌不发往 Coding API，不读取浏览器 Cookie/数据库，0.6.38 不保存网页登录刷新令牌（0.6.39 起可选保存以续期），不改写原生客户端凭据；失效后需重新连接。用户须确认网页与 Coding 为同一账号，扩展尚未自动比对两个令牌的账号身份。

Kimi 退出登录同时删除本扩展保存的网页令牌；网页连接取消、验证失败或存储失败不替换旧令牌。取得网页数据后保留字段来源标记，Code 比率属于会员池的组成部分，不是独立 Code 限额。expire_time 显示为额度到期，避免误称为下次刷新；网页某些套餐会结合额外订阅规则调整展示，本实现不推算该规则。

REA 引擎未运行：本机 Node 25.2.1 不在当前 REA 支持版本内，doctor 已明确报告不兼容；未安装其他 Node 或修改工具配置，改用公开资源静态检查及 protobuf 描述符解码。原始公共资产只在 .tmp 下诊断使用，不提交、不打入 VSIX。

## 0.6.39：网页令牌续期与登录步骤

登录模态框 detail 按六步说明 F12、Application、Local Storage、网站域名、access_token 对应的 Value。第一个密码框验证访问令牌后，第二个可选密码框接收 refresh_token 对应的 Value；空值禁用自动续期，Esc 取消整个连接并保留原凭据。两个值合并为一个 JSON 保存于原独立 SecretStorage 键，兼容旧版纯 access_token；退出 Kimi 删除同一键，不读取浏览器数据库，不修改 Coding 凭据。

会员查询返回 HTTP 401 时，且配置了网页凭据，最多自动续期一次并重试月度查询一次；403、网络故障、5xx 不触发续期。网页公开 ca0791fedb2db-BIins8us.js 的 AuthService 描述符与调用确认 POST /api/account.gateway.v1.AuthService/RefreshToken，JSON {refresh_token}，返回 access_token/refresh_token（兼容 camelCase）。不是 Coding OAuth 的刷新接口。请求固定域名、显式 TLS 校验、禁止重定向、15 秒超时、finally 销毁 Agent。两项均为有效字符串才整体更新；单飞去重、保存前确认凭据未退出/重连。失败保留凭据与有效 Coding 统计，不打印令牌或响应正文。

固定有效期未从公开资源核实，不将 Coding OAuth 时长套用于网页令牌；刷新令牌失效仍需手动重连。没有真实账户令牌参与测试，实际账号自动续期仍需安装后验证。
