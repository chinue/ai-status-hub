// DESIGN: v2-dashboard-design.md
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Store } from '../store';
import { ConfigService } from '../config';
import { makeT } from '../i18n';
import { formatPercent, fmtCurrency, fmtNumber, resolveWeeklyPct, resolveWindowPct, fmtResetTime, resolveResetTime, estimateStateMemory, formatMemorySize } from '../calc';
import { HistoryService } from '../services/historyService';
import {
  AppState, UsageEntry, DashboardMessage, KimiUsageData, DashboardAggregates,
  HeatmapData, CostCurveOptions, TokenPricing,
} from '../types';
import { listProviders, getProviderInfo } from '../providers/registry';

export class DashboardPanel {
  private static instance: DashboardPanel | undefined;
  private panel: vscode.WebviewPanel;
  private disposables: vscode.Disposable[] = [];
  private nonce: string;
  private historyService = HistoryService.getInstance();
  private currencySymbol: string;

  private lastProvider: string;

  private constructor(private store: Store) {
    this.nonce = crypto.randomBytes(16).toString('hex');
    const config = ConfigService.getInstance();
    this.currencySymbol = config.currency.symbol;
    const locale = config.effectiveLanguage;
    const i18n = makeT(locale);
    this.lastProvider = store.getState().activeProvider;

    this.panel = vscode.window.createWebviewPanel(
      'codexStatusProDashboard',
      i18n('dashboard.title'),
      vscode.ViewColumn.Beside,
      { enableScripts: true, retainContextWhenHidden: true }
    );

    this.panel.webview.html = this.getHtml(this.nonce, locale);

    this.panel.webview.onDidReceiveMessage(
      (msg) => this.handleMessage(msg),
      undefined,
      this.disposables
    );

    const unsub = store.subscribe((state) => {
      if (state.activeProvider !== this.lastProvider) {
        this.lastProvider = state.activeProvider;
        const currentLocale = config.effectiveLanguage;
        this.panel.webview.html = this.getHtml(this.nonce, currentLocale);
      }
      this.sendUpdate(state);
    });
    this.disposables.push({ dispose: unsub });

    this.panel.onDidDispose(() => this.dispose(), undefined, this.disposables);
  }

  static createOrShow(store: Store): void {
    if (DashboardPanel.instance) {
      DashboardPanel.instance.panel.reveal(vscode.ViewColumn.Beside);
      return;
    }
    DashboardPanel.instance = new DashboardPanel(store);
  }

  private handleMessage(msg: any): void {
    switch (msg.type) {
      case 'ready':
        this.sendUpdate(this.store.getState());
        break;
      case 'refresh':
        vscode.commands.executeCommand('codexStatusPro.refresh');
        break;
      case 'toggleMode': {
        const next = ConfigService.getInstance().displayMode === 'percent' ? 'absolute' : 'percent';
        void ConfigService.getInstance().setDisplayMode(next);
        break;
      }
      case 'toggleLanguage': {
        void this.doToggleLanguage();
        break;
      }
      case 'openSettings':
        void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.codex-status-pro');
        break;
      case 'setProvider': {
        const cfg = ConfigService.getInstance();
        void cfg.setProvider(msg.payload as string);
        break;
      }
      case 'getCostCurveOptions': {
        this.sendCostCurveOptions();
        break;
      }
      case 'getCostCurve': {
        const { window, startMs, endMs } = msg;
        if (!window || typeof startMs !== 'number' || typeof endMs !== 'number') break;
        this.sendCostCurve(window, startMs, endMs);
        break;
      }
      case 'getHourlyData': {
        const { date } = msg;
        if (!date) break;
        this.sendHourlyData(date);
        break;
      }
      case 'getDailyData': {
        const { month } = msg;
        if (!month) break;
        this.sendDailyData(month);
        break;
      }
      case 'setBudget': {
        const amount = msg.amount;
        if (amount === null || typeof amount === 'number') {
          void ConfigService.getInstance().setWeeklyBudget(typeof amount === 'number' ? amount : null)
            .then(() => vscode.commands.executeCommand('codexStatusPro.refresh'));
        }
        break;
      }
    }
  }

  private async doToggleLanguage(): Promise<void> {
    const cfg = ConfigService.getInstance();
    const currentRaw = this.store.getState().ui.language;
    let nextLang: 'en' | 'zh-CN';
    if (currentRaw === 'auto') {
      nextLang = cfg.effectiveLanguage === 'zh-CN' ? 'en' : 'zh-CN';
    } else {
      nextLang = currentRaw === 'zh-CN' ? 'en' : 'zh-CN';
    }
    try {
      await cfg.setLanguage(nextLang);
    } catch {
      // ignore
    }
    this.store.dispatch({ type: 'UI_SET_LANGUAGE', payload: nextLang });
    this.panel.webview.html = this.getHtml(this.nonce, nextLang);
  }

  private sendUpdate(state: AppState): void {
    if (!this.panel.visible) return;
    const data = this.buildDashboardMessage(state);
    this.panel.webview.postMessage({ type: 'update', data });
  }

  private buildDashboardMessage(state: AppState): DashboardMessage {
    const config = ConfigService.getInstance();
    const entries = state.usageEntries ?? [];
    const now = Date.now();
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const monthStart = new Date(now).setDate(1);
    monthStart; // used below

    let dashboard: DashboardAggregates | null = null;
    let heatmap: HeatmapData | null = null;
    let costCurveOptions: CostCurveOptions | null = null;

    try {
      if (entries.length > 0) {
        const quota = state.quota;
        const effectiveWindowReset = resolveResetTime(quota?.windowResetAt, 5 * 3600 * 1000, now).resetAt;
        const effectiveWeeklyReset = resolveResetTime(quota?.weeklyResetAt, 7 * 24 * 3600 * 1000, now).resetAt;
        const window5hStart = effectiveWindowReset - 5 * 3600 * 1000;
        const window7dStart = effectiveWeeklyReset - 7 * 24 * 3600 * 1000;
        dashboard = this.historyService.buildDashboardAggregates(entries, {
          todayStartMs: todayStart,
          window5hStartMs: window5hStart,
          window7dStartMs: window7dStart,
          window30dStartMs: now - 30 * 24 * 3600 * 1000,
          monthStartMs: new Date(now).setDate(1),
          defaultModelName: config.defaultModelName,
        });
        heatmap = this.historyService.buildHeatmapData(entries, {
          window5hStartMs: window5hStart,
          window7dStartMs: window7dStart,
          defaultModelName: config.defaultModelName,
        });
        costCurveOptions = this.historyService.buildCostCurveOptions(entries, {
          window5hStartMs: window5hStart,
          window7dStartMs: window7dStart,
        });
      }
    } catch (err) {
      console.error('Dashboard aggregation error', err);
    }

    const usage = this.buildKimiUsageData(state);

    return {
      usage,
      dashboard,
      heatmap,
      costCurveOptions,
      pricing: ConfigService.getInstance().getPricing(config.defaultModelName),
      modelPricing: {},
      settings: {
        provider: usage.providerType,
        apiEnabled: true,
        cacheTtlSeconds: config.refreshIntervalSeconds,
        weeklyBudget: config.weeklyBudget,
        chartHeightRatio: config.chartHeightRatio,
        officialUrl: config.pricingOfficialUrl,
        officialDate: config.pricingOfficialDate,
        currencySymbol: config.currency.symbol,
      },
      isLoading: state.isLoading,
    };
  }

  private buildKimiUsageData(state: AppState): KimiUsageData {
    const le = state.localEstimate;
    const quota = state.quota;
    const now = Date.now();
    const cacheAge = state.lastFetchAt ? Math.max(0, Math.floor((now - state.lastFetchAt) / 1000)) : 0;

    // Use the same resolution logic as statusBar/tooltip for consistency
    const weeklyPct = resolveWeeklyPct(state);
    const windowPct = resolveWindowPct(state);
    const effectiveWindowReset = resolveResetTime(quota?.windowResetAt, 5 * 3600 * 1000, now).resetAt;
    const effectiveWeeklyReset = resolveResetTime(quota?.weeklyResetAt, 7 * 24 * 3600 * 1000, now).resetAt;

    const mem = estimateStateMemory(state);

    return {
      utilization5h: windowPct / 100,
      utilization7d: weeklyPct / 100,
      resetIn5h: quota ? Math.max(0, Math.floor((effectiveWindowReset - now) / 1000)) : 0,
      resetIn7d: quota ? Math.max(0, Math.floor((effectiveWeeklyReset - now) / 1000)) : 0,
      resetIn5hText: fmtResetTime(quota?.windowResetAt, 5 * 3600 * 1000, now),
      resetIn7dText: fmtResetTime(quota?.weeklyResetAt, 7 * 24 * 3600 * 1000, now),
      limitStatus: 'allowed',
      has7dLimit: !!quota,
      providerType: 'openai',
      cost5h: le?.cost5h ?? 0,
      costDay: le?.costToday ?? 0,
      cost7d: le?.cost7d ?? 0,
      tokensIn5h: le?.tokensIn5h ?? 0,
      tokensOut5h: le?.tokensOut5h ?? 0,
      tokensCacheRead5h: le?.tokensCacheRead5h ?? 0,
      tokensCacheCreate5h: le?.tokensCacheCreate5h ?? 0,
      tokensInDay: le?.tokensToday ?? 0,
      tokensOutDay: 0,
      tokensCacheReadDay: 0,
      tokensCacheCreateDay: 0,
      tokensIn7d: le?.tokensIn7d ?? 0,
      tokensOut7d: le?.tokensOut7d ?? 0,
      tokensCacheRead7d: le?.tokensCacheRead7d ?? 0,
      tokensCacheCreate7d: le?.tokensCacheCreate7d ?? 0,
      used5h: quota?.windowUsed ?? le?.tokensIn5h ?? 0,
      limit5h: quota?.windowLimit ?? 0,
      used7d: quota?.weeklyUsed ?? le?.tokensIn7d ?? 0,
      limit7d: quota?.weeklyLimit ?? 0,
      lastUpdated: state.lastFetchAt ?? now,
      cacheAge,
      dataSource: state.dataSource,
      memoryBreakdown: mem.items,
      memoryTotalBytes: mem.totalBytes,
    };
  }

  private sendCostCurveOptions(): void {
    const entries = this.store.getState().usageEntries ?? [];
    if (entries.length === 0) return;
    try {
      const opts = this.historyService.buildCostCurveOptions(entries);
      this.panel.webview.postMessage({ type: 'costCurveOptions', data: opts });
    } catch (err) {
      console.error('costCurveOptions error', err);
    }
  }

  private sendCostCurve(window: '5h' | '7d', startMs: number, endMs: number): void {
    const entries = this.store.getState().usageEntries ?? [];
    try {
      const points = this.historyService.buildCostCurve(entries, window, startMs, endMs);
      this.panel.webview.postMessage({ type: 'costCurve', window, startMs, endMs, points });
    } catch (err) {
      console.error('costCurve error', err);
    }
  }

  private sendHourlyData(date: string): void {
    const entries = this.store.getState().usageEntries ?? [];
    try {
      const data = this.historyService.aggregateHourlyForDate(entries, date);
      this.panel.webview.postMessage({ type: 'hourlyDataResponse', date, data: data ?? [] });
    } catch (err) {
      console.error('hourlyData error', err);
    }
  }

  private sendDailyData(month: string): void {
    const entries = this.store.getState().usageEntries ?? [];
    try {
      const data = this.historyService.aggregateDailyForMonth(entries, month);
      this.panel.webview.postMessage({ type: 'dailyDataResponse', month, data: data ?? [] });
    } catch (err) {
      console.error('dailyData error', err);
    }
  }

  private dispose(): void {
    DashboardPanel.instance = undefined;
    this.panel.dispose();
    for (const d of this.disposables) { d.dispose(); }
  }

  private getHtml(nonce: string, locale: string): string {
    const config = ConfigService.getInstance();
    const isZh = locale === 'zh-CN';
    const i18n = makeT(locale as any);
    const activeProvider = this.store.getState().activeProvider;
    const providers = listProviders();
    const providerOptions = providers.map((p) => {
      const label = isZh ? p.displayNameZh : p.displayName;
      const selected = p.id === activeProvider ? ' selected' : '';
      return `<option value="${p.id}"${selected}>${label}</option>`;
    }).join('');
    const activeInfo = getProviderInfo(activeProvider);
    const activeName = activeInfo ? (isZh ? activeInfo.displayNameZh : activeInfo.displayName) : activeProvider;
    return `<!DOCTYPE html>
<html lang="${isZh ? 'zh-CN' : 'en'}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}' https://cdn.jsdelivr.net; style-src 'unsafe-inline'; img-src data:; connect-src 'none';">
  <title>${activeName} ${i18n('dashboard.title')}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body {
      background: var(--vscode-editor-background);
      color: var(--vscode-editor-foreground);
      font-family: var(--vscode-editor-font-family, monospace);
      font-size: var(--vscode-font-size);
      padding: 16px; margin: 0;
    }
    button, input, select { font-family: inherit; }
    .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; }
    .header h1 { margin: 0; font-size: 1.2em; font-weight: 600; }
    .header-actions { display: flex; gap: 8px; }
    button {
      background: var(--vscode-button-background); color: var(--vscode-button-foreground);
      border: none; padding: 4px 12px; cursor: pointer; border-radius: 2px; font-size: 0.9em;
    }
    button:hover { background: var(--vscode-button-hoverBackground); }
    button:disabled { opacity: 0.5; cursor: not-allowed; }
    .card {
      background: var(--vscode-sideBar-background); border: 1px solid var(--vscode-panel-border);
      border-radius: 4px; padding: 12px 16px; margin-bottom: 12px;
    }
    .card-title { font-size: 0.75em; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em; color: var(--vscode-descriptionForeground); margin: 0 0 10px 0; }
    .card-title-row { display: flex; justify-content: space-between; align-items: center; margin: 0 0 10px 0; }
    .card-title-row .card-title { margin: 0; }
    .progress-row { margin-bottom: 10px; }
    .progress-labels { display: flex; justify-content: space-between; margin-bottom: 4px; font-size: 0.9em; }
    .progress-meta-row { display: flex; gap: 16px; color: var(--vscode-descriptionForeground); font-size: 0.85em; margin-top: 2px; }
    .progress-track { height: 8px; background: var(--vscode-scrollbarSlider-background); border-radius: 4px; overflow: hidden; }
    .progress-fill { height: 100%; border-radius: 4px; background: var(--vscode-progressBar-background); transition: width 0.3s ease; }
    .progress-fill.warning { background: var(--vscode-editorWarning-foreground); }
    .progress-fill.error { background: var(--vscode-editorError-foreground); }
    .footer { color: var(--vscode-descriptionForeground); font-size: 0.8em; margin-top: 8px; }
    .placeholder { color: var(--vscode-descriptionForeground); font-style: italic; font-size: 0.9em; }
    .estimate-badge { font-size: 0.75em; color: var(--vscode-descriptionForeground); margin-left: 4px; }
    @keyframes spin { to { transform: rotate(360deg); } }
    .spinning { display: inline-block; animation: spin 1s linear infinite; }

    .detail-toggle {
      background: none; border: none; color: var(--vscode-textLink-foreground);
      cursor: pointer; padding: 0; font-size: 0.8em; text-decoration: none;
    }
    .detail-toggle:hover { opacity: 0.8; }

    .ccu-tabs {
      display: flex; gap: 6px; margin: 4px 0 12px 0;
      border-bottom: 1px solid var(--vscode-panel-border);
      padding-bottom: 8px; flex-wrap: wrap;
    }
    .ccu-tab {
      background: transparent; color: var(--vscode-foreground);
      border: 1px solid var(--vscode-panel-border);
      padding: 4px 10px; border-radius: 999px; font-size: 0.85em;
    }
    .ccu-tab.active {
      background: var(--vscode-button-secondaryBackground);
      color: var(--vscode-button-secondaryForeground);
    }

    .summary-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px; margin-bottom: 12px;
    }
    .summary-item {
      text-align: center; padding: 10px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 8px;
    }
    .summary-item .label { font-size: 0.8em; color: var(--vscode-descriptionForeground); margin-bottom: 6px; }
    .summary-item .value { font-size: 1.1em; font-weight: 700; }

    .section-title { margin: 14px 0 8px 0; font-size: 0.9em; font-weight: 700; }
    .model-list { display: flex; flex-direction: column; gap: 10px; }
    .model-item {
      padding: 10px;
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border);
      border-radius: 6px;
    }
    .model-header { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
    .model-name { font-weight: 700; }
    .model-cost { font-weight: 700; }
    .model-metrics {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
      gap: 8px 12px; font-size: 0.85em;
    }
    .model-metric { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .model-metric-val { color: var(--vscode-editor-foreground); }
    .model-metric-rate { color: var(--vscode-descriptionForeground); font-size: 0.92em; font-family: var(--vscode-editor-font-family, monospace); }

    .ccu-table {
      width: 100%; border-collapse: collapse; font-size: 0.9em;
      table-layout: fixed;
    }
    .ccu-table th, .ccu-table td {
      padding: 6px 8px; border: 1px solid var(--vscode-panel-border); vertical-align: middle;
    }
    .ccu-table th {
      position: sticky; top: 0;
      background: var(--vscode-sideBar-background); font-weight: 600;
    }
    .ccu-table th:first-child { text-align: left; }
    .ccu-table th:not(:first-child) { text-align: right; }
    .ccu-table td:first-child { text-align: left; }
    .ccu-table td:not(:first-child) { text-align: right; }
    .ccu-row { cursor: pointer; }
    .ccu-row:hover { background: var(--vscode-list-hoverBackground); }
    .ccu-key { white-space: nowrap; font-weight: 700; text-align: left; }
    .ccu-cost, .ccu-num { text-align: right; font-family: var(--vscode-editor-font-family, monospace); }

    .settings-row {
      display: flex; gap: 6px; flex-wrap: wrap;
      margin-top: 8px; font-size: 0.85em; align-items: center;
    }
    .settings-badge {
      background: var(--vscode-badge-background); color: var(--vscode-badge-foreground);
      padding: 1px 7px; border-radius: 10px; font-size: 0.85em;
    }
    .settings-badge.ok { background: #0e4429; color: #39d353; }
    .settings-badge.warn { background: var(--vscode-inputValidation-warningBackground); color: var(--vscode-editorWarning-foreground); }

    .budget-configure {
      margin-top: 10px; display: flex;
      align-items: center; gap: 6px; flex-wrap: wrap;
      font-size: 0.9em;
    }
    .budget-configure input {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border);
      padding: 3px 6px; border-radius: 2px; width: 80px; font-size: 0.9em;
    }
    .budget-configure label { color: var(--vscode-descriptionForeground); }
    .configure-link {
      background: none; border: none; color: var(--vscode-textLink-foreground);
      cursor: pointer; padding: 0; font-size: 0.85em; text-decoration: underline;
    }
    .configure-link:hover { opacity: 0.8; }

    /* Heatmap */
    .heatmap-container { overflow-x: auto; padding-bottom: 4px; }
    .hm-header { display: flex; gap: 2px; margin-bottom: 2px; }
    .hm-col-label {
      width: 12px; flex-shrink: 0;
      font-size: 0.6em; color: var(--vscode-descriptionForeground);
      text-align: center; overflow: hidden;
    }
    .heatmap-grid {
      display: grid;
      grid-template-rows: repeat(7, 12px);
      grid-auto-flow: column;
      grid-auto-columns: 12px;
      gap: 2px;
    }
    .hm-cell {
      width: 12px; height: 12px; border-radius: 2px; cursor: default;
    }
    .hm-cell.l-empty,
    .hm-cell.l0 { background: var(--vscode-editor-background); border: 1px solid var(--vscode-panel-border); }
    .heatmap-legend {
      display: flex; align-items: center; gap: 3px;
      font-size: 0.8em; margin-top: 6px;
      color: var(--vscode-descriptionForeground);
    }
    .heatmap-legend .hm-cell { display: inline-block; flex-shrink: 0; }
    .heatmap-section-title {
      font-size: 0.9em; font-weight: 600;
      margin-top: 14px; margin-bottom: 4px;
    }
    .heatmap-section-title:first-of-type { margin-top: 0; }
    .heatmap-scale {
      font-size: 0.75em; color: var(--vscode-descriptionForeground);
      margin: 4px 0 6px;
    }
    .heatmap-hint {
      font-size: 0.72em; color: var(--vscode-descriptionForeground);
      margin-bottom: 4px;
    }
    .heatmap-pair {
      display: flex; flex-wrap: wrap; gap: 28px;
      align-items: flex-start; margin-bottom: 8px;
    }
    .heatmap-block {
      flex: 1 1 320px; min-width: min(100%, 280px);
    }
    .heatmap-block .heatmap-section-title { margin-top: 0; }
    .hourly-title {
      font-size: 0.8em; color: var(--vscode-descriptionForeground);
      margin: 12px 0 4px;
    }

    .curve-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 6px; }
    .curve-title { font-size: 0.85em; font-weight: 600; }
    .curve-controls { display: flex; align-items: center; gap: 8px; }
    .curve-label { font-size: 0.75em; color: var(--vscode-descriptionForeground); }
    .ccu-select {
      background: var(--vscode-input-background); color: var(--vscode-input-foreground);
      border: 1px solid var(--vscode-input-border); border-radius: 4px; padding: 2px 6px;
    }
  </style>
</head>
<body>
  <div class="header">
    <h1>${i18n('dashboard.title')}</h1>
    <div class="header-actions">
      <select id="provider-select" style="margin-right:8px;padding:4px 8px;border-radius:4px;border:1px solid var(--border);background:var(--bg-tertiary);color:var(--fg);font-size:12px;cursor:pointer;">
        ${providerOptions}
      </select>
      <button id="btn-refresh">${i18n('dashboard.refresh')}</button>
      <button id="btn-toggle">$ / %</button>
      <button id="btn-lang">&#127760; ${isZh ? 'EN' : '\u4e2d'}</button>
      <button id="btn-settings">&#9881;</button>
    </div>
  </div>

  <!-- Current Usage -->
  <div class="card">
    <div class="card-title">${i18n('dashboard.currentUsage')}</div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>${i18n('dashboard.window5h')}<span id="badge-5h" class="estimate-badge"></span></span>
        <span id="lbl-5h">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-5h" style="width:0%"></div></div>
      <div class="progress-meta-row">
        <span class="progress-meta" id="meta-5h"></span>
        <span class="progress-cost" id="cost-5h"></span>
      </div>
    </div>
    <div class="progress-row">
      <div class="progress-labels">
        <span>${i18n('dashboard.window7d')}<span id="badge-7d" class="estimate-badge"></span></span>
        <span id="lbl-7d">—</span>
      </div>
      <div class="progress-track"><div class="progress-fill" id="fill-7d" style="width:0%"></div></div>
      <div class="progress-meta-row">
        <span class="progress-meta" id="meta-7d"></span>
        <span class="progress-cost" id="cost-7d"></span>
      </div>
    </div>
    <div class="memory-section" style="margin-top:10px;">
      <button class="detail-toggle" id="memory-toggle" style="font-size:0.85em;">🧠 内存占用</button>
      <div id="memory-body" style="display:none;margin-top:8px;">
        <table class="ccu-table" id="memory-table">
          <thead><tr><th>模块</th><th>内存大小</th><th>说明</th></tr></thead>
          <tbody id="memory-tbody"></tbody>
        </table>
        <div style="margin-top:6px;font-size:0.85em;color:var(--vscode-descriptionForeground);text-align:right;">
          总计: <span id="memory-total">—</span>
        </div>
      </div>
    </div>
  </div>

  <!-- Cost Curve -->
  <div class="card">
    <div class="card-title-row">
      <div class="card-title">${i18n('dashboard.costCurve')}</div>
      <button class="detail-toggle" id="costcurve-toggle">${i18n('dashboard.hide')}</button>
    </div>
    <div id="costcurve-body">
      <div class="placeholder">${i18n('dashboard.calculating')}</div>
    </div>
  </div>

  <!-- Pricing & Settings -->
  <div class="card">
    <div class="card-title-row">
      <div class="card-title">${i18n('dashboard.pricingSettings')}</div>
      <button class="detail-toggle" id="pricing-toggle">${i18n('dashboard.hide')}</button>
    </div>
    <div id="pricing-content"></div>
  </div>

  <!-- Detailed Usage -->
  <div class="card">
    <div class="card-title-row">
      <div class="card-title">${i18n('dashboard.detailedUsage')}</div>
      <button class="detail-toggle" id="details-toggle">${i18n('dashboard.hide')}</button>
    </div>
    <div id="details-body">
      <div class="ccu-tabs" id="ccu-tabs">
        <button class="ccu-tab active" data-tab="w5h">${i18n('dashboard.window5h')}</button>
        <button class="ccu-tab" data-tab="w7d">${i18n('dashboard.window7d')}</button>
        <button class="ccu-tab" data-tab="w30d">${i18n('dashboard.window30d')}</button>
        <button class="ccu-tab" data-tab="today">${i18n('dashboard.today')}</button>
        <button class="ccu-tab" data-tab="month">${i18n('dashboard.thisMonth')}</button>
        <button class="ccu-tab" data-tab="all">${i18n('dashboard.allTime')}</button>
      </div>
      <div id="ccu-content">
        <div class="placeholder">${i18n('dashboard.calculating')}</div>
      </div>
    </div>
  </div>

  <!-- Usage History -->
  <div class="card">
    <div class="card-title-row">
      <div class="card-title">${i18n('dashboard.usageHistory')} (<span id="heatmap-days">—</span> ${i18n('dashboard.days')})</div>
      <button class="detail-toggle" id="history-toggle">${i18n('dashboard.hide')}</button>
    </div>
    <div id="history-body">
      <div class="ccu-tabs" id="history-tabs" style="margin-top:8px">
        <button class="ccu-tab active" data-range="5h">${i18n('dashboard.window5h')}</button>
        <button class="ccu-tab" data-range="7d">${i18n('dashboard.window7d')}</button>
        <button class="ccu-tab" data-range="30dwin">${i18n('dashboard.window30d')}</button>
        <button class="ccu-tab" data-range="30d">${i18n('dashboard.days30Daily')}</button>
      </div>
      <div id="heatmap-content">
        <div class="placeholder">${i18n('dashboard.loadingHistory')}</div>
      </div>
    </div>
  </div>

  <div class="footer" id="footer">—</div>

  <script nonce="${nonce}" src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>
  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();

    const CURRENCY_SYMBOL = '${config.currency.symbol}';

    const labels = {
      loading: '${i18n('dashboard.loading')}',
      estimate: '${i18n('dashboard.estimate')}',
      justNow: '${i18n('dashboard.justNow')}',
      minutesAgo: '${i18n('dashboard.minutesAgo')}',
      lastUpdated: '${i18n('dashboard.lastUpdated')}',
      localEstimate: '${i18n('dashboard.localEstimate')}',
      cost: '${i18n('dashboard.cost')}',
      secondsAgo: '${i18n('dashboard.secondsAgo')}',
      refreshing: '${i18n('dashboard.refreshing')}',
    };

    let lastFetchAt = 0;
    let currentIsLoading = false;
    let currentDisplayMode = 'percent';
    let lastData = null;
    let refreshing = false;
    let pricingOpen = true;
    let detailsOpen = true;
    let historyOpen = true;
    let costCurveOpen = true;
    let memoryOpen = false;
    let chartHeightRatio = 0.4;
    let ccuTab = 'w5h';
    let historyRange = '5h';
    let historyViewMode = 'detail';
    let ccuExpandedDay = null;
    let ccuExpandedMonth = null;
    const ccuHourlyCache = new Map();
    const ccuDailyCache = new Map();

    function esc(str) {
      return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    function fmtNum(n) { return (isFinite(n) ? Math.round(n) : 0).toLocaleString('en-US'); }
    function fmtCurrency(n) { return CURRENCY_SYMBOL + (isFinite(n) ? n.toFixed(2) : '0.00'); }
    function fmtDateShort(iso) { const d = new Date(iso); return (d.getMonth()+1) + '.' + d.getDate(); }
    function heatmapColdWarmColor(t) {
      t = Math.max(0, Math.min(1, t));
      const c0 = [13, 71, 161];
      const c1 = [191, 54, 12];
      const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
      const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
      const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
      return 'rgb(' + r + ',' + g + ',' + b + ')';
    }

    function updateRefreshButton() {
      const btn = document.getElementById('btn-refresh');
      if (currentIsLoading) {
        const newText = '\u21bb ' + labels.refreshing;
        if (btn.textContent !== newText) btn.textContent = newText;
        btn.disabled = true;
        return;
      }
      btn.disabled = false;
      if (lastFetchAt === 0) {
        const newText = '${i18n('dashboard.refresh')}';
        if (btn.textContent !== newText) btn.textContent = newText;
        return;
      }
      const ageSec = Math.max(0, Math.floor((Date.now() - lastFetchAt) / 1000));
      const newText = '\u21bb ' + labels.secondsAgo.replace('{0}', ageSec);
      if (btn.textContent !== newText) btn.textContent = newText;
    }
    setInterval(updateRefreshButton, 1000);

    function fmtDuration(totalSeconds) {
      if (totalSeconds <= 0) return ' 0s';
      const days = Math.floor(totalSeconds / 86400);
      const hours = Math.floor((totalSeconds % 86400) / 3600);
      const mins = Math.floor((totalSeconds % 3600) / 60);
      const secs = totalSeconds % 60;
      const padSpace = (n) => String(n).padStart(2, ' ');
      const padZero = (n) => String(n).padStart(2, '0');
      if (days > 0) return padSpace(days) + 'd' + padZero(hours) + 'h';
      if (hours > 0) return padSpace(hours) + 'h' + padZero(mins) + 'm';
      if (mins > 0) return padSpace(mins) + 'm' + padZero(secs) + 's';
      return padSpace(secs) + 's';
    }

    function fmtReset(ms) {
      if (!ms || ms <= Date.now()) return '';
      const totalSeconds = Math.max(0, Math.floor((ms - Date.now()) / 1000));
      return 'resets in ' + fmtDuration(totalSeconds);
    }

    document.getElementById('btn-refresh').addEventListener('click', () => {
      vscode.postMessage({ type: 'refresh' });
    });
    document.getElementById('btn-toggle').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleMode' });
    });
    document.getElementById('btn-lang').addEventListener('click', () => {
      vscode.postMessage({ type: 'toggleLanguage' });
    });
    document.getElementById('btn-settings').addEventListener('click', () => {
      vscode.postMessage({ type: 'openSettings' });
    });
    document.getElementById('provider-select').addEventListener('change', (e) => {
      vscode.postMessage({ type: 'setProvider', payload: e.target.value });
    });

    document.getElementById('pricing-toggle').addEventListener('click', togglePricing);
    document.getElementById('details-toggle').addEventListener('click', toggleDetails);
    document.getElementById('history-toggle').addEventListener('click', toggleHistory);
    document.getElementById('costcurve-toggle').addEventListener('click', toggleCostCurve);
    document.getElementById('memory-toggle').addEventListener('click', toggleMemory);

    document.getElementById('ccu-tabs').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button.ccu-tab');
      if (!btn) return;
      const next = btn.getAttribute('data-tab');
      if (!next) return;
      ccuTab = next;
      document.querySelectorAll('#ccu-tabs .ccu-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      renderCcu();
    });

    document.getElementById('history-tabs').addEventListener('click', (e) => {
      const btn = e.target && e.target.closest && e.target.closest('button.ccu-tab');
      if (!btn) return;
      const next = btn.getAttribute('data-range');
      if (!next) return;
      historyRange = next;
      document.querySelectorAll('#history-tabs .ccu-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      if (lastData && lastData.heatmap) { updateHeatmap(lastData.heatmap); }
    });

    document.getElementById('ccu-content').addEventListener('click', (e) => {
      const t = e.target;
      if (!t || !t.closest) return;
      const dayRow = t.closest('[data-ccu-day]');
      if (dayRow) {
        const date = dayRow.getAttribute('data-ccu-day');
        if (date) toggleCcuDay(date);
        return;
      }
      const monthRow = t.closest('[data-ccu-month]');
      if (monthRow) {
        const month = monthRow.getAttribute('data-ccu-month');
        if (month) toggleCcuMonth(month);
      }
    });

    document.addEventListener('click', e => {
      const id = e.target && e.target.id;
      if (id === 'budget-configure-btn') { toggleBudgetConfig(); }
      else if (id === 'budget-save-btn') { saveBudget(); }
      else if (id === 'budget-clear-btn') { clearBudget(); }
      else if (id === 'pricing-settings-btn') { vscode.postMessage({ type: 'openSettings' }); }
      else if (e.target && e.target.closest && e.target.closest('#history-view-toggle')) { toggleHistoryView(); }
    });

    function toggleDetails() {
      detailsOpen = !detailsOpen;
      const el = document.getElementById('details-body');
      const btn = document.getElementById('details-toggle');
      if (el) el.style.display = detailsOpen ? '' : 'none';
      if (btn) btn.textContent = detailsOpen ? '${i18n('dashboard.hide')}' : '${i18n('dashboard.show')}';
    }

    function toggleHistoryView() {
      historyViewMode = historyViewMode === 'detail' ? 'total' : 'detail';
      const btn = document.getElementById('history-view-toggle');
      if (btn) btn.textContent = historyViewMode === 'detail' ? '${i18n('dashboard.viewTotal')}' : '${i18n('dashboard.viewDetail')}';
      if (lastData && lastData.heatmap) { updateHeatmap(lastData.heatmap); }
    }

    function toggleHistory() {
      historyOpen = !historyOpen;
      const el = document.getElementById('history-body');
      const btn = document.getElementById('history-toggle');
      if (el) el.style.display = historyOpen ? '' : 'none';
      if (btn) btn.textContent = historyOpen ? '${i18n('dashboard.hide')}' : '${i18n('dashboard.show')}';
    }

    function toggleCostCurve() {
      costCurveOpen = !costCurveOpen;
      const el = document.getElementById('costcurve-body');
      const btn = document.getElementById('costcurve-toggle');
      if (el) el.style.display = costCurveOpen ? '' : 'none';
      if (btn) btn.textContent = costCurveOpen ? '${i18n('dashboard.hide')}' : '${i18n('dashboard.show')}';
      if (costCurveOpen) renderCostCurveCard();
    }

    function togglePricing() {
      pricingOpen = !pricingOpen;
      const el = document.getElementById('pricing-content');
      const btn = document.getElementById('pricing-toggle');
      if (el) {
        el.style.display = pricingOpen ? '' : 'none';
        if (pricingOpen && lastData) {
          renderPricingContent(lastData.pricing, lastData.settings, lastData.modelPricing);
        }
      }
      if (btn) btn.textContent = pricingOpen ? '${i18n('dashboard.hide')}' : '${i18n('dashboard.show')}';
    }

    function toggleMemory() {
      memoryOpen = !memoryOpen;
      const el = document.getElementById('memory-body');
      const btn = document.getElementById('memory-toggle');
      if (el) el.style.display = memoryOpen ? '' : 'none';
      if (btn) {
        const totalText = lastData && lastData.usage && lastData.usage.memoryTotalBytes
          ? ' (' + fmtMemSize(lastData.usage.memoryTotalBytes) + ')'
          : '';
        btn.textContent = (memoryOpen ? '🔽 ' : '🧠 ') + '内存占用' + totalText;
      }
    }

    function fmtMemSize(bytes) {
      if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(2) + ' MB';
      if (bytes >= 1024) return (bytes / 1024).toFixed(2) + ' KB';
      return bytes + ' B';
    }

    function renderCurrentUsage(usage, mode) {
      const w5h = Math.min(100, usage.utilization5h * 100 || 0);
      const w7d = Math.min(100, usage.utilization7d * 100 || 0);
      const isEstimate = usage.dataSource === 'local-only' || usage.dataSource === 'stale';

      const fill5h = document.getElementById('fill-5h');
      fill5h.style.width = w5h + '%';
      fill5h.className = 'progress-fill' + (w5h >= 75 ? ' warning' : '') + (w5h >= 90 ? ' error' : '');
      const lbl5h = document.getElementById('lbl-5h');
      if (mode === 'absolute' && usage.has7dLimit) {
        lbl5h.textContent = usage.used5h + ' / ' + usage.limit5h;
      } else {
        lbl5h.textContent = w5h.toFixed(2) + '%';
      }
      document.getElementById('badge-5h').textContent = isEstimate ? labels.estimate : '';
      document.getElementById('meta-5h').textContent = usage.resetIn5hText || '';
      document.getElementById('cost-5h').textContent = usage.cost5h > 0 ? labels.cost + CURRENCY_SYMBOL + usage.cost5h.toFixed(2) : '';

      const fill7d = document.getElementById('fill-7d');
      fill7d.style.width = w7d + '%';
      fill7d.className = 'progress-fill' + (w7d >= 75 ? ' warning' : '') + (w7d >= 90 ? ' error' : '');
      const lbl7d = document.getElementById('lbl-7d');
      if (mode === 'absolute' && usage.has7dLimit) {
        lbl7d.textContent = usage.used7d + ' / ' + usage.limit7d;
      } else {
        lbl7d.textContent = w7d.toFixed(2) + '%';
      }
      document.getElementById('badge-7d').textContent = isEstimate ? labels.estimate : '';
      document.getElementById('meta-7d').textContent = usage.resetIn7dText || '';
      document.getElementById('cost-7d').textContent = usage.cost7d > 0 ? labels.cost + CURRENCY_SYMBOL + usage.cost7d.toFixed(2) : '';

      // Memory breakdown
      const memBtn = document.getElementById('memory-toggle');
      const memBody = document.getElementById('memory-body');
      const memTbody = document.getElementById('memory-tbody');
      const memTotal = document.getElementById('memory-total');
      if (memBtn && usage.memoryTotalBytes != null) {
        memBtn.textContent = (memoryOpen ? '🔽 ' : '🧠 ') + '内存占用 (' + fmtMemSize(usage.memoryTotalBytes) + ')';
      }
      if (memTbody && usage.memoryBreakdown) {
        memTbody.innerHTML = usage.memoryBreakdown.map(item =>
          '<tr>' +
          '<td class="ccu-key">' + esc(item.name) + '</td>' +
          '<td class="ccu-num">' + fmtMemSize(item.bytes) + '</td>' +
          '<td style="text-align:left;font-size:0.85em;color:var(--vscode-descriptionForeground);">' + esc(item.description) + '</td>' +
          '</tr>'
        ).join('');
      }
      if (memTotal && usage.memoryTotalBytes != null) {
        memTotal.textContent = fmtMemSize(usage.memoryTotalBytes);
      }
      if (memBody) {
        memBody.style.display = memoryOpen ? '' : 'none';
      }
    }

    // ---- Pricing & Settings ----
    function renderPricingContent(pricing, settings, modelPricing) {
      const el = document.getElementById('pricing-content');
      if (!el || !pricing) return;
      const providerLabel = settings.provider === 'openai' ? 'OpenAI' : settings.provider;
      const apiStatus = settings.apiEnabled
        ? '<span class="settings-badge ok">' + '${i18n('dashboard.apiEnabled')}' + '</span>'
        : '<span class="settings-badge warn">' + '${i18n('dashboard.apiDisabled')}' + '</span>';
      const cacheMins = Math.round(settings.cacheTtlSeconds / 60);
      const officialLinkLabel = '${i18n('dashboard.officialPricing')}';
      const officialUrl = esc(settings.officialUrl || 'https://platform.kimi.com/docs/pricing/chat-k26');
      const officialDate = esc(settings.officialDate || '2026-05-13');
      let html =
        '<div class="settings-row">' +
        '<a href="' + officialUrl + '" target="_blank" class="settings-badge" style="text-decoration:none;cursor:pointer;">' + esc(providerLabel) + '</a>' +
        apiStatus +
        '<span class="settings-badge">${i18n('dashboard.cacheTtl')}: ' + cacheMins + 'm</span>' +
        '</div>' +
        '<div style="margin-top:8px;display:flex;gap:12px;align-items:center;">' +
        '<button class="configure-link" id="pricing-settings-btn">${i18n('dashboard.editSettings')}</button>' +
        '<a href="' + officialUrl + '" target="_blank" class="configure-link" style="text-decoration:none;">' + officialLinkLabel + ' [' + officialDate + ']</a>' +
        '</div>';
      el.innerHTML = html;
    }

    // ---- Detailed Usage ----
    function renderCcuSummary(data) {
      if (!data) return '<div class="placeholder">${i18n('dashboard.noData')}</div>';
      const rows = [
        ['${i18n('dashboard.tokenCost')}', fmtCurrency(data.totalCost)],
        ['${i18n('dashboard.messages')}', fmtNum(data.messageCount)],
        ['${i18n('dashboard.inputTokens')}', fmtNum(data.totalInputTokens)],
        ['${i18n('dashboard.outputTokens')}', fmtNum(data.totalOutputTokens)],
        ['${i18n('dashboard.cacheCreate')}', fmtNum(data.totalCacheCreationTokens)],
        ['${i18n('dashboard.cacheRead')}', fmtNum(data.totalCacheReadTokens)],
      ];
      return '<div class="summary-grid">' +
        rows.map(r => '<div class="summary-item"><div class="label">' + esc(r[0]) + '</div><div class="value">' + esc(r[1]) + '</div></div>').join('') +
        '</div>';
    }

    function renderModelBreakdown(data) {
      if (!data || !data.modelBreakdown) return '';
      const entries = Object.entries(data.modelBreakdown);
      if (entries.length === 0) return '';
      entries.sort((a, b) => (b[1].cost || 0) - (a[1].cost || 0));
      return '<div class="model-breakdown"><div class="section-title">${i18n('dashboard.modelBreakdown')}</div><div class="model-list">' +
        entries.map(([model, m]) => {
          return '<div class="model-item"><div class="model-header"><span class="model-name">' + esc(model) + '</span><span class="model-cost">' + fmtCurrency(m.cost) + '</span></div>' +
            '<div class="model-metrics">' +
            '<div class="model-metric"><div class="model-metric-val">${i18n('dashboard.input')}: ' + fmtNum(m.inputTokens) + '</div><div class="model-metric-rate"></div></div>' +
            '<div class="model-metric"><div class="model-metric-val">${i18n('dashboard.output')}: ' + fmtNum(m.outputTokens) + '</div><div class="model-metric-rate"></div></div>' +
            '<div class="model-metric"><div class="model-metric-val">${i18n('dashboard.cacheCreate')}: ' + fmtNum(m.cacheCreationTokens) + '</div><div class="model-metric-rate"></div></div>' +
            '<div class="model-metric"><div class="model-metric-val">${i18n('dashboard.cacheRead')}: ' + fmtNum(m.cacheReadTokens) + '</div><div class="model-metric-rate"></div></div>' +
            '<div class="model-metric"><div class="model-metric-val">${i18n('dashboard.messages')}: ' + fmtNum(m.count) + '</div><div class="model-metric-rate"></div></div>' +
            '</div></div>';
        }).join('') +
        '</div></div>';
    }

    function renderBreakdownTable(rows, kind) {
      if (!rows || rows.length === 0) return '';
      const isHourly = kind === 'hourly';
      const header = isHourly ? '${i18n('dashboard.hourlyBreakdown')}' : (kind === 'daily' ? '${i18n('dashboard.dailyBreakdown')}' : '${i18n('dashboard.monthlyBreakdown')}');
      const firstCol = isHourly ? '${i18n('dashboard.hour')}' : '${i18n('dashboard.date')}';
      return '<div class="breakdown"><div class="section-title">' + header + '</div>' +
        '<table class="ccu-table"><thead><tr>' +
        '<th>' + firstCol + '</th>' +
        '<th>${i18n('dashboard.tokenCost')}</th>' +
        '<th>${i18n('dashboard.inputTokens')}</th>' +
        '<th>${i18n('dashboard.outputTokens')}</th>' +
        '<th>${i18n('dashboard.cacheCreate')}</th>' +
        '<th>${i18n('dashboard.cacheRead')}</th>' +
        '<th>${i18n('dashboard.messages')}</th>' +
        '</tr></thead><tbody>' +
        rows.map(r => {
          const key = isHourly ? r.hour : r.date;
          const attr = isHourly ? '' : (kind === 'daily' ? (' data-ccu-day="' + key + '"') : (' data-ccu-month="' + key + '"'));
          return '<tr class="ccu-row"' + attr + '>' +
            '<td class="ccu-key">' + esc(key) + '</td>' +
            '<td class="ccu-cost">' + fmtCurrency(r.data.totalCost) + '</td>' +
            '<td class="ccu-num">' + fmtNum(r.data.totalInputTokens) + '</td>' +
            '<td class="ccu-num">' + fmtNum(r.data.totalOutputTokens) + '</td>' +
            '<td class="ccu-num">' + fmtNum(r.data.totalCacheCreationTokens) + '</td>' +
            '<td class="ccu-num">' + fmtNum(r.data.totalCacheReadTokens) + '</td>' +
            '<td class="ccu-num">' + fmtNum(r.data.messageCount) + '</td>' +
            '</tr>';
        }).join('') +
        '</tbody></table></div>';
    }

    function toggleCcuDay(date) {
      if (ccuExpandedDay === date) { ccuExpandedDay = null; renderCcu(); return; }
      ccuExpandedDay = date;
      if (!ccuHourlyCache.has(date)) {
        vscode.postMessage({ type: 'getHourlyData', date });
      }
      renderCcu();
    }

    function toggleCcuMonth(month) {
      if (ccuExpandedMonth === month) { ccuExpandedMonth = null; renderCcu(); return; }
      ccuExpandedMonth = month;
      if (!ccuDailyCache.has(month)) {
        vscode.postMessage({ type: 'getDailyData', month });
      }
      renderCcu();
    }

    function renderCcu() {
      const root = document.getElementById('ccu-content');
      if (!root) return;
      const d = lastData && lastData.dashboard;
      if (!d) { root.innerHTML = '<div class="placeholder">${i18n('dashboard.calculating')}</div>'; return; }

      if (ccuTab === 'today') {
        const localTodayKey = (() => { const n = new Date(); const yyyy = n.getFullYear(); const mm = String(n.getMonth()+1).padStart(2,'0'); const dd = String(n.getDate()).padStart(2,'0'); return yyyy+'-'+mm+'-'+dd; })();
        const hourlyPre = Array.isArray(d.hourlyForToday) ? d.hourlyForToday : [];
        const hourly = hourlyPre.length > 0 ? hourlyPre : (ccuHourlyCache.get(localTodayKey) || null);
        if (!hourly && !ccuHourlyCache.has(localTodayKey)) {
          vscode.postMessage({ type: 'getHourlyData', date: localTodayKey });
        }
        const hourlyBlock = hourly ? renderBreakdownTable(hourly, 'hourly') : '<div class="placeholder">${i18n('dashboard.calculating')}</div>';
        root.innerHTML = renderCcuSummary(d.today) + renderModelBreakdown(d.today) + hourlyBlock;
        return;
      }

      if (ccuTab === 'w5h') {
        root.innerHTML = renderCcuSummary(d.window5h) + renderModelBreakdown(d.window5h);
        return;
      }
      if (ccuTab === 'w7d') {
        root.innerHTML = renderCcuSummary(d.window7d) + renderModelBreakdown(d.window7d);
        return;
      }
      if (ccuTab === 'w30d') {
        root.innerHTML = renderCcuSummary(d.window30d) + renderModelBreakdown(d.window30d);
        return;
      }
      if (ccuTab === 'month') {
        const daily = d.dailyForThisMonth || [];
        const expanded = ccuExpandedDay
          ? (ccuHourlyCache.get(ccuExpandedDay) ? renderBreakdownTable(ccuHourlyCache.get(ccuExpandedDay), 'hourly') : '<div class="placeholder">${i18n('dashboard.calculating')}</div>')
          : '';
        root.innerHTML = renderCcuSummary(d.thisMonth) + renderModelBreakdown(d.thisMonth) + renderBreakdownTable(daily, 'daily') + expanded;
        return;
      }
      const months = d.monthlyForAllTime || [];
      const expandedDaily = ccuExpandedMonth
        ? (ccuDailyCache.get(ccuExpandedMonth) ? renderBreakdownTable(ccuDailyCache.get(ccuExpandedMonth), 'daily') : '<div class="placeholder">${i18n('dashboard.calculating')}</div>')
        : '';
      const expandedHourly = ccuExpandedDay && ccuHourlyCache.get(ccuExpandedDay)
        ? renderBreakdownTable(ccuHourlyCache.get(ccuExpandedDay), 'hourly')
        : '';
      root.innerHTML = renderCcuSummary(d.allTime) + renderModelBreakdown(d.allTime) + renderBreakdownTable(months, 'month') + expandedDaily + expandedHourly;
    }

    // ---- Heatmap ----
    let hourlyChartTokens = null;
    let hourlyChartCost = null;

    function setCanvasHalfHeight(canvas) {
      if (!canvas || !canvas.getBoundingClientRect) return;
      const w = canvas.getBoundingClientRect().width || canvas.clientWidth || 0;
      if (w > 0) {
        const ratio = Math.max(0.2, Math.min(1, Number(chartHeightRatio) || 0.4));
        canvas.height = Math.max(80, Math.round(w * ratio));
      }
    }

    function buildHeatmapCalendarHtml(daily, getVal, fmtTitle) {
      const vals = daily.map(getVal);
      const maxV = Math.max(...vals, 0);
      const minV = Math.min(...vals);
      const span = maxV - minV;
      const firstDow = new Date(daily[0].date + 'T12:00:00').getDay();
      let headerHtml = '';
      const allCells = [...Array(firstDow).fill(null), ...daily];
      const numCols = Math.ceil(allCells.length / 7);
      let lastMonth = -1;
      for (let col = 0; col < numCols; col++) {
        let label = '';
        for (let row = 0; row < 7; row++) {
          const cell = allCells[col * 7 + row];
          if (cell) {
            const dd = new Date(cell.date + 'T12:00:00');
            const m = dd.getMonth();
            if (m !== lastMonth && (dd.getDate() <= 7 || col === 0)) {
              label = dd.toLocaleString('default', { month: 'short' });
              lastMonth = m;
            }
            break;
          }
        }
        headerHtml += '<div class="hm-col-label">' + (label ? esc(label) : '') + '</div>';
      }
      let gridHtml = '';
      for (let i = 0; i < firstDow; i++) {
        gridHtml += '<div class="hm-cell l-empty"></div>';
      }
      for (const day of daily) {
        const v = getVal(day);
        const tt = span > 0 ? (v - minV) / span : (maxV > 0 && v >= maxV ? 1 : 0);
        const bg = v === 0 && maxV === 0
          ? 'var(--vscode-editor-background)'
          : heatmapColdWarmColor(tt);
        const border = '1px solid var(--vscode-panel-border)';
        const title = fmtTitle(day, v);
        gridHtml += '<div class="hm-cell" style="background-color:' + bg + ';border:' + border + '" title="' + esc(title) + '"></div>';
      }
      const scaleText = '${i18n('dashboard.heatmapScale')}: ' + fmtNum(minV) + ' \u2192 ' + fmtNum(maxV);
      return { headerHtml, gridHtml, scaleText };
    }

    function updateHeatmap(heatmap) {
      const el = document.getElementById('heatmap-content');
      const daysEl = document.getElementById('heatmap-days');
      if (!heatmap || !heatmap.daily || heatmap.daily.length === 0) {
        el.innerHTML = '<div class="placeholder">${i18n('dashboard.noUsageHistory')}</div>';
        return;
      }
      const daily = heatmap.daily;
      const byModel = historyRange === '5h'
        ? (heatmap.cycles5hByModel || [])
        : historyRange === '7d'
          ? (heatmap.cycles7dByModel || [])
          : historyRange === '30dwin'
            ? (heatmap.cycles30dByModel || [])
            : (heatmap.dailyByModel || []);
      if (daysEl) daysEl.textContent = daily.length;

      const tokCal = buildHeatmapCalendarHtml(
        daily,
        d => d.tokensTotal,
        (day, v) => day.date + ': ' + fmtNum(v) + ' tok' + (day.sessionCount > 0 ? ' (' + day.sessionCount + ' ${i18n('dashboard.msgs')})' : ''),
      );
      const costCal = buildHeatmapCalendarHtml(
        daily,
        d => d.cost,
        (day, v) => day.date + ': ' + fmtCurrency(v) + (day.sessionCount > 0 ? ' (' + day.sessionCount + ' ${i18n('dashboard.msgs')})' : ''),
      );

      const coldWarmLegend =
        '<div class="heatmap-legend">${i18n('dashboard.less')} ' +
        '<span style="display:inline-block;width:48px;height:10px;background:linear-gradient(90deg,' + heatmapColdWarmColor(0) + ',' + heatmapColdWarmColor(1) + ');border-radius:2px;vertical-align:middle"></span> ' +
        '${i18n('dashboard.more')}</div>';

      const costs = daily.map(d => d.cost);
      const costScalePlain = '${i18n('dashboard.heatmapScale')}: ' + fmtCurrency(Math.min(...costs)) + ' \u2192 ' + fmtCurrency(Math.max(...costs));

      const nextStatic =
        '<div class="heatmap-hint">${i18n('dashboard.heatmapColdWarmHint')} ${i18n('dashboard.heatmapLocalTzHint')}</div>' +
        '<div class="heatmap-pair">' +
          '<div class="heatmap-block">' +
            '<div class="heatmap-section-title">${i18n('dashboard.heatmapTokensTitle')}</div>' +
            '<div class="heatmap-scale" id="hm-scale-tok"></div>' +
            '<div class="heatmap-container"><div class="hm-header" id="hm-header-tok"></div><div class="heatmap-grid" id="hm-grid-tok"></div></div>' +
            coldWarmLegend +
          '</div>' +
          '<div class="heatmap-block">' +
            '<div class="heatmap-section-title">${i18n('dashboard.heatmapCostTitle')}</div>' +
            '<div class="heatmap-scale" id="hm-scale-usd"></div>' +
            '<div class="heatmap-container"><div class="hm-header" id="hm-header-usd"></div><div class="heatmap-grid" id="hm-grid-usd"></div></div>' +
            coldWarmLegend +
          '</div>' +
        '</div>' +
        '<div style="display:flex;justify-content:flex-end;margin:8px 0 4px"><button class="detail-toggle" id="history-view-toggle">${i18n('dashboard.viewTotal')}</button></div>' +
        '<div class="hourly-title">${i18n('dashboard.dailyChartTokens')}</div>' +
        '<canvas id="hourlyChartTokens" height="200"></canvas>' +
        '<div class="hourly-title">${i18n('dashboard.dailyChartCost')}</div>' +
        '<canvas id="hourlyChartCost" height="200"></canvas>';

      if (!el.__heatmapStatic || el.__heatmapStatic !== nextStatic) {
        el.innerHTML = nextStatic;
        el.__heatmapStatic = nextStatic;
      }

      const sTok = document.getElementById('hm-scale-tok');
      const sUsd = document.getElementById('hm-scale-usd');
      const hTok = document.getElementById('hm-header-tok');
      const hUsd = document.getElementById('hm-header-usd');
      const gTok = document.getElementById('hm-grid-tok');
      const gUsd = document.getElementById('hm-grid-usd');
      if (sTok) sTok.textContent = tokCal.scaleText;
      if (sUsd) sUsd.textContent = costScalePlain;
      if (hTok) hTok.innerHTML = tokCal.headerHtml;
      if (gTok) gTok.innerHTML = tokCal.gridHtml;
      if (hUsd) hUsd.innerHTML = costCal.headerHtml;
      if (gUsd) gUsd.innerHTML = costCal.gridHtml;

      if (byModel.length > 0 && typeof Chart !== 'undefined') {
        const style = getComputedStyle(document.body);
        const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#cccccc';
        const labels = historyRange === '5h'
          ? byModel.map(d => {
            const s = String(d.date);
            const p = s.split(' ');
            if (p.length === 2) {
              const md = fmtDateShort(p[0]);
              const hh = p[1].split(':')[0];
              return md + '-' + hh;
            }
            return s;
          })
          : byModel.map(d => fmtDateShort(d.date));
        const xTicks = { color: fg, font: { size: 8 }, maxRotation: 50, autoSkip: true, maxTicksLimit: 16 };

        // Dynamic model colors
        const presetColors = ['#7c4dff', '#00a8e8', '#00c853', '#ff9800', '#ff5252', '#448aff'];
        const allModels = new Set();
        byModel.forEach(d => Object.keys(d.byModel).forEach(m => allModels.add(m)));
        const modelList = Array.from(allModels);
        const modelColors = {};
        modelList.forEach((m, i) => { modelColors[m] = presetColors[i % presetColors.length]; });

        const canvasT = document.getElementById('hourlyChartTokens');
        if (canvasT) {
          setCanvasHalfHeight(canvasT);
          const dsT = historyViewMode === 'detail'
            ? modelList.map(model => ({
                label: model,
                data: byModel.map(d => d.byModel[model]?.tokens || 0),
                backgroundColor: modelColors[model],
              }))
            : [];
          dsT.push({ label: '${i18n('dashboard.modelTotal')}', data: byModel.map(d => d.tokensTotal), backgroundColor: '#ff9800' });
          if (hourlyChartTokens) {
            hourlyChartTokens.data.labels = labels;
            hourlyChartTokens.data.datasets = dsT;
            hourlyChartTokens.options.plugins.legend.labels.color = fg;
            hourlyChartTokens.update('none');
          } else {
            hourlyChartTokens = new Chart(canvasT, {
              type: 'bar',
              data: { labels, datasets: dsT },
              options: {
                responsive: true, animation: false,
                plugins: {
                  legend: { labels: { color: fg, font: { size: 10 } } },
                  tooltip: { callbacks: { title: items => { if (!items.length) return ''; return byModel[items[0].dataIndex].date; } } },
                },
                scales: {
                  x: { ticks: xTicks, grid: { display: false } },
                  y: { ticks: { color: fg, font: { size: 10 } }, beginAtZero: true },
                },
              },
            });
          }
        }

        const canvasC = document.getElementById('hourlyChartCost');
        if (canvasC) {
          setCanvasHalfHeight(canvasC);
          const dsC = historyViewMode === 'detail'
            ? modelList.map(model => ({
                label: model,
                data: byModel.map(d => d.byModel[model]?.cost || 0),
                backgroundColor: modelColors[model],
              }))
            : [];
          dsC.push({ label: '${i18n('dashboard.modelTotal')}', data: byModel.map(d => d.costTotal), backgroundColor: '#ff9800' });
          if (hourlyChartCost) {
            hourlyChartCost.data.labels = labels;
            hourlyChartCost.data.datasets = dsC;
            hourlyChartCost.options.plugins.legend.labels.color = fg;
            hourlyChartCost.update('none');
          } else {
            hourlyChartCost = new Chart(canvasC, {
              type: 'bar',
              data: { labels, datasets: dsC },
              options: {
                responsive: true, animation: false,
                plugins: {
                  legend: { labels: { color: fg, font: { size: 10 } } },
                  tooltip: {
                    callbacks: {
                      title: items => { if (!items.length) return ''; return byModel[items[0].dataIndex].date; },
                      label: ctx => { const v = ctx.parsed.y; return (ctx.dataset.label || '') + ': ' + fmtCurrency(v); },
                    },
                  },
                },
                scales: {
                  x: { ticks: xTicks, grid: { display: false } },
                  y: { ticks: { color: fg, font: { size: 10 }, callback: v => CURRENCY_SYMBOL + Number(v).toFixed(2) }, beginAtZero: true },
                },
              },
            });
          }
        }
      }
    }

    // ---- Cost Curve ----
    let costCurveOptions = null;
    let costCurveChart5h = null;
    let costCurveChart7d = null;
    let costCurvePendingTimer5h = null;
    let costCurvePendingTimer7d = null;
    let selected5h = null;
    let selected5hDate = null;
    let selected5hHour = null;
    let selected7d = null;

    function renderCostCurveCard() {
      const root = document.getElementById('costcurve-body');
      if (!root) return;
      if (!costCurveOptions) {
        root.innerHTML = '<div class="placeholder">${i18n('dashboard.calculating')}</div>';
        vscode.postMessage({ type: 'getCostCurveOptions' });
        return;
      }
      const opts5h = costCurveOptions.options5h || [];
      const opts7d = costCurveOptions.options7d || [];
      if (!selected5h && opts5h.length) selected5h = String(opts5h[0].startMs);
      if (!selected7d && opts7d.length) selected7d = String(opts7d[0].startMs);

      function fmtDateKey(ms) { const d = new Date(ms); return (d.getMonth()+1) + '.' + d.getDate(); }
      function fmtHour(ms) { return String(new Date(ms).getHours()).padStart(2, '0'); }

      const groups5h = [];
      const byDate = new Map();
      for (const o of opts5h) {
        const dk = fmtDateKey(o.startMs);
        if (!byDate.has(dk)) { const g = { dateKey: dk, label: dk, items: [] }; byDate.set(dk, g); groups5h.push(g); }
        byDate.get(dk).items.push(o);
      }
      if (!selected5hDate && groups5h.length) selected5hDate = groups5h[0].dateKey;
      const curGroup = groups5h.find(g => g.dateKey === selected5hDate) || (groups5h[0] || null);
      if (curGroup && selected5hDate !== curGroup.dateKey) selected5hDate = curGroup.dateKey;
      const hourOpts5h = (curGroup ? curGroup.items : []).map(o => ({ startMs: o.startMs, endMs: o.endMs, label: fmtHour(o.startMs) }));
      if (!selected5hHour && hourOpts5h.length) selected5hHour = String(hourOpts5h[0].startMs);
      if (selected5hHour) selected5h = String(selected5hHour);

      if (!root.__costCurveStatic) {
        root.innerHTML =
          '<div class="curve-block">' +
            '<div class="curve-row">' +
              '<div class="curve-title">${i18n('dashboard.costCurve5h')}</div>' +
              '<div class="curve-controls">' +
                '<span class="curve-label">${i18n('dashboard.date')}</span>' +
                '<select id="costcurve-sel-5h-date" class="ccu-select"></select>' +
                '<span class="curve-label" style="margin-left:8px">${i18n('dashboard.hour')}</span>' +
                '<select id="costcurve-sel-5h-hour" class="ccu-select"></select>' +
              '</div>' +
            '</div>' +
            '<canvas id="costcurve-5h" height="160"></canvas>' +
          '</div>' +
          '<div class="curve-block" style="margin-top:10px">' +
            '<div class="curve-row">' +
              '<div class="curve-title">${i18n('dashboard.costCurve7d')}</div>' +
              '<div class="curve-controls"><span class="curve-label">${i18n('dashboard.selectWindow')}</span>' +
              '<select id="costcurve-sel-7d" class="ccu-select"></select>' +
              '</div>' +
            '</div>' +
            '<canvas id="costcurve-7d" height="160"></canvas>' +
          '</div>';
        root.__costCurveStatic = true;
      }

      const s7 = document.getElementById('costcurve-sel-7d');
      if (s7) {
        s7.innerHTML = opts7d.map(o => '<option value="' + o.startMs + '"' + (String(o.startMs) === String(selected7d) ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
      }
      const s5d = document.getElementById('costcurve-sel-5h-date');
      if (s5d) {
        s5d.innerHTML = groups5h.map(g => '<option value="' + g.dateKey + '"' + (String(g.dateKey) === String(selected5hDate) ? ' selected' : '') + '>' + esc(g.label) + '</option>').join('');
      }
      const s5h = document.getElementById('costcurve-sel-5h-hour');
      if (s5h) {
        s5h.innerHTML = hourOpts5h.map(o => '<option value="' + o.startMs + '"' + (String(o.startMs) === String(selected5hHour) ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
      }

      if (s5d && s5h) {
        if (!s5d.__bound) {
          s5d.__bound = true;
          s5d.addEventListener('change', () => {
            selected5hDate = s5d.value;
            const g = groups5h.find(x => x.dateKey === selected5hDate) || null;
            const items = g ? g.items : [];
            const newHourOpts = items.map(o => ({ value: String(o.startMs), label: fmtHour(o.startMs), endMs: o.endMs }));
            selected5hHour = newHourOpts.length ? String(newHourOpts[0].value) : null;
            s5h.innerHTML = newHourOpts.map(o => '<option value="' + o.value + '"' + (String(o.value) === String(selected5hHour) ? ' selected' : '') + '>' + esc(o.label) + '</option>').join('');
            const opt = items.find(o => String(o.startMs) === String(selected5hHour));
            if (opt) {
              scheduleCostCurvePending('5h', opt.startMs, opt.endMs);
              vscode.postMessage({ type: 'getCostCurve', window: '5h', startMs: opt.startMs, endMs: opt.endMs });
            }
          });
        }
        if (!s5h.__bound) {
          s5h.__bound = true;
          s5h.addEventListener('change', () => {
            selected5hHour = s5h.value;
            selected5h = String(selected5hHour);
            const items = (groups5h.find(x => x.dateKey === selected5hDate)?.items) || [];
            const opt = items.find(o => String(o.startMs) === String(selected5hHour));
            if (opt) {
              scheduleCostCurvePending('5h', opt.startMs, opt.endMs);
              vscode.postMessage({ type: 'getCostCurve', window: '5h', startMs: opt.startMs, endMs: opt.endMs });
            }
          });
        }
      }
      if (s7) {
        if (!s7.__bound) {
          s7.__bound = true;
          s7.addEventListener('change', () => {
            selected7d = s7.value;
            const opt = opts7d.find(o => String(o.startMs) === String(selected7d));
            if (opt) {
              scheduleCostCurvePending('7d', opt.startMs, opt.endMs);
              vscode.postMessage({ type: 'getCostCurve', window: '7d', startMs: opt.startMs, endMs: opt.endMs });
            }
          });
        }
      }

      const items5 = (groups5h.find(x => x.dateKey === selected5hDate)?.items) || opts5h;
      const opt5 = items5.find(o => String(o.startMs) === String(selected5hHour || selected5h));
      if (opt5) {
        scheduleCostCurvePending('5h', opt5.startMs, opt5.endMs);
        vscode.postMessage({ type: 'getCostCurve', window: '5h', startMs: opt5.startMs, endMs: opt5.endMs });
      }
      const opt7 = opts7d.find(o => String(o.startMs) === String(selected7d));
      if (opt7) {
        scheduleCostCurvePending('7d', opt7.startMs, opt7.endMs);
        vscode.postMessage({ type: 'getCostCurve', window: '7d', startMs: opt7.startMs, endMs: opt7.endMs });
      }
    }

    function densifyCostCurveSeries(pts, maxGapMs) {
      if (!maxGapMs || !pts || pts.length < 2) return pts.slice();
      const out = [];
      const maxSteps = 64;
      for (let i = 0; i < pts.length; i++) {
        const cur = pts[i];
        if (i === 0) { out.push(cur); continue; }
        const prev = pts[i - 1];
        const x1 = prev.x, y1 = prev.y;
        const x2 = cur.x, y2 = cur.y;
        if (y1 != null && y2 != null && x2 > x1) {
          const gap = x2 - x1;
          if (gap > maxGapMs) {
            let steps = Math.ceil(gap / maxGapMs);
            if (steps > maxSteps) steps = maxSteps;
            for (let s = 1; s < steps; s++) {
              const t = s / steps;
              out.push({ x: x1 + (x2 - x1) * t, y: y1 + (y2 - y1) * t });
            }
          }
        }
        out.push(cur);
      }
      return out;
    }

    function renderCostCurveChart(windowKey, points) {
      const canvas = document.getElementById(windowKey === '5h' ? 'costcurve-5h' : 'costcurve-7d');
      if (!canvas || typeof Chart === 'undefined') return;
      setCanvasHalfHeight(canvas);

      function fmtTick(ms) {
        const d = new Date(ms);
        if (windowKey === '7d') {
          return (d.getMonth()+1) + '.' + d.getDate() + '-' + String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0');
        }
        return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0') + ':' + String(d.getSeconds()).padStart(2,'0');
      }

      const xMin = points && points.length ? Number(points[0].tMs) : undefined;
      const xMax = points && points.length ? Number(points[points.length - 1].tMs) : undefined;
      const rawSeries = points.map(p => ({ x: Number(p.tMs), y: p.cumulativeRmb == null ? null : Number(p.cumulativeRmb) }));
      const maxGapMs = windowKey === '5h' ? 90 * 1000 : 20 * 60 * 1000;
      const series = densifyCostCurveSeries(rawSeries, maxGapMs);

      const chartRef = windowKey === '5h' ? costCurveChart5h : costCurveChart7d;
      const lineColor = windowKey === '7d' ? '#7c4dff' : '#00c853';
      if (chartRef) {
        chartRef.data.datasets[0].data = series;
        chartRef.data.datasets[0].borderColor = lineColor;
        if (xMin != null && xMax != null) {
          chartRef.options.scales.x.min = xMin;
          chartRef.options.scales.x.max = xMax;
        }
        chartRef.update('none');
        return;
      }

      const style = getComputedStyle(document.body);
      const fg = style.getPropertyValue('--vscode-editor-foreground').trim() || '#cccccc';
      const tooltipMono = style.getPropertyValue('--vscode-editor-font-family').trim() || 'monospace';
      const tension = windowKey === '7d' ? 0.35 : 0.05;
      const chart = new Chart(canvas, {
        data: {
          datasets: [{
            type: 'line',
            label: windowKey,
            data: series,
            borderColor: lineColor,
            borderWidth: 2,
            pointRadius: 0,
            tension,
            fill: false,
            spanGaps: false,
          }],
        },
        options: {
          responsive: true, animation: false,
          interaction: { mode: 'nearest', intersect: false },
          plugins: {
            legend: { display: false },
            tooltip: {
              titleFont: { family: tooltipMono, size: 12 },
              bodyFont: { family: tooltipMono, size: 12 },
              footerFont: { family: tooltipMono, size: 11 },
              callbacks: {
                title: items => { if (!items || !items.length) return ''; const x = items[0].parsed && typeof items[0].parsed.x === 'number' ? items[0].parsed.x : NaN; return isFinite(x) ? fmtTick(x) : ''; },
                label: ctx => CURRENCY_SYMBOL + Number(ctx.parsed.y || 0).toFixed(4),
              },
            },
          },
          scales: {
            x: {
              type: 'linear', min: xMin, max: xMax,
              ticks: { color: fg, font: { size: 8 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8, callback: v => fmtTick(Number(v)) },
              grid: { display: false },
            },
            y: { ticks: { color: fg, font: { size: 10 }, callback: v => CURRENCY_SYMBOL + v }, grid: { color: fg + '22' }, beginAtZero: true },
          },
        },
      });
      if (windowKey === '5h') costCurveChart5h = chart; else costCurveChart7d = chart;
    }

    function setCostCurvePending(windowKey, startMs, endMs) {
      const chartRef = windowKey === '5h' ? costCurveChart5h : costCurveChart7d;
      if (!chartRef) return;
      const x0 = Number(startMs), x1 = Number(endMs);
      chartRef.data.datasets[0].data = [{ x: x0, y: null }, { x: x1, y: null }];
      chartRef.options.scales.x.min = x0;
      chartRef.options.scales.x.max = x1;
      chartRef.update('none');
    }

    function scheduleCostCurvePending(windowKey, startMs, endMs) {
      if (windowKey === '5h') {
        if (costCurvePendingTimer5h) clearTimeout(costCurvePendingTimer5h);
        costCurvePendingTimer5h = setTimeout(() => { costCurvePendingTimer5h = null; setCostCurvePending('5h', startMs, endMs); }, 150);
      } else {
        if (costCurvePendingTimer7d) clearTimeout(costCurvePendingTimer7d);
        costCurvePendingTimer7d = setTimeout(() => { costCurvePendingTimer7d = null; setCostCurvePending('7d', startMs, endMs); }, 150);
      }
    }

    function cancelCostCurvePending(windowKey) {
      if (windowKey === '5h') {
        if (costCurvePendingTimer5h) { clearTimeout(costCurvePendingTimer5h); costCurvePendingTimer5h = null; }
      } else {
        if (costCurvePendingTimer7d) { clearTimeout(costCurvePendingTimer7d); costCurvePendingTimer7d = null; }
      }
    }

    // ---- Budget ----
    let budgetConfigOpen = false;
    function toggleBudgetConfig() {
      budgetConfigOpen = !budgetConfigOpen;
      const form = document.getElementById('budget-form');
      if (form) form.style.display = budgetConfigOpen ? 'flex' : 'none';
    }
    function saveBudget() {
      const input = document.getElementById('budget-input');
      const val = parseFloat(input ? input.value : '');
      if (!isNaN(val) && val >= 0) {
        vscode.postMessage({ type: 'setBudget', amount: val });
        budgetConfigOpen = false;
      }
    }
    function clearBudget() {
      vscode.postMessage({ type: 'setBudget', amount: null });
      budgetConfigOpen = false;
    }

    // ---- Main message handler ----
    window.addEventListener('message', event => {
      const msg = event.data;
      if (msg.type === 'update') {
        if (refreshing) { refreshing = false; }
        lastData = msg.data;
        lastFetchAt = msg.data.usage.lastUpdated || 0;
        currentIsLoading = msg.data.isLoading;
        chartHeightRatio = (msg.data && msg.data.settings && typeof msg.data.settings.chartHeightRatio === 'number') ? msg.data.settings.chartHeightRatio : 0.4;
        renderCurrentUsage(msg.data.usage, currentDisplayMode);
        if (msg.data.heatmap) { updateHeatmap(msg.data.heatmap); }
        renderCcu();
        renderPricingContent(msg.data.pricing, msg.data.settings, msg.data.modelPricing);
        if (msg.data.costCurveOptions) {
          costCurveOptions = msg.data.costCurveOptions;
          if (costCurveOpen) renderCostCurveCard();
        }
        // Footer
        const age = msg.data.usage.lastUpdated
          ? Math.max(0, Math.floor((Date.now() - msg.data.usage.lastUpdated) / 1000))
          : 0;
        const ageStr = age < 60 ? labels.justNow : Math.floor(age / 60) + labels.minutesAgo;
        const sourceLabel = msg.data.usage.dataSource === 'local-only' ? labels.localEstimate : '';
        document.getElementById('footer').textContent = labels.lastUpdated + ageStr + sourceLabel;
      } else if (msg.type === 'hourlyDataResponse') {
        if (msg.date && Array.isArray(msg.data)) {
          ccuHourlyCache.set(msg.date, msg.data);
          renderCcu();
        }
      } else if (msg.type === 'dailyDataResponse') {
        if (msg.month && Array.isArray(msg.data)) {
          ccuDailyCache.set(msg.month, msg.data);
          renderCcu();
        }
      } else if (msg.type === 'setDisplayMode') {
        currentDisplayMode = msg.mode;
        if (lastData) renderCurrentUsage(lastData.usage, currentDisplayMode);
      } else if (msg.type === 'costCurveOptions') {
        costCurveOptions = msg.data;
        if (costCurveOpen) renderCostCurveCard();
      } else if (msg.type === 'costCurve') {
        if (msg.window && Array.isArray(msg.points)) {
          if (msg.window === '5h') {
            const cur = String(selected5hHour || selected5h || '');
            if (String(msg.startMs) !== cur) return;
          } else if (msg.window === '7d') {
            if (String(msg.startMs) !== String(selected7d || '')) return;
          }
          cancelCostCurvePending(msg.window);
          renderCostCurveChart(msg.window, msg.points);
        }
      }
    });

    vscode.postMessage({ type: 'ready' });
  </script>
</body>
</html>`;
  }
}
