// DESIGN: v2-phase2-implementation.md#presentersstatusbarts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import {
  computeUtilization, formatPercent, formatPercentPadded, formatProviderStatus, remainingQuotaColor,
  fmtHours, fmtTokens, fmtCost, fmtDateTime, fmtResetTime,
  buildMiniBar, drawBorderTable,
  resolveWeeklyPct, resolveWindowPct,
  resolveAuthDisplayMode, buildIndicatorSuffix,
} from '../calc';
import { AppState } from '../types';
import { IProvider } from '../providers/base/types';

const STALE_THRESHOLD_MS = 120_000; // 2 minutes

const UPDATE_FRAMES = ['\uD83C\uDF11', '\uD83C\uDF12', '\uD83C\uDF13', '\uD83C\uDF14', '\uD83C\uDF15', '\uD83C\uDF16', '\uD83C\uDF17', '\uD83C\uDF18'];
// MOON_ANIMATION_INTERVAL_MS is now read from config.updateAnimationIntervalMs (default 300ms)

function alignmentFromString(raw: string): vscode.StatusBarAlignment {
  return raw === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
}

export class StatusBarPresenter {
  private itemWeekly: vscode.StatusBarItem;
  private config = ConfigService.getInstance();
  private disposables: vscode.Disposable[] = [];
  private updateAnimInterval: NodeJS.Timeout | null = null;
  private updateAnimTimeout: NodeJS.Timeout | null = null;
  private updateFrame = 0;
  private lastSeenWeeklyPct: number | null = null;
  private lastSeenWindowPct: number | null = null;
  private displayName: string;
  private disposed = false;

  constructor(private store: Store, private provider?: IProvider) {
    const alignment = this.config.statusBarAlignment;
    this.displayName = provider?.ui.displayName ?? 'Codex';
    const icon = provider?.ui.mainIcon ?? '$(openai)';

    this.itemWeekly = vscode.window.createStatusBarItem(alignment, 104);
    this.itemWeekly.name = `${this.displayName}StatusPro Weekly`;
    this.itemWeekly.command = this.dashboardCommand();
    this.itemWeekly.text = `$(sync~spin) ${this.displayName}…`;
    this.itemWeekly.show();

    const unsub = store.subscribe((state) => this.render(state));
    this.disposables.push({ dispose: unsub });

    // Initial render
    this.render(store.getState());
  }

  private dashboardCommand(): vscode.Command {
    return { command: 'aiStatusHub.showDashboard', title: this.displayName, arguments: [this.provider?.id ?? this.store.getState().activeProvider] };
  }

  private render(state: AppState): void {
    if (this.disposed) return;
    try {
      const t = makeT(ConfigService.resolveEffectiveLanguage(state.ui.language));
      const icon = this.provider?.ui.mainIcon ?? '$(openai)';
      this.itemWeekly.command = this.dashboardCommand();
      this.itemWeekly.backgroundColor = undefined;
      this.itemWeekly.color = undefined;
      if (state.ui.isPaused) {
        this.stopUpdateAnimation();
        this.itemWeekly.text = icon;
      } else if (state.authStatus === 'missing') {
        this.stopUpdateAnimation();
        this.itemWeekly.text = `$(key) ${this.displayName}: ${t('statusBar.signIn')}`;
      } else if (resolveAuthDisplayMode(state) === 'blocked') {
        this.stopUpdateAnimation();
        const label = t(state.authStatus === 'expired' ? 'statusBar.authExpired' : 'statusBar.authFailed');
        this.itemWeekly.text = `$(warning) ${this.displayName}: ${label}`;
        this.itemWeekly.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
      } else if (!state.quota && !state.localEstimate) {
        this.stopUpdateAnimation();
        this.itemWeekly.text = `$(sync~spin) ${this.displayName}…`;
      } else {
        const weeklyPct = resolveWeeklyPct(state);
        const windowPct = resolveWindowPct(state);
        const first = this.lastSeenWeeklyPct === null;
        const changed = this.lastSeenWeeklyPct !== weeklyPct || this.lastSeenWindowPct !== windowPct;
        this.lastSeenWeeklyPct = weeklyPct;
        this.lastSeenWindowPct = windowPct;
        this.itemWeekly.text = formatProviderStatus(state, icon, this.displayName, this.config.displayMode);
        this.itemWeekly.color = remainingQuotaColor(100 - weeklyPct, [
          this.config.statusBarUtilizationColorLt20, this.config.statusBarUtilizationColorLt40,
          this.config.statusBarUtilizationColorLt60, this.config.statusBarUtilizationColorLt80,
          this.config.statusBarUtilizationColorGte80,
        ]);
        if (changed && !first) this.triggerUpdateAnimation();
      }
      this.itemWeekly.show();
      void this.buildTooltip(state).then(tooltip => {
        if (!this.disposed) this.itemWeekly.tooltip = tooltip;
      }).catch(err => console.error('Status bar tooltip error', err));
    } catch (err) {
      console.error('StatusBar render error', err);
    }
  }

  private createSvgBar(util: number): string {
    const width = 120;
    const height = 10;
    const safe = Math.max(0, Math.min(1, isFinite(util) ? util : 0));
    const filledWidth = Math.round(safe * width);

    const color = safe >= 0.80 ? this.config.statusBarUtilizationColorGte80
      : safe >= 0.60 ? this.config.statusBarUtilizationColorLt80
        : safe >= 0.40 ? this.config.statusBarUtilizationColorLt60
          : safe >= 0.20 ? this.config.statusBarUtilizationColorLt40
            : this.config.statusBarUtilizationColorLt20;

    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <rect width="${width}" height="${height}" fill="#3c3c3c" rx="2"/>
      <rect width="${filledWidth}" height="${height}" fill="${color}" rx="2"/>
    </svg>`;

    const encoded = Buffer.from(svg).toString('base64');
    return `<img src="data:image/svg+xml;base64,${encoded}" alt="${Math.round(safe * 100)}%" style="vertical-align:middle;"/>`;
  }

  private preTable(header: string[], rows: string[][], aligns: string[]): string {
    const mapAlign = (a?: string): 'l' | 'r' | 'm' => {
      if (a === 'r') return 'r';
      if (a === 'c') return 'm';
      return 'l';
    };
    const lines = drawBorderTable(header, rows, aligns.map(mapAlign));
    return '<pre style="margin:0;padding:4px 0;line-height:1.4;">' + lines.join('\n') + '</pre>';
  }

  private async buildTooltip(state: AppState): Promise<vscode.MarkdownString> {
    const locale = ConfigService.resolveEffectiveLanguage(state.ui.language);
    const t = makeT(locale);
    const md = new vscode.MarkdownString();
    md.supportHtml = true;
    md.isTrusted = true;
    const commandArgs = encodeURIComponent(JSON.stringify([this.provider?.id ?? state.activeProvider]));

    if (state.authStatus === 'missing') {
      md.appendMarkdown(`**${t('tooltip.title')}**\n\n${t('tooltip.notLoggedIn')}`);
      return md;
    }

    const authMode = resolveAuthDisplayMode(state);
    if (authMode === 'blocked') {
      const tip = state.authStatus === 'expired' ? t('tooltip.authExpired') : t('tooltip.authFailed');
      md.appendMarkdown(`**${t('tooltip.title')}**\n\n${tip}\n\n[$(key) ${t('tooltip.signInAction')}](command:aiStatusHub.signIn?${commandArgs})`);
      return md;
    }

    const hasApiData = !!state.quota;
    const hasEstimate = !!state.localEstimate;

    if (!hasApiData && !hasEstimate) {
      md.appendMarkdown(`**${t('tooltip.title')}**\n\n${t('dashboard.loading')}`);
      return md;
    }

    const q = state.quota;
    const weeklyPct = resolveWeeklyPct(state);
    const windowPct = resolveWindowPct(state);
    const weeklyUtil = weeklyPct / 100;
    const windowUtil = windowPct / 100;

    const weeklyResetText = fmtResetTime(q?.weeklyResetAt, 7 * 24 * 3600 * 1000);
    const windowResetText = fmtResetTime(q?.windowResetAt, 5 * 3600 * 1000);

    let sourceLabel = '';
    if (state.dataSource === 'stale') { sourceLabel = '&nbsp;*' + t('tooltip.stale') + '*'; }
    else if (state.dataSource === 'local-only') { sourceLabel = '&nbsp;*' + t('dashboard.estimate') + '*'; }

    const parts: string[] = [];
    if (authMode === 'degraded') {
      parts.push(`> \uD83D\uDD10 ${t('tooltip.authDegraded')} [${t('tooltip.signInAction')}](command:aiStatusHub.signIn?${commandArgs})`);
      parts.push('');
    }
    parts.push(`### ${this.provider?.ui.mainIcon ?? ''} ${t('tooltip.title')}${sourceLabel}`);
    parts.push('');

    // Progress bars as HTML block (layout only)
    parts.push(`<table style="border-collapse:collapse;width:100%;font-size:12px;">`);
    if (q?.has5hLimit !== false) {
      parts.push(`<tr><td style="padding:2px 6px;width:80px;"><strong>${t('tooltip.window5h')}</strong></td><td style="padding:2px 6px;">${this.createSvgBar(windowUtil)}</td><td style="padding:2px 6px;text-align:right;white-space:nowrap;"><strong>${formatPercent(windowPct, 2)}</strong></td></tr>`);
      parts.push(`<tr><td style="padding:2px 6px;color:var(--vscode-descriptionForeground);">${t('tooltip.nextReset')}</td><td colspan="2" style="padding:2px 6px;color:var(--vscode-descriptionForeground);">${windowResetText}</td></tr>`);
    }
    parts.push(`<tr><td style="padding:2px 6px;"><strong>${t('tooltip.window7d')}</strong></td><td style="padding:2px 6px;">${this.createSvgBar(weeklyUtil)}</td><td style="padding:2px 6px;text-align:right;white-space:nowrap;"><strong>${formatPercent(weeklyPct, 2)}</strong></td></tr>`);
    parts.push(`<tr><td style="padding:2px 6px;color:var(--vscode-descriptionForeground);">${t('tooltip.nextReset')}</td><td colspan="2" style="padding:2px 6px;color:var(--vscode-descriptionForeground);">${weeklyResetText}</td></tr>`);
    parts.push(`</table>`);
    parts.push('');

    // Quota Summary — Markdown table
    if (q) {
      parts.push(`**${t('tooltip.table.quotaSummary')}**`);
      parts.push('');
      parts.push(this.preTable(
        ['', t('tooltip.table.col.used'), t('tooltip.table.col.limit'), t('tooltip.table.col.remaining')],
        [
          ...(q.has5hLimit === false ? [] : [[t('tooltip.window5h'), String(q.windowUsed), String(q.windowLimit), String(q.windowRemaining)]]),
          [t('tooltip.window7d'), String(q.weeklyUsed), String(q.weeklyLimit), String(q.weeklyLimit - q.weeklyUsed)],
        ],
        ['l', 'r', 'r', 'r']
      ));
      if (q.parallelLimit) {
        parts.push('');
        parts.push(`${t('tooltip.table.col.parallel')}: **${q.parallelLimit}**`);
      }
      parts.push('');
    }

    // Local Usage — Markdown table (trimmed to 4 columns for tooltip width)
    const lu = state.localEstimate;
    if (lu && (lu.requests5h > 0 || lu.requests7d > 0 || lu.requestsThisCycle > 0)) {
      parts.push(`**${t('tooltip.localUsage')}**`);
      parts.push('');
      parts.push(this.preTable(
        ['', t('tooltip.table.col.input'), t('tooltip.table.col.output'), t('tooltip.table.col.cacheRead'), t('tooltip.table.col.cacheCreate'), t('tooltip.table.col.cost')],
        [
          [t('tooltip.table.row.today'), fmtTokens(lu.tokensToday), fmtTokens(lu.tokensOutToday), fmtTokens(lu.tokensCacheReadToday), fmtTokens(lu.tokensCacheCreateToday), fmtCost(lu.costToday, this.config.currencyForProvider(this.provider?.id ?? state.activeProvider).symbol)],
          ...(q?.has5hLimit === false ? [] : [[t('tooltip.table.row.5h'), fmtTokens(lu.tokensIn5h), fmtTokens(lu.tokensOut5h), fmtTokens(lu.tokensCacheRead5h), fmtTokens(lu.tokensCacheCreate5h), fmtCost(lu.cost5h, this.config.currencyForProvider(this.provider?.id ?? state.activeProvider).symbol)]]),
          [t('tooltip.table.row.7d'), fmtTokens(lu.tokensIn7d), fmtTokens(lu.tokensOut7d), fmtTokens(lu.tokensCacheRead7d), fmtTokens(lu.tokensCacheCreate7d), fmtCost(lu.cost7d, this.config.currencyForProvider(this.provider?.id ?? state.activeProvider).symbol)],
        ],
        ['l', 'r', 'r', 'r', 'r', 'r']
      ));
      parts.push('');
    }

    parts.push('---');
    parts.push('');
    const ext = vscode.extensions?.getExtension('kayuii.ai-status-hub');
    const version = ext?.packageJSON?.version ?? '0.0.0';
    const lastUpdateText = `${t('tooltip.lastUpdate')} ${state.lastFetchAt ? fmtDateTime(state.lastFetchAt) : '—'} · v${version}`;
    parts.push(`<span style="color:var(--vscode-descriptionForeground);font-size:11px;">${lastUpdateText}</span>`);
    parts.push('');
    parts.push('<div align="center">');
    parts.push('');
    const pauseLabel = state.ui.isPaused ? t('tooltip.resume') : t('tooltip.pause');
    const pauseIcon = state.ui.isPaused ? '▶️' : '⏸️';
    parts.push(`<a href="command:aiStatusHub.refresh?${commandArgs}">🔄 ${t('tooltip.refresh')}</a> · <a href="command:aiStatusHub.showDashboard?${commandArgs}">📊 ${t('tooltip.showDetails')}</a> · <a href="command:aiStatusHub.openSettings">⚙️ ${t('tooltip.settings')}</a> · <a href="command:aiStatusHub.togglePause">${pauseIcon} ${pauseLabel}</a>`);
    parts.push('');
    parts.push('</div>');

    md.appendMarkdown(parts.join('\n'));
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
    this.updateFrame = 0;
    this.itemWeekly.text = formatProviderStatus(this.store.getState(), UPDATE_FRAMES[0], this.displayName, this.config.displayMode);
    this.itemWeekly.show();

    this.updateAnimInterval = setInterval(() => {
      this.updateFrame = (this.updateFrame + 1) % UPDATE_FRAMES.length;
      this.itemWeekly.text = formatProviderStatus(this.store.getState(), UPDATE_FRAMES[this.updateFrame], this.displayName, this.config.displayMode);
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
    if (this.disposed) return;
    this.disposed = true;
    this.stopUpdateAnimation();
    this.itemWeekly.dispose();

    for (const d of this.disposables) { d.dispose(); }
  }
}
