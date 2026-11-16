// DESIGN: v2-provider-abstraction.md#volcengine-auth
import * as vscode from 'vscode';
import { CredentialType, IAuthProvider, IQuotaApiProvider } from '../base/types';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';
import { VolcengineApiProvider } from './api';

const SECRET_KEY = 'aiStatusHub.volcengine.apiKey';
const QUOTA_SECRET_KEY = 'aiStatusHub.volcengine.quotaCredentials';

export class VolcengineAuthProvider implements IAuthProvider {
  private secrets?: vscode.SecretStorage;
  private credentialType: CredentialType = 'api-key';
  constructor(private readonly api: IQuotaApiProvider = new VolcengineApiProvider()) {}

  initSecrets(secrets: vscode.SecretStorage): void { this.secrets = secrets; }
  invalidate(): void { /* Read the private credential afresh on every resolution. */ }
  getCredentialType(): CredentialType { return this.credentialType; }

  async resolveToken(): Promise<string | undefined> {
    try {
      const quota = await this.secrets?.get(QUOTA_SECRET_KEY);
      this.credentialType = quota ? 'access-key' : 'api-key';
      return quota || (await this.secrets?.get(SECRET_KEY))?.trim() || undefined;
    }
    catch { return undefined; }
  }

  async startLoginFlow(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      const configure = t('volcengine.configureQuota');
      if (await this.resolveToken()) {
        const choice = await vscode.window.showInformationMessage(t('volcengine.quotaGuide'),
          { modal: true }, configure, t('volcengine.editKey'));
        if (!choice) return false;
        if (choice === configure) return this.configureQuota();
      }
      const key = (await vscode.window.showInputBox({
        title: t('volcengine.enterKey'), prompt: t('volcengine.keyPrompt'),
        password: true, ignoreFocusOut: true,
      }))?.trim();
      if (!key) return false;
      if (!this.secrets) {
        await vscode.window.showErrorMessage(t('volcengine.keySaveFailed'));
        return false;
      }
      // Model API keys are distinct from account AK/SK quota credentials.
      await this.secrets.store(SECRET_KEY, key);
      const next = await vscode.window.showInformationMessage(t('volcengine.keySaved'), configure);
      if (next === configure) return this.configureQuota();
      return true;
    } catch {
      await vscode.window.showErrorMessage(t('volcengine.keySaveFailed'));
      return false;
    }
  }

  private async configureQuota(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      const options = { password: true, ignoreFocusOut: true, title: t('volcengine.configureQuota') };
      const accessKeyId = (await vscode.window.showInputBox({ ...options, prompt: t('volcengine.accessKeyPrompt') }))?.trim();
      if (!accessKeyId) return false;
      const secretAccessKey = (await vscode.window.showInputBox({ ...options, prompt: t('volcengine.secretKeyPrompt') }))?.trim();
      if (!secretAccessKey) return false;
      if (!this.secrets) { await vscode.window.showErrorMessage(t('volcengine.keySaveFailed')); return false; }
      const credential = JSON.stringify({ accessKeyId, secretAccessKey });
      const result = await this.api.fetchQuota(credential);
      if (!result.ok || !result.data) {
        await vscode.window.showErrorMessage(result.error ?? t('volcengine.quotaFailed'));
        return false;
      }
      // Keep the pair atomic and separate from the model key. Never store failed replacements.
      await this.secrets.store(QUOTA_SECRET_KEY, credential);
      this.credentialType = 'access-key';
      await vscode.window.showInformationMessage(t('volcengine.quotaSaved'));
      return true;
    } catch {
      await vscode.window.showErrorMessage(t('volcengine.quotaFailed'));
      return false;
    }
  }

  async signOut(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      if (!this.secrets) {
        await vscode.window.showErrorMessage(t('volcengine.signOutFailed'));
        return false;
      }
      await this.secrets.delete(QUOTA_SECRET_KEY);
      await this.secrets.delete(SECRET_KEY);
      return true;
    } catch {
      await vscode.window.showErrorMessage(t('volcengine.signOutFailed'));
      return false;
    }
  }
}
