// DESIGN: v2-provider-abstraction.md#deepseek-provider
import * as vscode from 'vscode';
import { IAuthProvider, IQuotaApiProvider } from '../base/types';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { DeepseekApiProvider } from './api';
import { DeepseekWebApi } from './webApi';
import { calculateDeepseekInitialAmount } from '../../calc';

export const DEEPSEEK_WEB_SECRET = 'aiStatusHub.deepseek.webToken';
const SECRET = 'aiStatusHub.deepseek.apiKey';
export class DeepseekAuthProvider implements IAuthProvider {
  private secrets?: vscode.SecretStorage;
  constructor(private readonly api: IQuotaApiProvider = new DeepseekApiProvider(),
    private readonly webApi = new DeepseekWebApi()) {}
  initSecrets(secrets: vscode.SecretStorage): void { this.secrets = secrets; }
  invalidate(): void { /* Credentials are always read afresh. */ }
  getCredentialType(): 'api-key' { return 'api-key'; }
  async resolveToken(): Promise<string | undefined> {
    try { return (await this.secrets?.get(SECRET))?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || undefined; }
    catch { return undefined; }
  }
  async resolveWebToken(): Promise<string | undefined> {
    try { return (await this.secrets?.get(DEEPSEEK_WEB_SECRET))?.trim() || undefined; }
    catch { return undefined; }
  }
  async startWebLoginFlow(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      const open = t('deepseek.webOpen');
      const action = await vscode.window.showInformationMessage(t('deepseek.webConnect'),
        { modal: true, detail: t('deepseek.webGuide') }, open, t('deepseek.webEnter'), t('deepseek.editSetting'));
      if (action === t('deepseek.editSetting')) {
        await vscode.commands.executeCommand('workbench.action.openSettings2', {
          query: '@id:aiStatusHub.deepseek.initialAmount,aiStatusHub.deepseek.baseCost'
        });
        return false;
      }
      if (!action) return false;
      if (action === open) await vscode.env.openExternal(vscode.Uri.parse('https://platform.deepseek.com/usage'));
      const token = (await vscode.window.showInputBox({ title: t('deepseek.webConnect'),
        prompt: t('deepseek.webTokenPrompt'), password: true, ignoreFocusOut: true, value: await this.resolveWebToken() }))?.trim().replace(/^Bearer\s+/i, '');
      if (!token) return false;
      if (!this.secrets) { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
      const apiKey = await this.resolveToken();
      const balance = apiKey ? (await this.api.fetchQuota(apiKey)).data?.balance : undefined;
      const currency = balance?.currency ?? (ConfigService.getInstance().currencyForProvider('deepseek').code === 'USD' ? 'USD' : 'CNY');
      const result = await this.webApi.fetchBilling(token, currency, true);
      if (!result.ok || !result.data) { await vscode.window.showErrorMessage(result.error ?? t('deepseek.webQueryFailed')); return false; }
      const initial = calculateDeepseekInitialAmount(result.data.spent, result.data.available, ConfigService.getInstance().deepseekBaseCost);
      if (initial === null) { await vscode.window.showErrorMessage(t('deepseek.calibrationInvalid')); return false; }
      await this.secrets.store(DEEPSEEK_WEB_SECRET, token);
      if (!await ConfigService.getInstance().setDeepseekInitialAmount(initial)) {
        await vscode.window.showErrorMessage(t('deepseek.calibrationSaveFailed')); return false;
      }
      await vscode.window.showInformationMessage(t('deepseek.webConnected'));
      return true;
    } catch { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
  }
  async startLoginFlow(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      const key = (await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
        title: t('deepseek.enterKey'), prompt: t('deepseek.keyPrompt') }))?.trim();
      if (!key) return false;
      if (!this.secrets) { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
      const result = await this.api.fetchQuota(key);
      if (!result.ok || !result.data) { await vscode.window.showErrorMessage(result.error ?? t('deepseek.queryFailed')); return false; }
      if (await this.resolveToken() !== key) await this.secrets.delete(DEEPSEEK_WEB_SECRET);
      await this.secrets.store(SECRET, key);
      await vscode.window.showInformationMessage(t('deepseek.keySaved'));
      return true;
    } catch { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
  }
  async signOut(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      if (!this.secrets) { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
      await this.secrets.delete(SECRET);
      await this.secrets.delete(DEEPSEEK_WEB_SECRET);
      return true;
    } catch { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
  }
}
