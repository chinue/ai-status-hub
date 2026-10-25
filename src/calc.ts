// DESIGN: v2-local-estimation-design.md#quota-percentage-resolution
// AGENTS: pure-fn | fmt-here | no-side-effect
import { QuotaData, TokenPricing, AppState, UsageEntry } from './types';
import { RateLimits } from './providers/base/types';

export interface UtilizationResult {
  weeklyPct: number;
  windowPct: number;
  weeklyUtil: number;
  windowUtil: number;
  weeklyBar: string;
  windowBar: string;
  weeklyMiniBar: string;
  windowMiniBar: string;
}

export function computeUtilization(quota: QuotaData | null): UtilizationResult {
  if (!quota) {
    return { weeklyPct: 0, windowPct: 0, weeklyUtil: 0, windowUtil: 0, weeklyBar: '', windowBar: '', weeklyMiniBar: '', windowMiniBar: '' };
  }

  const weeklyUtil = quota.weeklyLimit > 0 ? (quota.weeklyUsed / quota.weeklyLimit) : 0;
  const windowUtil = quota.windowLimit > 0 ? (quota.windowUsed / quota.windowLimit) : 0;
  const weeklyPct = Math.min(100, Math.max(0, quota.weeklyUsedPct ?? weeklyUtil * 100));
  const windowPct = Math.min(100, Math.max(0, quota.windowUsedPct ?? windowUtil * 100));

  return {
    weeklyPct,
    windowPct,
    weeklyUtil,
    windowUtil,
    weeklyBar: buildBar(weeklyUtil, 10),
    windowBar: buildBar(windowUtil, 10),
    weeklyMiniBar: buildMiniBar(weeklyUtil, 5),
    windowMiniBar: buildMiniBar(windowUtil, 5),
  };
}

export function buildBar(util: number, width: number): string {
  const safe = Math.max(0, Math.min(1, isFinite(util) ? util : 0));
  const filled = Math.round(safe * width);
  return '\u25B0'.repeat(filled) + '\u25B1'.repeat(width - filled);
}

export function buildMiniBar(util: number, width = 5): string {
  return buildBar(util, width);
}

export function formatPercent(pct: number, decimals = 0): string {
  const safe = isFinite(pct) ? pct : 0;
  return safe.toFixed(decimals) + '%';
}

/** Format a percentage with fixed-width padding like C's %5.2f.
 *  Default width 5 (for 2 decimals: e.g. '12.34') plus '%' suffix.
 */
export function formatPercentPadded(pct: number, decimals = 2): string {
  if (!isFinite(pct)) pct = 0;
  const numStr = pct.toFixed(decimals).padStart(5, ' ');
  return numStr + '%';
}

export function fmtDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return ' 0s';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const mins = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  const padSpace = (n: number) => String(n).padStart(2, ' ');
  const padZero = (n: number) => String(n).padStart(2, '0');
  if (days > 0) return `${padSpace(days)}d${padZero(hours)}h`;
  if (hours > 0) return `${padSpace(hours)}h${padZero(mins)}m`;
  if (mins > 0) return `${padSpace(mins)}m${padZero(secs)}s`;
  return `${padSpace(secs)}s`;
}

export function fmtHours(h: number): string {
  return fmtDuration(Math.round(h * 3600));
}

export interface ResetTimeInfo {
  resetAt: number;
  isEstimated: boolean;
}

/** 解析/推算重置时间。若 resetAt 已过期，按固定周期推算下一个重置点。 */
export function resolveResetTime(
  resetAtMs: number | null | undefined,
  periodMs: number,
  now = Date.now(),
): ResetTimeInfo {
  if (!resetAtMs || resetAtMs <= 0) {
    return { resetAt: now + periodMs, isEstimated: true };
  }
  if (resetAtMs > now) {
    return { resetAt: resetAtMs, isEstimated: false };
  }
  // 已过期：推算下一个周期
  const periodsPassed = Math.floor((now - resetAtMs) / periodMs) + 1;
  const nextResetAt = resetAtMs + periodsPassed * periodMs;
  return { resetAt: nextResetAt, isEstimated: true };
}

/** 格式化为 "YYYY-MM-DD HH:mm:ss (XdXh)"，过期时自动推算下一个周期。
 *  示例："2026-05-17 02:25:00 ( 2d14h)"
 */
export function fmtResetTime(
  resetAtMs: number | null | undefined,
  periodMs: number,
  now = Date.now(),
): string {
  const info = resolveResetTime(resetAtMs, periodMs, now);
  const abs = fmtDateTime(info.resetAt);
  const remaining = fmtDuration(Math.max(0, Math.round((info.resetAt - now) / 1000)));
  return `${abs} (${remaining})`;
}

export interface TokenUsage {
  inputOther: number;
  output: number;
  inputCacheRead: number;
  inputCacheCreation: number;
}

export function calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
  const cost = (
    (usage.inputOther / 1_000_000) * pricing.inputPerMillion +
    (usage.output / 1_000_000) * pricing.outputPerMillion +
    (usage.inputCacheRead / 1_000_000) * pricing.cacheReadPerMillion +
    (usage.inputCacheCreation / 1_000_000) * pricing.cacheCreatePerMillion
  );
  return isFinite(cost) && cost >= 0 ? cost : 0;
}

/** 解析用户自定义模型价格字符串 "input,output,cacheRead,cacheWrite"（USD/百万 token）。
 *  兼容中文逗号与空格；必须恰好 4 个有限非负数，否则返回 null。
 *  示例：parseCustomPricing('10,50,1,12.5')
 */
export function parseCustomPricing(value: string): TokenPricing | null {
  const parts = value.split(/[,，]/).map(s => s.trim());
  if (parts.length !== 4) { return null; }
  const nums = parts.map(s => (s === '' ? NaN : Number(s)));
  if (nums.some(n => !isFinite(n) || n < 0)) { return null; }
  return {
    inputPerMillion: nums[0],
    outputPerMillion: nums[1],
    cacheReadPerMillion: nums[2],
    cacheCreatePerMillion: nums[3],
  };
}

/** 将模型名映射为定价配置键（须与 package.json 中 pricing.*.models.<key> 完全一致，区分大小写）。
 *  示例：pricingModelKey('claude-opus-5-5') → 'claudeOpus5_5'；pricingModelKey('gpt-6-sol') → 'gpt6Sol'
 */
export function pricingModelKey(modelName: string): string {
  const m = modelName.toLowerCase();
  // Claude family
  if (/(?:fable|mythos)[\s._-]*5[\s._-]+1(?!\d)/.test(m)) { return 'claudeFable5_1'; }
  if (m.includes('fable') || m.includes('mythos')) { return 'claudeFable'; }
  if (/opus[\s._-]*5[\s._-]+5(?!\d)/.test(m)) { return 'claudeOpus5_5'; }
  if (m.includes('opus')) { return 'claudeOpus'; }
  if (/sonnet[\s._-]*5[\s._-]+5(?!\d)/.test(m)) { return 'claudeSonnet5_5'; }
  if (/sonnet[\s._-]*5(?:$|[^\d\s._-]|[\s._-]+\d{8}(?:$|\D))/.test(m)) { return 'claudeSonnet5'; }
  if (m.includes('sonnet')) { return 'claudeSonnet'; }
  if (/haiku[\s._-]*5[\s._-]+5(?!\d)/.test(m)) { return 'claudeHaiku5_5'; }
  if (m.includes('haiku')) { return 'claudeHaiku'; }
  if (/gpt[\s._-]*6[\s._-]+1[\s._-]+sol(?:$|[^a-z0-9])/.test(m)) { return 'gpt6_1Sol'; }
  if (/gpt[\s._-]*5[\s._-]+6(?:$|[\s._-]+sol(?:$|[^a-z0-9]))/.test(m)) { return 'gpt5_6Sol'; }
  // GPT-6 family (bare "gpt-6" falls back to the flagship Astra)
  if (/gpt[\s._-]*6/.test(m)) {
    if (m.includes('luna')) { return 'gpt6Luna'; }
    if (m.includes('sol')) { return 'gpt6Sol'; }
    return 'gpt6Astra';
  }
  // Kimi family
  if (/k3[\s._-]+1[\s._-]+pro(?:$|[^a-z0-9])/.test(m)) {
    return m.includes('highspeed') ? 'k3_1ProHighspeed' : 'k3_1Pro';
  }
  if (/k2[\s._-]+7[\s._-]+code(?:$|[^a-z0-9])/.test(m)) {
    return m.includes('highspeed') ? 'k2_7CodeHighspeed' : 'k2_7Code';
  }
  if (m.includes('k3')) { return 'k3'; }
  if (m.includes('kimi')) { return 'k2_6'; }
  return m.replace(/[^a-z0-9]/g, '');
}

/** Format a token count with k/M suffix. */
export function fmtTokens(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return String(n);
}

/** Format a cost with given currency symbol and 2 decimals. */
export function fmtCost(cost: number, currencySymbol = '$'): string {
  const safe = isFinite(cost) ? cost : 0;
  return currencySymbol + safe.toFixed(2);
}

// DESIGN: v2-local-estimation-design.md
// ---------------------------------------------------------------------------
// Phase 2: Calibration & Estimation
// ---------------------------------------------------------------------------

// DESIGN: v2-local-estimation-design.md
// ---------------------------------------------------------------------------
// Linear Incremental Estimator (unified cost-based model for 5h/7d)
// ---------------------------------------------------------------------------

export interface ILinearEstimator {
  /** Snapshot of last API official percentage */
  P: number;
  /** Snapshot of last local cost at the same API moment */
  C: number;
  /** Ratio coefficient k = P / C (updated only when P > 5% and C > 0) */
  k: number;

  /** Update state on API success */
  update(apiPct: number, localCost: number): void;
  /** Estimate current percentage from current local cost */
  estimate(currentCost: number): number;
}

export function createLinearEstimator(): ILinearEstimator {
  return {
    P: 0,
    C: 0,
    k: 0,

    update(apiPct: number, localCost: number): void {
      if (apiPct > 5 && localCost > 0) {
        this.k = apiPct / localCost;
      }
      this.P = apiPct;
      this.C = localCost;
    },

    estimate(currentCost: number): number {
      if (this.k <= 0 || !isFinite(this.k)) {
        return Math.max(0, Math.min(100, currentCost));
      }
      const p = this.P + this.k * (currentCost - this.C);
      return Math.max(0, Math.min(100, p));
    },
  };
}

/** Safe estimate wrapper: tries estimateFn, falls back to fallbackFn. */
export function safeEstimate(
  estimateFn: () => number | null,
  fallbackFn: () => number,
): number {
  try {
    const result = estimateFn();
    return result !== null && isFinite(result) ? result : fallbackFn();
  } catch {
    return fallbackFn();
  }
}

// ---------------------------------------------------------------------------
// Unified percentage resolution (statusBar / tooltip / dashboard consistency)
// ---------------------------------------------------------------------------

/** Resolve weekly percentage from state with consistent priority:
 *  1. API quota data (authoritative source)
 *  2. Calibrated local estimate (only when it refines the same API value)
 *  3. Fallback to 0
 *
 *  We never let a stale or drifted local estimate override the API value.
 *  Calibration is only used to preserve decimal precision when the rounded
 *  estimate matches the integer API percentage.
 */
export function resolveWeeklyPct(state: AppState): number {
  const le = state.localEstimate;
  const q = state.quota;
  if (q) {
    // 若 weeklyResetAt 已过期（且不是未设置的 0），周期用量应已归零
    if (q.weeklyResetAt > 0 && q.weeklyResetAt <= Date.now()) return 0;
    if (le && le.calibratedAt !== null && Math.round(le.weeklyPct) === q.weeklyUsedPct) {
      return le.weeklyPct; // Preserve decimal precision from calibration
    }
    return q.weeklyUsedPct;
  }
  if (le && le.calibratedAt !== null) return le.weeklyPct;
  return 0;
}

/** Resolve window percentage from state with consistent priority.
 *  Same logic as resolveWeeklyPct: API quota is authoritative.
 */
export function resolveWindowPct(state: AppState): number {
  const le = state.localEstimate;
  const q = state.quota;
  if (q) {
    // 若 windowResetAt 已过期（且不是未设置的 0），窗口用量应已归零
    if (q.windowResetAt > 0 && q.windowResetAt <= Date.now()) return 0;
    if (le && le.calibratedAt !== null && Math.round(le.windowPct) === q.windowUsedPct) {
      return le.windowPct; // Preserve decimal precision from calibration
    }
    return q.windowUsedPct;
  }
  if (le && le.calibratedAt !== null) return le.windowPct;
  return 0;
}

/** Resolve Claude's optional Fable weekly percentage.
 *  Once its reset time arrives, keep the known limit visible but reset usage.
 */
export function resolveFableWeeklyPct(state: AppState, now = Date.now()): number | undefined {
  const quota = state.quota;
  if (quota?.fableWeeklyUsedPct == null) return undefined;
  if (quota.fableWeeklyResetAt != null
      && quota.fableWeeklyResetAt > 0
      && quota.fableWeeklyResetAt <= now) {
    return 0;
  }
  return quota.fableWeeklyUsedPct;
}

/** Resolve how the status bar should present the current auth state.
 *
 *  - 'normal'   — no auth error; render usage as usual.
 *  - 'degraded' — auth expired/failed but cached quota or local estimate is
 *                 available; render usage with a \uD83D\uDD10 indicator instead of a
 *                 blocking error (token recovers automatically once the user
 *                 runs Claude Code again).
 *  - 'blocked'  — auth expired/failed and no data at all; show the full
 *                 error state.
 *
 *  `authStatus === 'missing'` (never signed in) is NOT handled here; the
 *  presenter short-circuits it before calling this function.
 */
export function resolveAuthDisplayMode(state: AppState): 'normal' | 'degraded' | 'blocked' {
  const authError =
    state.authStatus === 'expired' ||
    (state.authStatus === 'failed' && !!state.error);
  if (!authError) return 'normal';
  const hasData = !!state.quota || !!state.localEstimate;
  return hasData ? 'degraded' : 'blocked';
}

export type IndicatorPart = 'stale' | 'source' | 'auth';

/** Build the emoji indicator suffix appended to status bar items.
 *  Order is fixed: stale (\uD83D\uDCA4) → source (\uD83C\uDF10 / \u26D3\uFE0F\u200D\uD83D\uDCA5) → auth (\uD83D\uDD10).
 *  `parts` selects which indicators a given status bar item displays.
 */
export function buildIndicatorSuffix(
  state: AppState,
  now: number,
  staleThresholdMs: number,
  parts: IndicatorPart[],
): string {
  let suffix = '';
  if (parts.includes('stale')) {
    const isStale = state.lastSuccessfulFetchAt
      ? now - state.lastSuccessfulFetchAt > staleThresholdMs
      : !state.quota;
    if (isStale) { suffix += ' \uD83D\uDCA4'; }
  }
  if (parts.includes('source')) {
    if (state.dataSource === 'api') {
      suffix += ' \uD83C\uDF10';
    } else if (state.dataSource === 'local-only') {
      suffix += ' \u26D3\uFE0F\u200D\uD83D\uDCA5';
    }
  }
  if (parts.includes('auth') && resolveAuthDisplayMode(state) === 'degraded') {
    suffix += ' \uD83D\uDD10';
  }
  return suffix;
}

// ---------------------------------------------------------------------------
// Border Table Drawing (reusable, CJK-aware)
// ---------------------------------------------------------------------------

type Align = 'l' | 'm' | 'r';

function isCombiningMark(cp: number): boolean {
  return (
    (cp >= 0x0300 && cp <= 0x036F) ||
    (cp >= 0x1AB0 && cp <= 0x1AFF) ||
    (cp >= 0x1DC0 && cp <= 0x1DFF) ||
    (cp >= 0x20D0 && cp <= 0x20FF) ||
    (cp >= 0xFE20 && cp <= 0xFE2F)
  );
}

function isWideChar(cp: number): boolean {
  return (
    (cp >= 0x1100 && cp <= 0x115F) ||
    (cp >= 0x2329 && cp <= 0x232A) ||
    (cp >= 0x2E80 && cp <= 0xA4CF) ||
    (cp >= 0xAC00 && cp <= 0xD7A3) ||
    (cp >= 0xF900 && cp <= 0xFAFF) ||
    (cp >= 0xFE10 && cp <= 0xFE19) ||
    (cp >= 0xFE30 && cp <= 0xFE6F) ||
    (cp >= 0xFF00 && cp <= 0xFF60) ||
    (cp >= 0xFFE0 && cp <= 0xFFE6) ||
    (cp >= 0x20000 && cp <= 0x3FFFD)
  );
}

/** Compute display width of a string (CJK = 2 cols). */
export function displayWidth(s: string): number {
  let w = 0;
  for (const ch of s) {
    const cp = ch.codePointAt(0) ?? 0;
    if (isCombiningMark(cp)) continue;
    w += isWideChar(cp) ? 2 : 1;
  }
  return w;
}

/** Pad a cell to a given display width with specified alignment. */
export function padCell(s: string, width: number, align: Align): string {
  const n = displayWidth(s);
  const space = Math.max(0, width - n);
  if (align === 'l') return s + ' '.repeat(space);
  if (align === 'r') return ' '.repeat(space) + s;
  const left = Math.floor(space / 2);
  const right = space - left;
  return ' '.repeat(left) + s + ' '.repeat(right);
}

/** Draw an ASCII border table. Returns an array of lines (no outer newlines). */
export function drawBorderTable(
  header: string[],
  rows: string[][],
  align: Align[],
): string[] {
  const colCount = header.length;
  const widths = new Array<number>(colCount).fill(0);
  for (let i = 0; i < colCount; i++) {
    widths[i] = Math.max(widths[i], displayWidth(header[i] ?? ''));
  }
  for (const r of rows) {
    for (let i = 0; i < colCount; i++) {
      widths[i] = Math.max(widths[i], displayWidth(r[i] ?? ''));
    }
  }

  function border(lineChar: '-' | '='): string {
    return '+' + widths.map(w => lineChar.repeat(w + 2)).join('+') + '+';
  }
  function renderRow(cells: string[], a: Align[]): string {
    return '|' + cells.map((c, i) => ' ' + padCell(c ?? '', widths[i], a[i] ?? 'm') + ' ').join('|') + '|';
  }

  const out: string[] = [];
  out.push(border('-'));
  out.push(renderRow(header, header.map(() => 'm')));
  out.push(border('-'));
  for (const r of rows) {
    out.push(renderRow(r, align));
  }
  out.push(border('-'));
  return out;
}

// ============================================================================
// Phase 3: History Aggregation Helpers
// ============================================================================

export interface TimeBucket {
  key: string;
  startMs: number;
  endMs: number;
}

/** Build daily buckets for a date range [startMs, endMs]. */
export function buildDailyBuckets(startMs: number, endMs: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const d = new Date(startMs);
  d.setHours(0, 0, 0, 0);
  while (d.getTime() <= endMs) {
    const dayStart = d.getTime();
    const dayEnd = dayStart + 24 * 3600 * 1000 - 1;
    buckets.push({
      key: formatDateLocal(dayStart),
      startMs: dayStart,
      endMs: Math.min(dayEnd, endMs),
    });
    d.setDate(d.getDate() + 1);
  }
  return buckets;
}

/** Build hourly buckets for a single day (local time). */
export function buildHourlyBuckets(dayMs: number): TimeBucket[] {
  const buckets: TimeBucket[] = [];
  const d = new Date(dayMs);
  d.setHours(0, 0, 0, 0);
  for (let h = 0; h < 24; h++) {
    const hourStart = d.getTime() + h * 3600 * 1000;
    buckets.push({
      key: `${String(h).padStart(2, '0')}:00`,
      startMs: hourStart,
      endMs: hourStart + 3600 * 1000 - 1,
    });
  }
  return buckets;
}

/** Format a timestamp as YYYY-MM-DD in local time. */
export function formatDateLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Format a timestamp as YYYY-MM in local time. */
export function formatMonthLocal(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

/** Format a timestamp as YYYY-MM-DD HH:mm:ss in local time (24-hour). */
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  return `${y}-${m}-${day} ${hh}:${min}:${ss}`;
}

/** Format currency with given symbol and 2 decimals. */
export function fmtCurrency(n: number, currencySymbol = '$'): string {
  const safe = isFinite(n) ? n : 0;
  return currencySymbol + safe.toFixed(2);
}

/** Format large numbers with commas. */
export function fmtNumber(n: number): string {
  const safe = isFinite(n) ? Math.round(n) : 0;
  return safe.toLocaleString('en-US');
}

/** Format a timestamp for cost curve X-axis labels. */
export function fmtCostCurveTime(ms: number, window: '5h' | '7d'): string {
  const d = new Date(ms);
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  if (window === '5h') {
    return `${hh}:${mm}:${ss}`;
  }
  const mo = d.getMonth() + 1;
  const day = d.getDate();
  return `${mo}.${day}-${hh}:${mm}`;
}

/** Heatmap color interpolation: blue (low) -> red (high). */
export function heatmapColor(t: number): string {
  t = Math.max(0, Math.min(1, t));
  const c0 = [13, 71, 161];
  const c1 = [191, 54, 12];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  return `rgb(${r},${g},${b})`;
}

// ---------------------------------------------------------------------------
// Memory Estimation
// ---------------------------------------------------------------------------

export interface MemoryBreakdownItem {
  name: string;
  bytes: number;
  description: string;
  detailEntries?: Array<{ label: string; value: string; bytes?: number }>;
}

export interface MemoryBreakdown {
  totalBytes: number;
  items: MemoryBreakdownItem[];
}

function estimateStringBytes(s: string | null | undefined): number {
  if (s == null) return 4;
  return 24 + s.length * 2;
}

function estimateEntryBytes(entry: UsageEntry): number {
  // V8 JSObject header + 6 number properties + 2 string properties
  return 64
    + 6 * 8
    + estimateStringBytes(entry.messageId)
    + estimateStringBytes(entry.model);
}

/** Estimate memory footprint of the given AppState. */
export function estimateStateMemory(state: AppState | null): MemoryBreakdown {
  if (!state) {
    return { totalBytes: 0, items: [] };
  }

  const items: MemoryBreakdownItem[] = [];

  // 1. usageEntries — biggest contributor
  const usageEntriesBytes = state.usageEntries.reduce(
    (sum, e) => sum + estimateEntryBytes(e),
    0,
  );
  if (usageEntriesBytes > 0) {
    items.push({
      name: 'Store.usageEntries',
      bytes: usageEntriesBytes,
      description: 'Retention-period usage entries for heatmap / detail',
    });
  }

  // 2. localEstimate
  const localEstimateBytes = state.localEstimate ? 1024 : 0;
  if (localEstimateBytes > 0 && state.localEstimate) {
    let fieldBytes = 0;
    const detailEntries: Array<{ label: string; value: string; bytes: number }> = [];
    for (const [k, v] of Object.entries(state.localEstimate)) {
      let b: number;
      if (v === null || v === undefined) { b = 0; }
      else if (typeof v === 'number') { b = 8; }
      else if (typeof v === 'boolean') { b = 4; }
      else if (typeof v === 'string') { b = v.length * 2 + 8; }
      else if (typeof v === 'object') { b = 256; }
      else { b = 8; }
      fieldBytes += b;
      detailEntries.push({ label: k, value: String(v ?? ''), bytes: b });
    }
    detailEntries.push({ label: 'object overhead', value: 'V8 header + hidden class', bytes: localEstimateBytes - fieldBytes });
    items.push({
      name: 'Store.localEstimate',
      bytes: localEstimateBytes,
      description: 'Local estimate state (P/C/k + aggregated costs/tokens)',
      detailEntries,
    });
  }

  // 3. quota
  const quotaBytes = state.quota ? 512 : 0;
  if (quotaBytes > 0 && state.quota) {
    let fieldBytes = 0;
    const detailEntries: Array<{ label: string; value: string; bytes: number }> = [];
    for (const [k, v] of Object.entries(state.quota)) {
      let b: number;
      if (v === null || v === undefined) { b = 0; }
      else if (typeof v === 'number') { b = 8; }
      else if (typeof v === 'boolean') { b = 4; }
      else if (typeof v === 'string') { b = v.length * 2 + 8; }
      else if (typeof v === 'object') { b = 256; }
      else { b = 8; }
      fieldBytes += b;
      detailEntries.push({ label: k, value: String(v ?? ''), bytes: b });
    }
    detailEntries.push({ label: 'object overhead', value: 'V8 header + hidden class', bytes: quotaBytes - fieldBytes });
    items.push({
      name: 'Store.quota',
      bytes: quotaBytes,
      description: 'API quota data (limits / used / reset times)',
      detailEntries,
    });
  }

  // 4. estHistory
  const estHistoryBytes = state.estHistory.length * (17 * 8);
  if (estHistoryBytes > 0) {
    items.push({
      name: 'Store.estHistory',
      bytes: estHistoryBytes,
      description: 'Estimator history (api + short tick) for accuracy evaluation',
    });
  }

  // 5. Store overhead (listeners, UI state, etc.)
  items.push({
    name: 'Store.storeOverhead',
    bytes: 2048,
    description: 'Store listeners, UI state, provider refs',
    detailEntries: [
      { label: 'activeProvider', value: state.activeProvider, bytes: 64 },
      { label: 'displayMode', value: state.ui.displayMode, bytes: 32 },
      { label: 'language', value: state.ui.language, bytes: 32 },
      { label: 'isPaused', value: String(state.ui.isPaused), bytes: 16 },
      { label: 'authStatus', value: state.authStatus, bytes: 32 },
      { label: 'dataSource', value: state.dataSource, bytes: 32 },
      { label: 'listeners (est.)', value: '2+', bytes: 512 },
      { label: 'reducer + dispatch', value: 'internal', bytes: 512 },
      { label: 'other internals', value: 'state refs, cache', bytes: 816 },
    ],
  });

  // Sort by bytes descending
  items.sort((a, b) => b.bytes - a.bytes);

  const totalBytes = items.reduce((sum, item) => sum + item.bytes, 0);

  return { totalBytes, items };
}

/** Format a byte count into human-readable string. */
export function formatMemorySize(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / 1024 / 1024 / 1024).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
  return bytes + ' B';
}

/** Format both quota windows in one provider status cell. */
export function formatProviderStatus(state: AppState, icon: string, name: string, mode: 'percent' | 'absolute', now = Date.now()): string {
  const weekly = resolveWeeklyPct(state);
  const window = resolveWindowPct(state);
  const quota = state.quota;
  const weeklyText = mode === 'absolute' && quota ? `${quota.weeklyUsed}/${quota.weeklyLimit}` : formatPercent(weekly, 2);
  const windowText = mode === 'absolute' && quota ? `${quota.windowUsed}/${quota.windowLimit}` : formatPercent(window, 2);
  const indicators = buildIndicatorSuffix(state, now, 120_000, ['stale', 'source', 'auth']);
  const shortCell = quota?.has5hLimit === false ? '' : ` | 5️⃣ ${windowText}`;
  return `${icon} ${name}:${weeklyText}${shortCell}${indicators}`;
}

/** Preserve the configured quota colors, using remaining weekly quota as the input. */
export function remainingQuotaColor(remainingPct: number, colors: readonly string[]): string {
  const remaining = Number.isFinite(remainingPct) ? Math.max(0, Math.min(100, remainingPct)) : 100;
  const used = 100 - remaining;
  return colors[used < 20 ? 0 : used < 40 ? 1 : used < 60 ? 2 : used < 80 ? 3 : 4];
}

/** Resolve Codex windows by duration; primary is weekly on current Pro plans. */
export function codexRateLimitsToQuota(limits: RateLimits, now: number): QuotaData {
  const windows = [limits.primary, limits.secondary];
  const short = windows.find(w => w?.window_minutes === 300)
    ?? (limits.primary?.window_minutes == null ? limits.primary : undefined);
  const weekly = windows.find(w => w?.window_minutes === 10080)
    ?? (limits.secondary?.window_minutes == null ? limits.secondary : undefined);
  const resetAt = (w: RateLimits['primary'], fallbackSeconds: number) => w?.resets_at
    ? w.resets_at * 1000 : now + (w?.resets_in_seconds ?? fallbackSeconds) * 1000;
  const weeklyPct = weekly?.used_percent ?? 0;
  const windowPct = short?.used_percent ?? 0;
  return {
    weeklyLimit: weekly ? 100 : 0, weeklyUsed: weeklyPct, weeklyUsedPct: weeklyPct,
    weeklyResetAt: resetAt(weekly, 7 * 86400),
    has5hLimit: !!short, windowLimit: short ? 100 : 0,
    windowUsed: windowPct, windowUsedPct: windowPct,
    windowRemaining: short ? Math.max(0, 100 - windowPct) : 0,
    // Without a quota reset, the analysis window ends now (rolling five hours).
    windowResetAt: short ? resetAt(short, 5 * 3600) : now, parallelLimit: 0,
  };
}
