// DESIGN: v2-phase2-implementation.md#typests
// AGENTS: keep-minimal | no-logic
export interface QuotaData {
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

export type AuthStatus = 'unknown' | 'authenticated' | 'missing' | 'expired' | 'failed';
export type DataSource = 'api' | 'cache' | 'stale' | 'no-credentials' | 'no-data' | 'local-only';
export type DisplayMode = 'percent' | 'absolute';
export type LanguageSetting = 'auto' | 'en' | 'zh-CN';

export interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreatePerMillion: number;
}

export interface LocalEstimate {
  weeklyPct: number;
  windowPct: number;

  // Linear incremental model state variables (5h / 7d windows)
  weeklyP: number;            // 7d last API percentage snapshot
  weeklyC: number;            // 7d last local cost snapshot
  weeklyK: number;            // 7d ratio coefficient
  windowP: number;            // 5h last API percentage snapshot
  windowC: number;            // 5h last local cost snapshot
  windowK: number;            // 5h ratio coefficient

  calibratedAt: number | null;
  cost5h: number;
  cost7d: number;
  costToday: number;
  // Detailed usage for tooltip / dashboard display (from memory, not disk)
  requestsToday: number;
  tokensToday: number;
  tokensOutToday: number;
  tokensCacheReadToday: number;
  tokensCacheCreateToday: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  requests5h: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;
  requests7d: number;
  tokensThisCycle: number;
  tokensOutThisCycle: number;
  tokensCacheReadThisCycle: number;
  tokensCacheCreateThisCycle: number;
  costThisCycle: number;
  requestsThisCycle: number;
}

export interface CalibrationData {
  weeklyP: number;
  weeklyC: number;
  weeklyK: number;
  windowP: number;
  windowC: number;
  windowK: number;
  calibratedAt: number;
  reset5hAt: number;
  reset7dAt: number;
}

export interface EstHistoryEntry {
  /** Raw integer timestamp in milliseconds. Always stored and displayed as an integer. */
  timestamp: number;
  source: 'api' | 'short';
  apiWeeklyPct: number | null;
  apiWindowPct: number | null;
  estimatedWeeklyPct: number;
  estimatedWindowPct: number;
  localCost7d: number;
  localCost5h: number;
  weeklyP: number;
  weeklyC: number;
  weeklyK: number;
  windowP: number;
  windowC: number;
  windowK: number;
  windowStartMs: number;   // 5h window start timestamp
  weeklyStartMs: number;   // 7d window start timestamp
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
  usageEntries: UsageEntry[];
  estHistory: EstHistoryEntry[];
  activeProvider: string;
  ui: {
    displayMode: DisplayMode;
    language: LanguageSetting;
    isPaused: boolean;
  };
}

export interface ApiResponse {
  ok: boolean;
  data?: QuotaData;
  error?: string;
  authFailed?: boolean;
  networkError?: boolean;
}

export interface CachedData {
  quota: QuotaData;
  fetchedAt: number;
  calibration?: CalibrationData;
}

export interface KimiOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  scope: string;
  deviceId: string;
}

export type Action =
  | { type: 'INIT' }
  | { type: 'CACHE_LOADED'; payload: QuotaData; fetchedAt?: number }
  | { type: 'API_SUCCESS'; payload: QuotaData; source?: DataSource }
  | { type: 'API_ERROR'; payload: { error: string; authFailed?: boolean; networkError?: boolean } }
  | { type: 'LOCAL_ESTIMATE'; payload: Partial<LocalEstimate> & { entries?: UsageEntry[] } }
  | { type: 'API_HISTORY'; payload: { maxEntries: number; entry: EstHistoryEntry } }
  | { type: 'API_HISTORY_LOAD'; payload: EstHistoryEntry[] }
  | { type: 'AUTH_STATUS'; payload: AuthStatus }
  | { type: 'UI_SET_DISPLAY_MODE'; payload: DisplayMode }
  | { type: 'UI_SET_LANGUAGE'; payload: LanguageSetting }
  | { type: 'UI_SET_PAUSED'; payload: boolean }
  | { type: 'SET_PROVIDER'; payload: string }
  | { type: 'LOADING_START' }
  | { type: 'LOADING_END' }
  | { type: 'SIGN_OUT' };

// ============================================================================
// Phase 3: Dashboard Data Types
// ============================================================================

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

export interface DashboardMessage {
  usage: KimiUsageData;
  dashboard: DashboardAggregates | null;
  heatmap: HeatmapData | null;
  costCurveOptions: CostCurveOptions | null;
  pricing: TokenPricing;
  modelPricing: Record<string, TokenPricing>;
  settings: DashboardSettings;
  isLoading: boolean;
}

export interface KimiUsageData {
  // API data
  utilization5h: number;
  utilization7d: number;
  resetIn5h: number;
  resetIn7d: number;
  resetIn5hText?: string;
  resetIn7dText?: string;
  limitStatus: 'allowed' | 'allowed_warning' | 'denied';
  has7dLimit: boolean;
  providerType: 'openai' | 'api-key';

  // Local JSONL aggregate
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

  // Absolute display
  used5h: number;
  limit5h: number;
  used7d: number;
  limit7d: number;

  // Metadata
  lastUpdated: number;
  cacheAge: number;
  dataSource: DataSource;

  // Memory breakdown (optional)
  memoryBreakdown?: MemoryBreakdownItem[];
  memoryTotalBytes?: number;

  // Memory detail samples for expandable rows
  memoryEntrySamples?: Array<{
    timestamp: number;
    inputOther: number;
    output: number;
    inputCacheRead: number;
    inputCacheCreation: number;
    cost: number;
    messageId: string | null;
    model?: string;
  }>;
  memoryEntryTotalCount?: number;
  memoryLocalEstimate?: Record<string, number | string | null>;
  memoryQuota?: Record<string, number | string | null>;

  // Estimator history
  estHistory?: EstHistoryEntry[];
  estHistoryCount?: number;

  // Display settings passed to webview
  memoryDetailDisplayMaxRows?: number;
  memoryDetailCellMaxChars?: number;
}

export interface MemoryBreakdownItem {
  name: string;
  bytes: number;
  description: string;
}

export interface DashboardUsageData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  messageCount: number;
  modelBreakdown: Record<string, ModelBreakdownEntry>;
}

export interface ModelBreakdownEntry {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  cost: number;
  count: number;
}

export interface DashboardAggregates {
  today: DashboardUsageData | null;
  thisMonth: DashboardUsageData | null;
  allTime: DashboardUsageData | null;
  window5h: DashboardUsageData | null;
  window7d: DashboardUsageData | null;
  window30d: DashboardUsageData | null;
  hourlyForToday: HourlyBreakdownRow[];
  dailyForThisMonth: DailyBreakdownRow[];
  monthlyForAllTime: DailyBreakdownRow[]; // date is YYYY-MM-01
  allTimeStart: string | null;
  allTimeEnd: string | null;
}

export interface DailyBreakdownRow {
  date: string; // YYYY-MM-DD
  data: DashboardUsageData;
}

export interface HourlyBreakdownRow {
  hour: string; // "00:00".."23:00"
  data: DashboardUsageData;
}

export interface HeatmapData {
  daily: DailyUsage[];
  dailyByModel: DailyModelBreakdown[];
  cycles5hByModel: DailyModelBreakdown[];
  cycles7dByModel: DailyModelBreakdown[];
  cycles30dByModel: DailyModelBreakdown[];
  generatedAt: number;
}

export interface DailyUsage {
  date: string;      // YYYY-MM-DD local time
  cost: number;      // USD
  sessionCount: number;
  tokensTotal: number;
}

export interface DailyModelBreakdown {
  date: string;
  tokensTotal: number;
  costTotal: number;
  /** Per-model breakdown keyed by actual model name from UsageEntry.model */
  byModel: Record<string, { tokens: number; cost: number }>;
}

export interface CostCurveOptions {
  options5h: CostCurveOptionItem[];
  options7d: CostCurveOptionItem[];
  current5hStartMs: number;
  current7dStartMs: number;
}

export interface CostCurveOptionItem {
  label: string;
  startMs: number;
  endMs: number;
}

export interface CostCurvePoint {
  tMs: number;
  cumulativeRmb: number | null;
  sample?: boolean;
}

export interface DashboardSettings {
  provider: string;
  apiEnabled: boolean;
  cacheTtlSeconds: number;
  weeklyBudget: number | null;
  chartHeightRatio: number;
  officialUrl: string;
  officialDate: string;
  currencySymbol: string;
  memoryDetailMaxRows: number;
  memoryDetailDisplayMaxRows: number;
  memoryDetailCellMaxChars: number;
  apiHistoryMaxEntries: number;
  apiHistoryPersistOnExit: boolean;
}
