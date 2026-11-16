// DESIGN: v2-provider-abstraction.md#deepseek-provider
import * as vscode from 'vscode';
import { IAuthProvider, IQuotaApiProvider } from '../base/types';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { DeepseekApiProvider } from './api';

const SECRET = 'aiStatusHub.deepseek.apiKey';
export class DeepseekAuthProvider implements IAuthProvider {
  private secrets?: vscode.SecretStorage;
  constructor(private readonly api: IQuotaApiProvider = new DeepseekApiProvider()) {}
  initSecrets(secrets: vscode.SecretStorage): void { this.secrets = secrets; }
  invalidate(): void { /* Credentials are always read afresh. */ }
  getCredentialType(): 'api-key' { return 'api-key'; }
  async resolveToken(): Promise<string | undefined> {
    try { return (await this.secrets?.get(SECRET))?.trim() || process.env.DEEPSEEK_API_KEY?.trim() || undefined; }
    catch { return undefined; }
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
      return true;
    } catch { await vscode.window.showErrorMessage(t('deepseek.storageFailed')); return false; }
  }
}
