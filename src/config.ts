// DESIGN: v2-phase2-implementation.md#configts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { DisplayMode, LanguageSetting, TokenPricing } from './types';
import { parseCustomPricing, pricingModelKey, normalizeStatusBarProviders } from './calc';
import { log } from './utils';

const CFG_SECTION = 'aiStatusHub';
const STATUS_BAR_SELECTION_KEY = 'aiStatusHub.statusBar.providers';
const DEEPSEEK_INITIAL_FALLBACK_KEY = 'aiStatusHub.deepseek.initialAmountFallback';

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

  get claudeLogGlmVolcengineCutover(): string {
    return this.cfg.get<string>('claudeLog.glmVolcengineCutover', '2026-11-16T13:00:00+08:00');
  }

  get claudeLogSessionProviders(): Record<string, unknown> {
    return this.cfg.get<Record<string, unknown>>('claudeLog.sessionProviders', {}) ?? {};
  }

  get claudeLogModelProviders(): Record<string, unknown> {
    return this.cfg.get<Record<string, unknown>>('claudeLog.modelProviders', {}) ?? {};
  }

  get deepseekBaseCost(): number {
    const value = this.cfg.get<number>('deepseek.baseCost', 0);
    return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
  }
  private deepseekConfiguredInitialValue(): number | null {
    try {
      const value = this.cfg.inspect?.<number>('deepseek.initialAmount')?.globalValue;
      return typeof value === 'number' && Number.isFinite(value) ? value : null;
    } catch { return null; }
  }
  get deepseekInitialAmount(): number {
    const value = this.cfg.get<number>('deepseek.initialAmount', 10);
    try {
      const saved = this.selectionStorage?.get<{ amount?: unknown; configuredValue?: unknown }>(DEEPSEEK_INITIAL_FALLBACK_KEY);
      if (saved && typeof saved.amount === 'number' && Number.isFinite(saved.amount) && saved.amount > 0
        && saved.configuredValue === this.deepseekConfiguredInitialValue()) return saved.amount;
    } catch { /* An unreadable fallback must not hide a valid user setting. */ }
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 10;
  }
  async clearDeepseekInitialAmountFallback(): Promise<void> {
    try { await this.selectionStorage?.update(DEEPSEEK_INITIAL_FALLBACK_KEY, undefined); }
    catch { /* A successful explicit settings write remains authoritative. */ }
  }
  async setDeepseekInitialAmount(amount: number): Promise<boolean> {
    if (!Number.isFinite(amount) || amount <= 0) return false;
    const configuredValue = this.deepseekConfiguredInitialValue();
    try { await this.cfg.update('deepseek.initialAmount', amount, vscode.ConfigurationTarget.Global); }
    catch {
      if (!this.selectionStorage) return false;
      try {
        await this.selectionStorage.update(DEEPSEEK_INITIAL_FALLBACK_KEY, { amount, configuredValue });
        log('DeepSeek initial amount saved locally; user settings write was unavailable.');
        return true;
      } catch { return false; }
    }
    await this.clearDeepseekInitialAmountFallback();
    return true;
  }

  get deepseekOffPeakDates(): string[] {
    return this.cfg.get<string[]>('deepseek.offPeakDates', []) ?? [];
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
      case 'glm': return 'glm-5.3';
      case 'volcengine': return 'glm-5.3-flash';
      case 'deepseek': return 'deepseek-flash';
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
      case 'volcengine':
      case 'deepseek':
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
    if (Array.isArray(stored)) return normalizeStatusBarProviders(stored);
    const cfg = this.cfg;
    const value = cfg.inspect?.<string[]>('statusBar.providers');
    if (value && value.globalValue === undefined && value.workspaceValue === undefined && value.workspaceFolderValue === undefined) {
      return ['kimi'];
    }
    const ids = cfg.get<unknown>('statusBar.providers');
    return normalizeStatusBarProviders(ids);
  }

  async setStatusBarProviders(ids: string[]): Promise<boolean> {
    const selected = normalizeStatusBarProviders(ids);
    try {
      await this.cfg.update('statusBar.providers', selected, true);
    } catch (err) {
      console.error('Status bar configuration update failed; using extension storage', err);
      if (!this.selectionStorage) return false;
      try {
        await this.selectionStorage.update(STATUS_BAR_SELECTION_KEY, selected);
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
      case 'glm': return 'https://docs.bigmodel.cn/cn/guide/start/pricing';
      case 'volcengine': return 'https://ark.volcengine.com/region:cn-beijing/docs/model-pricing';
      case 'deepseek': return 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/';
      case 'cursor': return 'https://cursor.com/pricing';
      case 'codex':
      default: return 'https://developers.openai.com/api/docs/pricing';
    }
  }

  get pricingOfficialDate(): string {
    return this.cfg.get<string>('pricing.officialDate', '2026-10-25');
  }

  private readPriceOverride(key: string, explicitOnly: boolean): number | undefined {
    try {
      const cfg = this.cfg;
      let value: unknown;
      if (explicitOnly && typeof cfg.inspect === 'function') {
        const info = cfg.inspect<number | null>(key);
        // Automatic DeepSeek prices must not be replaced by registered defaults,
        // including zeros retained from an older configuration registration.
        value = info && [info.workspaceFolderLanguageValue, info.workspaceLanguageValue,
          info.globalLanguageValue, info.workspaceFolderValue, info.workspaceValue,
          info.globalValue].find(candidate => candidate !== undefined);
      } else {
        value = cfg.get<unknown>(key);
      }
      return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
    } catch { return undefined; }
  }

  getPricing(modelName: string, providerId = this.activeProviderId, defaults?: TokenPricing, modelKey?: string): TokenPricing {
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
    const key = modelKey ?? pricingModelKey(m);

    // Provider-private config takes priority: pricing.{provider}.models.{key}
    const providerPrefix = `pricing.${providerId}.models.${key}`;
    const globalPrefix = `pricing.models.${key}`;

    // Dynamic DeepSeek rates accept only explicit scoped settings, never schema defaults.
    const explicitOnly = providerId === 'deepseek';
    // A null override means automatic pricing; explicit numeric zero remains valid.
    const input = this.readPriceOverride(`${providerPrefix}.inputPerMillion`, explicitOnly)
      ?? this.readPriceOverride(`${globalPrefix}.inputPerMillion`, explicitOnly) ?? defaults?.inputPerMillion ?? 2.00;
    const output = this.readPriceOverride(`${providerPrefix}.outputPerMillion`, explicitOnly)
      ?? this.readPriceOverride(`${globalPrefix}.outputPerMillion`, explicitOnly) ?? defaults?.outputPerMillion ?? 10.00;
    const cacheRead = this.readPriceOverride(`${providerPrefix}.cacheReadPerMillion`, explicitOnly)
      ?? this.readPriceOverride(`${globalPrefix}.cacheReadPerMillion`, explicitOnly) ?? defaults?.cacheReadPerMillion ?? 0.50;
    const cacheCreate = this.readPriceOverride(`${providerPrefix}.cacheCreatePerMillion`, explicitOnly)
      ?? this.readPriceOverride(`${globalPrefix}.cacheCreatePerMillion`, explicitOnly) ?? defaults?.cacheCreatePerMillion ?? 2.00;

    return { inputPerMillion: input, outputPerMillion: output, cacheReadPerMillion: cacheRead, cacheCreatePerMillion: cacheCreate };
  }
}
