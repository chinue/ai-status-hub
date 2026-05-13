// DESIGN: v2-provider-abstraction.md#provider-interfaces
// AGENTS: keep-minimal | no-logic

export interface Currency {
  code: string;      // 'USD' | 'CNY'
  symbol: string;    // '$' | '¥'
}

export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreatePerMillion: number;
}

export interface TokenUsage {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}

export interface UnifiedQuota {
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

export interface UnifiedUsageEntry {
  timestamp: number; // ms
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
  cost: number;
  messageId: string | null;
  model?: string;
}

export interface IAuthProvider {
  /** Resolve current available token (from file, SecretStorage, or env var) */
  resolveToken(): Promise<string | undefined>;
  /** Start login flow if applicable */
  startLoginFlow?(): Promise<boolean>;
  /** Invalidate cached token (called on sign out) */
  invalidate(): void;
}

export interface ApiResult {
  ok: boolean;
  data?: UnifiedQuota;
  error?: string;
  authFailed?: boolean;
  networkError?: boolean;
}

export interface IQuotaApiProvider {
  fetchQuota(token: string): Promise<ApiResult>;
}

export interface ILocalUsageProvider {
  /** Scan local session files and return parsed entries */
  scanSessions(opts?: {
    window5hStartMs?: number;
    window7dStartMs?: number;
    dataRetentionDays?: number;
    force?: boolean;
  }): Promise<UnifiedUsageEntry[]>;
  /** Invalidate any cached scan state */
  invalidate(): void;
}

export interface IPricingProvider {
  readonly currency: Currency;
  readonly defaultModelName: string;
  getPricing(modelName: string): TokenPricing;
  calculateCost(usage: TokenUsage, pricing: TokenPricing): number;
}

export interface IUIProvider {
  readonly mainIcon: string;           // '$(openai)' or '🌑'
  readonly statusBarName: string;      // 'CodexStatusPro Weekly'
  readonly dashboardTitle: string;     // 'Codex Dashboard'
  readonly displayName: string;        // 'Codex'
  readonly officialUrl: string;
  readonly extensionDisplayName: string;
}

export interface IProvider {
  readonly id: string;
  readonly displayName: string;
  readonly currency: Currency;
  auth: IAuthProvider;
  api: IQuotaApiProvider;
  localUsage: ILocalUsageProvider;
  pricing: IPricingProvider;
  ui: IUIProvider;
}
