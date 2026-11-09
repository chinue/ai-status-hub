// DESIGN: v2-provider-abstraction.md#glm-provider
import * as vscode from 'vscode';
import { IAuthProvider, IQuotaApiProvider } from '../base/types';
import { GlmApiProvider } from './api';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

const LOGIN_URL = 'https://bigmodel.cn/usercenter/proj-mgmt/apikeys';
const SECRET_KEY = 'aiStatusHub.glm.apiKey';

export class GlmAuthProvider implements IAuthProvider {
  constructor(private readonly api: IQuotaApiProvider = new GlmApiProvider()) {}
  private secrets?: vscode.SecretStorage;
  initSecrets(secrets: vscode.SecretStorage): void { this.secrets = secrets; }
  invalidate(): void { /* Credentials are read afresh from SecretStorage. */ }
  getCredentialType(): 'api-key' { return 'api-key'; }
  async resolveToken(): Promise<string | undefined> {
    try {
      return await this.secrets?.get(SECRET_KEY) || process.env.ZHIPUAI_API_KEY?.trim()
        || process.env.GLM_API_KEY?.trim() || undefined;
    } catch { return undefined; }
  }
  async startLoginFlow(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      const open = t('glm.openLogin');
      const action = await vscode.window.showInformationMessage(t('glm.loginGuide', LOGIN_URL),
        { modal: true }, open, t('glm.enterKey'));
      if (!action) return false;
      if (action === open) {
        try {
          if (!await vscode.env.openExternal(vscode.Uri.parse(LOGIN_URL))) {
            await vscode.window.showWarningMessage(t('glm.browserFailed', LOGIN_URL));
          }
        } catch { await vscode.window.showWarningMessage(t('glm.browserFailed', LOGIN_URL)); }
      }
      const key = (await vscode.window.showInputBox({ password: true, ignoreFocusOut: true,
        title: t('glm.enterKey'), prompt: t('glm.keyPrompt', LOGIN_URL) }))?.trim();
      if (!key) return false;
      if (!this.secrets) { await vscode.window.showErrorMessage(t('glm.loginFailed')); return false; }
      const result = await this.api.fetchQuota(key);
      if (!result.ok || !result.data) {
        await vscode.window.showErrorMessage(result.error ?? t('glm.queryFailed'));
        return false;
      }
      await this.secrets.store(SECRET_KEY, key);
      await vscode.window.showInformationMessage(t('glm.keySaved'));
      return true;
    } catch {
      await vscode.window.showErrorMessage(t('glm.loginFailed'));
      return false;
    }
  }
}
