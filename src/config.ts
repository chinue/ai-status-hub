// DESIGN: v2-phase2-implementation.md#configts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { DisplayMode, LanguageSetting, TokenPricing } from './types';

const CFG_SECTION = 'codexStatusPro';

export class ConfigService {
  private static instance: ConfigService;
  private activeProviderId = 'codex';

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
    const raw = this.cfg.get<string>('currency', 'auto');
    if (raw === 'CNY') { return { code: 'CNY', symbol: '¥' }; }
    if (raw === 'USD') { return { code: 'USD', symbol: '$' }; }
    // auto: infer from provider
    switch (this.activeProviderId) {
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
    return Math.max(1, Math.min(200, this.cfg.get<number>('dashboard.memoryDetailMaxRows', 50)));
  }

  get apiHistoryMaxEntries(): number {
    return Math.max(1, Math.min(10000, this.cfg.get<number>('apiHistoryMaxEntries', 1000)));
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
      case 'kimi': return 'https://www.moonshot.cn/pricing';
      case 'claude': return 'https://www.anthropic.com/pricing';
      case 'glm': return 'https://open.bigmodel.cn/pricing';
      case 'cursor': return 'https://cursor.com/pricing';
      case 'codex':
      default: return 'https://openai.com/pricing';
    }
  }

  get pricingOfficialDate(): string {
    return this.cfg.get<string>('pricing.officialDate', '2026-05-13');
  }

  getPricing(modelName: string): TokenPricing {
    const m = modelName.toLowerCase();
    let key = m.replace(/[^a-z0-9]/g, '');
    // Claude family mapping
    if (m.includes('opus')) { key = 'claudeopus'; }
    else if (m.includes('sonnet')) { key = 'claudesonnet'; }
    else if (m.includes('haiku')) { key = 'claudehaiku'; }
    // Kimi family mapping
    else if (m.includes('kimi')) { key = 'kimik2_6'; }

    // Provider-private config takes priority: pricing.{provider}.models.{key}
    const providerPrefix = `pricing.${this.activeProviderId}.models.${key}`;
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
