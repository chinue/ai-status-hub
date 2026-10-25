// DESIGN: v2-phase2-implementation.md#configts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { DisplayMode, LanguageSetting, TokenPricing } from './types';
import { parseCustomPricing, pricingModelKey } from './calc';

const CFG_SECTION = 'aiStatusHub';
const STATUS_BAR_SELECTION_KEY = 'aiStatusHub.statusBar.providers';

export class ConfigService {
  private static instance: ConfigService;
  private activeProviderId = 'codex';
  private selectionStorage?: vscode.Memento;

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private get cfg() {
    return vscode.workspace.getConfiguration(CFG_SECTION);
  }

  setActiveProviderId(id: string): void {
    this.activeProviderId = id;
  }

  get provider(): string {
    return this.cfg.get<string>('provider', 'auto');
  }

  async setProvider(id: string): Promise<void> {
    await this.cfg.update('provider', id, true);
  }

  get displayMode(): DisplayMode {
    return this.cfg.get<DisplayMode>('displayMode', 'percent');
  }

  async setDisplayMode(mode: DisplayMode): Promise<void> {
    await this.cfg.update('displayMode', mode, true);
  }

  get language(): LanguageSetting {
    return this.cfg.get<LanguageSetting>('language', 'auto');
  }

  async setLanguage(lang: LanguageSetting): Promise<void> {
    await this.cfg.update('language', lang, true);
  }

  get refreshIntervalSeconds(): number {
    return Math.max(30, this.cfg.get<number>('refreshIntervalSeconds', 300));
  }

  get shortRefreshIntervalSeconds(): number {
    return Math.max(1, Math.min(60, this.cfg.get<number>('shortRefreshIntervalSeconds', 5)));
  }

  get dataRetentionDays(): number {
    return Math.max(30, Math.min(3650, this.cfg.get<number>('dataRetentionDays', 365)));
  }

  get updateAnimationDurationMs(): number {
    return Math.max(500, Math.min(10_000, this.cfg.get<number>('updateAnimationDurationMs', 5_000)));
  }

  get updateAnimationIntervalMs(): number {
    return Math.max(100, Math.min(2_000, this.cfg.get<number>('updateAnimationIntervalMs', 300)));
  }

  get defaultModelName(): string {
    // Provider-specific default model name
    switch (this.activeProviderId) {
      case 'kimi': return 'kimi-k2.6';
      case 'claude': return 'claude-sonnet-4';
      case 'glm': return 'glm-4';
      case 'cursor': return 'cursor-fast';
      case 'codex':
      default: return 'gpt-5';
    }
  }

  get currency(): { code: string; symbol: string } {
    return this.currencyForProvider(this.activeProviderId);
  }

  currencyForProvider(providerId: string): { code: string; symbol: string } {
    const raw = this.cfg.get<string>('currency', 'auto');
    if (raw === 'CNY') { return { code: 'CNY', symbol: '¥' }; }
    if (raw === 'USD') { return { code: 'USD', symbol: '$' }; }
    // auto: infer from provider
    switch (providerId) {
      case 'kimi':
      case 'glm':
        return { code: 'CNY', symbol: '¥' };
      case 'codex':
      case 'claude':
      case 'cursor':
      default:
        return { code: 'USD', symbol: '$' };
    }
  }

  get effectiveLanguage(): 'en' | 'zh-CN' {
    return ConfigService.resolveEffectiveLanguage(this.language);
  }

  static resolveEffectiveLanguage(lang: LanguageSetting): 'en' | 'zh-CN' {
    if (lang === 'auto') {
      return vscode.env.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
    }
    return lang;
  }

  // Phase 3: Dashboard settings
  get weeklyBudget(): number | null {
    const raw = this.cfg.get<number>('weeklyBudget', 0);
    return raw > 0 ? raw : null;
  }

  async setWeeklyBudget(amount: number | null): Promise<void> {
    await this.cfg.update('weeklyBudget', amount ?? 0, true);
  }

  get chartHeightRatio(): number {
    return Math.max(0.2, Math.min(1, this.cfg.get<number>('chartHeightRatio', 0.4)));
  }

  get memoryDetailMaxRows(): number {
    return Math.max(1, Math.min(1000, this.cfg.get<number>('dashboard.memoryDetailMaxRows', 500)));
  }

  get memoryDetailDisplayMaxRows(): number {
    return Math.max(1, Math.min(200, this.cfg.get<number>('dashboard.memoryDetailDisplayMaxRows', 40)));
  }

  get memoryDetailCellMaxChars(): number {
    return Math.max(8, Math.min(256, this.cfg.get<number>('dashboard.memoryDetailCellMaxChars', 64)));
  }

  get apiHistoryMaxEntries(): number {
    return Math.max(1, Math.min(100000, this.cfg.get<number>('apiHistoryMaxEntries', 10000)));
  }

  get apiHistoryPersistOnExit(): boolean {
    return this.cfg.get<boolean>('apiHistoryPersistOnExit', false);
  }

  get heatmapDays(): number {
    return Math.max(30, Math.min(365, this.cfg.get<number>('heatmapDays', 90)));
  }

  get heatmapCycles5h(): number {
    return Math.max(1, Math.min(60, this.cfg.get<number>('heatmapCycles5h', 30)));
  }

  get heatmapCycles7d(): number {
    return Math.max(1, Math.min(60, this.cfg.get<number>('heatmapCycles7d', 30)));
  }

  get heatmapCycles30d(): number {
    return Math.max(1, Math.min(60, this.cfg.get<number>('heatmapCycles30d', 12)));
  }

  get costCurveMaxPoints(): number {
    return Math.max(200, Math.min(20_000, this.cfg.get<number>('costCurveMaxPoints', 2_000)));
  }

  initializeSelectionStorage(storage?: vscode.Memento): void {
    this.selectionStorage = storage;
  }

  get statusBarProviders(): string[] {
    // An extension host may run new code before VS Code refreshes its setting registry.
    const stored = this.selectionStorage?.get<unknown>(STATUS_BAR_SELECTION_KEY);
    if (Array.isArray(stored)) return [...new Set(stored.filter((id): id is string => typeof id === 'string'))];
    const cfg = this.cfg;
    const value = cfg.inspect?.<string[]>('statusBar.providers');
    if (value && value.globalValue === undefined && value.workspaceValue === undefined && value.workspaceFolderValue === undefined) {
      return [this.activeProviderId];
    }
    const ids = cfg.get<unknown>('statusBar.providers');
    return Array.isArray(ids) ? [...new Set(ids.filter((id): id is string => typeof id === 'string'))] : [this.activeProviderId];
  }

  async setStatusBarProviders(ids: string[]): Promise<boolean> {
    try {
      await this.cfg.update('statusBar.providers', ids, true);
    } catch (err) {
      console.error('Status bar configuration update failed; using extension storage', err);
      if (!this.selectionStorage) return false;
      try {
        await this.selectionStorage.update(STATUS_BAR_SELECTION_KEY, ids);
        return true;
      } catch (storageError) {
        console.error('Status bar selection storage update failed', storageError);
        return false;
      }
    }
    try { await this.selectionStorage?.update(STATUS_BAR_SELECTION_KEY, undefined); }
    catch (err) { console.error('Status bar selection fallback cleanup failed', err); }
    return true;
  }

  // StatusBar settings
  get statusBarAlignment(): vscode.StatusBarAlignment {
    const raw = this.cfg.get<string>('statusBar.alignment', 'right');
    return raw === 'left' ? vscode.StatusBarAlignment.Left : vscode.StatusBarAlignment.Right;
  }

  get statusBarUtilizationColorLt20(): string {
    return this.cfg.get<string>('statusBar.utilizationColor.lt20', '#FFFFFF');
  }

  get statusBarUtilizationColorLt40(): string {
    return this.cfg.get<string>('statusBar.utilizationColor.lt40', '#FFFF80');
  }

  get statusBarUtilizationColorLt60(): string {
    return this.cfg.get<string>('statusBar.utilizationColor.lt60', '#00FF80');
  }

  get statusBarUtilizationColorLt80(): string {
    return this.cfg.get<string>('statusBar.utilizationColor.lt80', '#FF80FF');
  }

  get statusBarUtilizationColorGte80(): string {
    return this.cfg.get<string>('statusBar.utilizationColor.gte80', '#FF0000');
  }

  get pricingOfficialUrl(): string {
    const userUrl = this.cfg.get<string>('pricing.officialUrl', '');
    if (userUrl) { return userUrl; }
    // Provider defaults
    switch (this.activeProviderId) {
      case 'kimi': return 'https://platform.kimi.com/docs/pricing/chat';
      case 'claude': return 'https://platform.claude.com/docs/en/about-claude/pricing';
      case 'glm': return 'https://open.bigmodel.cn/pricing';
      case 'cursor': return 'https://cursor.com/pricing';
      case 'codex':
      default: return 'https://developers.openai.com/api/docs/pricing';
    }
  }

  get pricingOfficialDate(): string {
    return this.cfg.get<string>('pricing.officialDate', '2026-10-25');
  }

  getPricing(modelName: string, providerId = this.activeProviderId): TokenPricing {
    const m = modelName.toLowerCase();

    // User-defined custom pricing takes priority (key = model name keyword, substring match)
    const custom = this.cfg.get<Record<string, string>>('pricing.customModels', {});
    for (const [keyword, priceStr] of Object.entries(custom)) {
      const k = keyword.trim().toLowerCase();
      if (k && m.includes(k)) {
        const parsed = parseCustomPricing(String(priceStr));
        if (parsed) { return parsed; }
      }
    }

    // Setting keys must match package.json registration exactly (case-sensitive)
    const key = pricingModelKey(m);

    // Provider-private config takes priority: pricing.{provider}.models.{key}
    const providerPrefix = `pricing.${providerId}.models.${key}`;
    const globalPrefix = `pricing.models.${key}`;

    const input = this.cfg.get<number>(`${providerPrefix}.inputPerMillion`,
      this.cfg.get<number>(`${globalPrefix}.inputPerMillion`, 2.00));
    const output = this.cfg.get<number>(`${providerPrefix}.outputPerMillion`,
      this.cfg.get<number>(`${globalPrefix}.outputPerMillion`, 10.00));
    const cacheRead = this.cfg.get<number>(`${providerPrefix}.cacheReadPerMillion`,
      this.cfg.get<number>(`${globalPrefix}.cacheReadPerMillion`, 0.50));
    const cacheCreate = this.cfg.get<number>(`${providerPrefix}.cacheCreatePerMillion`,
      this.cfg.get<number>(`${globalPrefix}.cacheCreatePerMillion`, 2.00));

    return { inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: cacheRead, cacheCreatePerMillion: cacheCreate };
  }
}
