// DESIGN: v2-phase2-implementation.md#presentersstatusbarts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import {
  computeUtilization, formatPercent, formatPercentPadded,
  fmtHours, fmtTokens, fmtCost,
  buildBar, buildMiniBar, drawBorderTable,
  resolveWeeklyPct, resolveWindowPct,
} from '../calc';
import { AppState } from '../types';

const STALE_THRESHOLD_MS = 120_000; // 2 minutes

const MOON_FRAMES = ['\uD83C\uDF15', '\uD83C\uDF16', '\uD83C\uDF17', '\uD83C\uDF18'];
// MOON_ANIMATION_INTERVAL_MS is now read from config.updateAnimationIntervalMs (default 300ms)

function alignmentFromString(raw: string): vscode.StatusBarAlignment {
  return raw === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
}

export class StatusBarPresenter {
  private itemWeekly: vscode.StatusBarItem;
  private itemWindow: vscode.StatusBarItem;
  private itemPause: vscode.StatusBarItem;
  private config = ConfigService.getInstance();
  private disposables: vscode.Disposable[] = [];
  private updateAnimInterval: NodeJS.Timeout | null = null;
  private updateAnimTimeout: NodeJS.Timeout | null = null;
  private moonFrame = 0;
  private lastSeenWeeklyPct: number | null = null;
  private lastSeenWindowPct: number | null = null;

  constructor(private store: Store) {
    const alignment = this.config.statusBarAlignment;

    this.itemWeekly = vscode.window.createStatusBarItem(alignment, 104);
    this.itemWeekly.name = 'CodexStatusPro Weekly';
    this.itemWeekly.command = 'codexStatusPro.showDashboard';
    this.itemWeekly.text = '$(sync~spin) Codex…';
    this.itemWeekly.show();

    this.itemWindow = vscode.window.createStatusBarItem(alignment, 103);
    this.itemWindow.name = 'CodexStatusPro Window';
    this.itemWindow.command = 'codexStatusPro.refresh';
    this.itemWindow.show();

    this.itemPause = vscode.window.createStatusBarItem(alignment, 102);
    this.itemPause.name = 'CodexStatusPro Pause';
    this.itemPause.command = 'codexStatusPro.togglePause';
    this.itemPause.text = '\u23F8\uFE0F';
    this.itemPause.show();

    const unsub = store.subscribe((state) => this.render(state));
    this.disposables.push({ dispose: unsub });

    // Initial render
    this.render(store.getState());
  }

  private render(state: AppState): void {
    try {
      const locale = ConfigService.resolveEffectiveLanguage(state.ui.language);
      const t = makeT(locale);
      // Pause icon: moon when paused (to indicate dormant), pause symbol when active
      this.itemPause.text = state.ui.isPaused ? '\uD83C\uDF18' : '\u23F8\uFE0F';
      this.itemPause.tooltip = state.ui.isPaused ? t('tooltip.resumeAutoRefresh') : t('tooltip.pauseAutoRefresh');

      // When paused, hide data items and show only pause button
      if (state.ui.isPaused) {
        this.stopUpdateAnimation();
        this.itemWeekly.hide();
        this.itemWindow.hide();
        return;
      }

      if (state.authStatus === 'missing') {
        this.stopUpdateAnimation();
        this.itemWeekly.text = '$(key) Codex: sign in';
        this.itemWeekly.command = 'codexStatusPro.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWeekly.color = new vscode.ThemeColor('statusBarItem.errorForeground');
        this.itemWindow.hide();
        return;
      }

      if (state.error && state.authStatus === 'failed') {
        this.stopUpdateAnimation();
        this.itemWeekly.text = '$(warning) Codex: auth failed';
        this.itemWeekly.command = 'codexStatusPro.signIn';
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
        this.itemWindow.hide();
        return;
      }

      const hasApiData = !!state.quota;
      const hasEstimate = !!state.localEstimate;

      if (!hasApiData && !hasEstimate) {
        this.stopUpdateAnimation();
        this.itemWeekly.text = '$(sync~spin) Codex…';
        this.itemWeekly.backgroundColor = undefined;
        this.itemWindow.hide();
        return;
      }

      // Detect meaningful data changes and trigger moon animation
      const weeklyPct = resolveWeeklyPct(state);
      const windowPct = resolveWindowPct(state);
      const isFirstData = this.lastSeenWeeklyPct === null && this.lastSeenWindowPct === null;
      const hasChanged =
        this.lastSeenWeeklyPct !== weeklyPct ||
        this.lastSeenWindowPct !== windowPct;

      this.lastSeenWeeklyPct = weeklyPct;
      this.lastSeenWindowPct = windowPct;

      // Skip animation on first data arrival so user sees the value immediately;
      // play animation only on subsequent updates.
      if (hasChanged && !isFirstData) {
        this.triggerUpdateAnimation();
      }

      const weeklyUtil = weeklyPct / 100;
      const windowUtil = windowPct / 100;

      const isStale = state.lastSuccessfulFetchAt
        ? Date.now() - state.lastSuccessfulFetchAt > STALE_THRESHOLD_MS
        : !hasApiData;
      const staleIndicator = isStale ? ' \uD83D\uDCA4' : '';
      const estimateIndicator = !hasApiData && hasEstimate ? ' \uD83D\uDD0D' : ''; // 🔍 for estimate
      const errorIndicator = state.error && (state.error.includes('network') || state.error.includes('ECONN'))
        ? ' \u26D3\uFE0F\u200D\uD83D\uDCA5'
        : '';

      // Always render itemWindow (even during animation) so it stays visible
      if (this.config.displayMode === 'absolute') {
        if (hasApiData) {
          this.itemWindow.text = `5\uFE0F\u20E3 ${state.quota!.windowUsed}/${state.quota!.windowLimit}${staleIndicator}`;
        } else {
          this.itemWindow.text = `5\uFE0F\u20E3 ${windowPct > 0 ? '~' + formatPercent(windowPct, 1) : '—'}${staleIndicator}`;
        }
      } else {
        this.itemWindow.text = `5\uFE0F\u20E3 ${buildMiniBar(windowUtil, 5)} ${formatPercent(windowPct, 1)}${staleIndicator}`;
      }
      this.itemWindow.color = this.utilizationToColor(windowUtil);
      this.itemWindow.show();

      // While animation is active, skip itemWeekly normal rendering
      if (this.updateAnimInterval) {
        return;
      }

      if (this.config.displayMode === 'absolute') {
        if (hasApiData) {
          this.itemWeekly.text = `\uD83C\uDF18 Codex:${state.quota!.weeklyUsed}/${state.quota!.weeklyLimit}${errorIndicator}`;
        } else {
          this.itemWeekly.text = `\uD83C\uDF18 Codex:${weeklyPct > 0 ? '~' + formatPercent(weeklyPct, 1) : '—'}${estimateIndicator}${errorIndicator}`;
        }
      } else {
        this.itemWeekly.text = `\uD83C\uDF18 Codex:${formatPercent(weeklyPct, 1)}${estimateIndicator}${errorIndicator}`;
      }

      this.itemWeekly.command = 'codexStatusPro.showDashboard';
      this.itemWeekly.color = this.utilizationToColor(weeklyUtil);
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.show();

      // Tooltip: lazy build (async)
      this.buildTooltip(state).then((tooltip) => {
        this.itemWeekly.tooltip = tooltip;
        this.itemWindow.tooltip = tooltip;
      });
    } catch (err) {
      console.error('StatusBar render error', err);
    }
  }

  private utilizationToColor(util: number): string {
    const cfg = this.config;
    if (util < 0.20) return cfg.statusBarUtilizationColorLt20;
    if (util < 0.40) return cfg.statusBarUtilizationColorLt40;
    if (util < 0.60) return cfg.statusBarUtilizationColorLt60;
    if (util < 0.80) return cfg.statusBarUtilizationColorLt80;
    return cfg.statusBarUtilizationColorGte80;
  }

  private async buildTooltip(state: AppState): Promise<vscode.MarkdownString> {
    const locale = ConfigService.resolveEffectiveLanguage(state.ui.language);
    const t = makeT(locale);
    const md = new vscode.MarkdownString();

    if (state.authStatus === 'missing') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.notLoggedIn')}\n\`\`\``);
      return md;
    }

    if (state.authStatus === 'failed') {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('tooltip.authFailed')}\n\`\`\``);
      return md;
    }

    const hasApiData = !!state.quota;
    const hasEstimate = !!state.localEstimate;

    if (!hasApiData && !hasEstimate) {
      md.appendMarkdown(`\`\`\`text\n${t('tooltip.title')}\n${'─'.repeat(29)}\n${t('dashboard.loading')}\n\`\`\``);
      return md;
    }

    const q = state.quota;
    const le = state.localEstimate;
    const weeklyPct = resolveWeeklyPct(state);
    const windowPct = resolveWindowPct(state);
    const weeklyUtil = weeklyPct / 100;
    const windowUtil = windowPct / 100;

    const weeklyBar = buildBar(weeklyUtil, 10);
    const windowBar = buildBar(windowUtil, 10);

    const weeklyReset = q && q.weeklyResetAt > Date.now()
      ? fmtHours((q.weeklyResetAt - Date.now()) / 3600000)
      : '?';
    const windowReset = q && q.windowResetAt > Date.now()
      ? fmtHours((q.windowResetAt - Date.now()) / 3600000)
      : '?';

    let sourceLabel = '';
    if (state.dataSource === 'stale') sourceLabel = ' ' + t('tooltip.stale');
    else if (state.dataSource === 'local-only') sourceLabel = t('dashboard.estimate');

    const lines: string[] = [];
    lines.push(
      t('tooltip.title') + sourceLabel,
      '─────────────────────────────',
      `${t('tooltip.window5h')}  ${formatPercentPadded(windowPct, 2)} [${windowBar}] ${t('tooltip.resetsIn')} ${windowReset}`,
      `${t('tooltip.window7d')}  ${formatPercentPadded(weeklyPct, 2)} [${weeklyBar}] ${t('tooltip.resetsIn')} ${weeklyReset}`,
    );

    // Quota table via drawBorderTable
    if (q) {
      lines.push('');
      lines.push(t('tooltip.table.quotaSummary'));
      lines.push('─────────────────────────────');
      const quotaHeader = ['', t('tooltip.table.col.used'), t('tooltip.table.col.limit'), t('tooltip.table.col.remaining')];
      const quotaRows = [
        [t('tooltip.window5h'), String(q.windowUsed), String(q.windowLimit), String(q.windowRemaining)],
        [t('tooltip.window7d'), String(q.weeklyUsed), String(q.weeklyLimit), String(q.weeklyLimit - q.weeklyUsed)],
      ];
      lines.push(...drawBorderTable(quotaHeader, quotaRows, ['l', 'r', 'r', 'r']));
      if (q.parallelLimit) {
        lines.push('', `${t('tooltip.table.col.parallel')}: ${q.parallelLimit}`);
      }
    }

    // Local usage table (from memory — store.localEstimate) via drawBorderTable
    const lu = state.localEstimate;
    if (lu && (lu.requests5h > 0 || lu.requests7d > 0 || lu.requestsThisCycle > 0)) {
      lines.push('');
      lines.push(t('tooltip.localUsage'));
      lines.push('─────────────────────────────');
      const localHeader = [
        '',
        t('tooltip.table.col.input'),
        t('tooltip.table.col.output'),
        t('tooltip.table.col.cacheCreate'),
        t('tooltip.table.col.cacheRead'),
        t('tooltip.table.col.requests'),
        t('tooltip.table.col.cost'),
      ];
      const localRows = [
        [
          t('tooltip.table.row.today'),
          fmtTokens(lu.tokensToday),
          fmtTokens(lu.tokensOutToday),
          fmtTokens(lu.tokensCacheCreateToday),
          fmtTokens(lu.tokensCacheReadToday),
          String(lu.requestsToday),
          fmtCost(lu.costToday, this.config.currency.symbol),
        ],
        [
          t('tooltip.table.row.5h'),
          fmtTokens(lu.tokensIn5h),
          fmtTokens(lu.tokensOut5h),
          fmtTokens(lu.tokensCacheCreate5h),
          fmtTokens(lu.tokensCacheRead5h),
          String(lu.requests5h),
          fmtCost(lu.cost5h, this.config.currency.symbol),
        ],
        [
          t('tooltip.table.row.7d'),
          fmtTokens(lu.tokensIn7d),
          fmtTokens(lu.tokensOut7d),
          fmtTokens(lu.tokensCacheCreate7d),
          fmtTokens(lu.tokensCacheRead7d),
          String(lu.requests7d),
          fmtCost(lu.cost7d, this.config.currency.symbol),
        ],
      ];
      lines.push(...drawBorderTable(localHeader, localRows, ['l', 'r', 'r', 'r', 'r', 'r', 'r']));
    }

    lines.push('', `${t('tooltip.lastUpdate')} ${state.lastFetchAt ? new Date(state.lastFetchAt).toLocaleString() : '—'}`);

    md.appendMarkdown(`\`\`\`text\n${lines.join('\n')}\n\`\`\``);
    return md;
  }

  private triggerUpdateAnimation(): void {
    const duration = this.config.updateAnimationDurationMs;

    // If animation already running, just reset the end timer (debounce)
    if (this.updateAnimInterval) {
      if (this.updateAnimTimeout) {
        clearTimeout(this.updateAnimTimeout);
      }
      this.updateAnimTimeout = setTimeout(() => {
        this.stopUpdateAnimation();
        this.render(this.store.getState());
      }, duration);
      return;
    }

    // Start new animation — moon cycles while keeping the live percentage visible
    this.moonFrame = 0;
    const weeklyPct = this.lastSeenWeeklyPct ?? 0;
    this.itemWeekly.text = `${MOON_FRAMES[0]} Codex:${formatPercent(weeklyPct, 1)}`;
    this.itemWeekly.show();

    this.updateAnimInterval = setInterval(() => {
      this.moonFrame = (this.moonFrame + 1) % MOON_FRAMES.length;
      const liveWeeklyPct = this.lastSeenWeeklyPct ?? 0;
      this.itemWeekly.text = `${MOON_FRAMES[this.moonFrame]} Codex:${formatPercent(liveWeeklyPct, 1)}`;
    }, this.config.updateAnimationIntervalMs);

    this.updateAnimTimeout = setTimeout(() => {
      this.stopUpdateAnimation();
      this.render(this.store.getState());
    }, duration);
  }

  private stopUpdateAnimation(): void {
    if (this.updateAnimInterval) {
      clearInterval(this.updateAnimInterval);
      this.updateAnimInterval = null;
    }
    if (this.updateAnimTimeout) {
      clearTimeout(this.updateAnimTimeout);
      this.updateAnimTimeout = null;
    }
  }

  dispose(): void {
    this.stopUpdateAnimation();
    this.itemWeekly.dispose();
    this.itemWindow.dispose();
    this.itemPause.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }
}
