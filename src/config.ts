// DESIGN: v2-phase2-implementation.md#configts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { DisplayMode, LanguageSetting, TokenPricing } from './types';

const CFG_SECTION = 'codexStatusPro';

export class ConfigService {
  private static instance: ConfigService;

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService();
    }
    return ConfigService.instance;
  }

  private get cfg() {
    return vscode.workspace.getConfiguration(CFG_SECTION);
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
    return this.cfg.get<string>('defaultModelName', 'gpt-5');
  }

  get currency(): { code: string; symbol: string } {
    const raw = this.cfg.get<string>('currency', 'USD');
    switch (raw) {
      case 'CNY': return { code: 'CNY', symbol: '¥' };
      case 'USD': return { code: 'USD', symbol: '$' };
      default: return { code: 'USD', symbol: '$' };
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
    return this.cfg.get<string>('pricing.officialUrl', 'https://openai.com/pricing');
  }

  get pricingOfficialDate(): string {
    return this.cfg.get<string>('pricing.officialDate', '2026-05-13');
  }

  getPricing(modelName: string): TokenPricing {
    const key = modelName.toLowerCase().replace(/[^a-z0-9]/g, '');
    const prefix = `pricing.models.${key}`;
    // Default pricing for gpt-5 in USD
    return {
      inputPerMillion: this.cfg.get<number>(`${prefix}.inputPerMillion`, 2.00),
      outputPerMillion: this.cfg.get<number>(`${prefix}.outputPerMillion`, 10.00),
      cacheReadPerMillion: this.cfg.get<number>(`${prefix}.cacheReadPerMillion`, 0.50),
      cacheCreatePerMillion: this.cfg.get<number>(`${prefix}.cacheCreatePerMillion`, 2.00),
    };
  }
}
