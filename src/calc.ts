// AGENTS: pure-fn | fmt-here | no-side-effect
import { QuotaData, TokenPricing, AppState } from './types';

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

export interface Calibration {
  tokenCapacity: number | null;
  windowCostCapacity: number | null;
  calibratedAt: number;
  resetAt: number;
}

/** Calibrate token capacity from API weeklyUsedPct and local tokens. */
export function calibrateTokenCapacity(
  apiWeeklyUsedPct: number,
  localTokensThisCycle: number,
): number | null {
  if (!apiWeeklyUsedPct || apiWeeklyUsedPct <= 0) return null;
  if (localTokensThisCycle <= 0) return null;
  const capacity = localTokensThisCycle / (apiWeeklyUsedPct / 100);
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Calibrate window cost capacity from API windowUsedPct and local cost. */
export function calibrateWindowCostCapacity(
  apiWindowUsedPct: number,
  localCost5h: number,
): number | null {
  if (!apiWindowUsedPct || apiWindowUsedPct <= 0) return null;
  if (localCost5h <= 0) return null;
  const capacity = localCost5h / (apiWindowUsedPct / 100);
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Heuristic estimate when API returns 0% but local has cost. */
export function estimateWindowCostCapacityHeuristic(
  localCost5h: number,
  windowLimit: number | null,
): number | null {
  if (localCost5h <= 0) return null;
  if (!windowLimit || windowLimit <= 0) return null;
  const capacity = localCost5h * windowLimit;
  return isFinite(capacity) && capacity > 0 ? capacity : null;
}

/** Estimate weekly percentage from local tokens and calibrated capacity. */
export function estimateWeeklyPct(
  localTokensThisCycle: number,
  tokenCapacity: number | null,
): number | null {
  if (!tokenCapacity || tokenCapacity <= 0) return null;
  if (localTokensThisCycle < 0) return null;
  const pct = (localTokensThisCycle / tokenCapacity) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Fallback weekly percentage when calibration is unavailable. */
export function fallbackWeeklyPct(
  localTokensThisCycle: number,
  weeklyLimit: number | null,
): number {
  if (!weeklyLimit || weeklyLimit <= 0) return 0;
  return Math.min(100, (localTokensThisCycle / weeklyLimit) * 100);
}

/** Estimate window percentage from local cost and calibrated capacity. */
export function estimateWindowPct(
  localCost5h: number,
  windowCostCapacity: number | null,
): number | null {
  if (!windowCostCapacity || windowCostCapacity <= 0) return null;
  if (localCost5h < 0) return null;
  const pct = (localCost5h / windowCostCapacity) * 100;
  return Math.min(100, Math.max(0, pct));
}

/** Fallback window percentage when calibration is unavailable. */
export function fallbackWindowPct(
  localCost5h: number,
  windowLimit: number | null,
): number {
  if (!windowLimit || windowLimit <= 0) return 0;
  return Math.min(100, (localCost5h / windowLimit) * 100);
}

/** Check if calibration is still valid for the current reset cycle. */
export function isCalibrationValid(
  calibration: Calibration | null,
  currentResetAt: number | null,
): boolean {
  if (!calibration || calibration.calibratedAt == null) return false;
  if (!currentResetAt) return false;
  if (calibration.resetAt !== currentResetAt) return false;
  if (Date.now() - calibration.calibratedAt > 7 * 24 * 3600 * 1000) return false;
  return true;
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
 *  1. Calibrated local estimate (most precise)
 *  2. API quota data
 *  3. Fallback to 0
 */
export function resolveWeeklyPct(state: AppState): number {
  const le = state.localEstimate;
  const q = state.quota;
  if (le && le.calibratedAt !== null) return le.weeklyPct;
  if (q) return q.weeklyUsedPct;
  return 0;
}

/** Resolve window percentage from state with consistent priority:
 *  1. Calibrated local estimate (most precise)
 *  2. API quota data
 *  3. Fallback to 0
 */
export function resolveWindowPct(state: AppState): number {
  const le = state.localEstimate;
  const q = state.quota;
  if (le && le.calibratedAt !== null) return le.windowPct;
  if (q) return q.windowUsedPct;
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
