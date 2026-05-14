// AGENTS: pure-fn | fmt-here | no-side-effect
import { QuotaData, TokenPricing, AppState, UsageEntry } from './types';

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
  const periodsPassed = Math.ceil((now - resetAtMs) / periodMs);
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
  if (localEstimateBytes > 0) {
    items.push({
      name: 'Store.localEstimate',
      bytes: localEstimateBytes,
      description: 'Local estimate state (P/C/k + aggregated costs/tokens)',
    });
  }

  // 3. quota
  const quotaBytes = state.quota ? 512 : 0;
  if (quotaBytes > 0) {
    items.push({
      name: 'Store.quota',
      bytes: quotaBytes,
      description: 'API quota data (limits / used / reset times)',
    });
  }

  // 4. estHistory
  const estHistoryBytes = state.estHistory.length * (15 * 8);
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
