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
