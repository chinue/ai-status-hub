// DESIGN: v2-provider-abstraction.md#kimi-auth
// AGENTS: err->try-catch | secret-safe
// 🔀 Provider boundary: Kimi OAuth + API Key authentication

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
import { IAuthProvider } from '../base/types';
import { log } from '../../utils';
import { CacheService } from '../../services/cacheService';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

const CLIENT_ID = '17e5f671-d194-4dfb-9706-5516cb48c098';
const OAUTH_HOST = 'https://auth.kimi.com';
const DEVICE_CODE_PATH = '/api/oauth/device_authorization';
const TOKEN_PATH = '/api/oauth/token';
const REFRESH_THRESHOLD_SECONDS = 300;
const HTTP_TIMEOUT_MS = 15_000;

const SECRET_API_KEY = 'aiStatusHub.apiKey';
const SECRET_OAUTH = 'aiStatusHub.oauthCredentials';

interface KimiOAuthCredentials {
  accessToken: string;
  refreshToken: string;
  tokenType: string;
  expiresAt: number;
  scope: string;
  deviceId: string;
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
}

interface OAuthTokenWire {
  access_token?: string;
  refresh_token?: string;
  token_type?: string;
  expires_in?: number;
  scope?: string;
  error?: string;
  error_description?: string;
}

function commonHeaders(deviceId: string): Record<string, string> {
  return {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
    'X-Msh-Platform': 'kimi-status-pro-vscode',
    'X-Msh-Version': '0.4.0',
    'X-Msh-Device-Id': deviceId,
  };
}

async function postForm(
  host: string,
  path: string,
  body: URLSearchParams,
  headers: Record<string, string>,
  fetcher: typeof fetch,
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetcher(`${host}${path}`, {
      method: 'POST',
      headers: { ...headers, 'Content-Length': String(Buffer.byteLength(body.toString())) },
      body: body.toString(),
      signal: controller.signal as any,
    });
    const text = await resp.text();
    return { status: resp.status, body: text };
  } finally {
    clearTimeout(timeout);
  }
}

async function requestDeviceCode(deviceId: string, fetcher: typeof fetch): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({ client_id: CLIENT_ID });
  const { status, body: text } = await postForm(OAUTH_HOST, DEVICE_CODE_PATH, body, commonHeaders(deviceId), fetcher);
  if (status !== 200) {
    throw new Error(`device_authorization failed: HTTP ${status}`);
  }
  const parsed = JSON.parse(text) as DeviceCodeResponse;
  if (!parsed.device_code || !parsed.user_code) {
    throw new Error('device_authorization response missing required fields');
  }
  return parsed;
}

async function exchangeDeviceCode(deviceId: string, deviceCode: string, fetcher: typeof fetch): Promise<PollOutcome> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const { body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(deviceId), fetcher);
  const wire = JSON.parse(text) as OAuthTokenWire;
  if (wire.error === 'authorization_pending' || wire.error === 'slow_down') {
    return { kind: 'pending' };
  }
  if (wire.error) {
    return { kind: 'failed', error: `${wire.error}: ${wire.error_description ?? ''}`.trim() };
  }
  if (!wire.access_token) {
    return { kind: 'failed', error: 'empty access_token in response' };
  }
  return { kind: 'success', creds: wireToCredentials(wire, deviceId) };
}

async function refreshAccessToken(creds: KimiOAuthCredentials, fetcher: typeof fetch): Promise<KimiOAuthCredentials> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
  });
  const { status, body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(creds.deviceId), fetcher);
  if (status === 401 || status === 403) {
    throw new Error(`refresh_token rejected (HTTP ${status})`);
  }
  if (status !== 200) {
    throw new Error(`refresh failed: HTTP ${status}`);
  }
  const wire = JSON.parse(text) as OAuthTokenWire;
  if (!wire.access_token) {
    throw new Error('empty access_token in refresh response');
  }
  return wireToCredentials(wire, creds.deviceId, creds.refreshToken);
}

function wireToCredentials(wire: OAuthTokenWire, deviceId: string, fallbackRefresh = ''): KimiOAuthCredentials {
  const expiresIn = wire.expires_in ?? 0;
  return {
    accessToken: wire.access_token ?? '',
    refreshToken: wire.refresh_token ?? fallbackRefresh,
    tokenType: wire.token_type ?? 'Bearer',
    expiresAt: expiresIn > 0 ? Math.floor(Date.now() / 1000) + Math.floor(expiresIn) : 0,
    scope: wire.scope ?? 'kimi-code',
    deviceId,
  };
}

function parseCredentials(value: unknown): KimiOAuthCredentials | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const token = data.access_token ?? data.accessToken;
  if (typeof token !== 'string' || !token.trim()) return undefined;
  const rawExpiry = data.expires_at ?? data.expiresAt ?? 0;
  if (typeof rawExpiry !== 'number' || !Number.isFinite(rawExpiry) || rawExpiry < 0) return undefined;
  const refresh = data.refresh_token ?? data.refreshToken;
  const device = data.device_id ?? data.deviceId;
  return {
    accessToken: token,
    refreshToken: typeof refresh === 'string' ? refresh : '',
    expiresAt: Math.floor(rawExpiry > 1e12 ? rawExpiry / 1000 : rawExpiry),
    tokenType: 'Bearer', scope: typeof data.scope === 'string' ? data.scope : 'kimi-code',
    deviceId: typeof device === 'string' ? device : '',
  };
}

function newDeviceId(): string {
  return crypto.randomUUID();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface AuthorizationPending { kind: 'pending'; }
interface AuthorizationFailed { kind: 'failed'; error: string; }
interface AuthorizationSuccess { kind: 'success'; creds: KimiOAuthCredentials; }
type PollOutcome = AuthorizationPending | AuthorizationFailed | AuthorizationSuccess;

export class KimiAuthProvider implements IAuthProvider {
  private secrets: vscode.SecretStorage | undefined;
  private cachedToken: string | null = null;
  private cachedAt = 0;
  private loginPromise?: Promise<boolean>;

  constructor(private fetcher: typeof fetch = fetch) {}

  initSecrets(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  async resolveToken(): Promise<string | undefined> {
    try {
      // Reread shared credentials before the private cache, so official-client logins
      // and token rotations become visible immediately without copying refresh tokens.
      const now = Math.floor(Date.now() / 1000);
      for (const raw of await CacheService.getInstance().readKimiCredentials()) {
        const shared = parseCredentials(raw);
        if (shared && (shared.expiresAt === 0 || shared.expiresAt > now)) return shared.accessToken;
      }
      if (!this.secrets) return undefined;
      if (this.cachedToken && Date.now() - this.cachedAt < 60_000) return this.cachedToken;
      const creds = await this.readOAuth();
      if (!creds) {
        const apiKey = await this.secrets.get(SECRET_API_KEY);
        if (apiKey) { this.cachedToken = apiKey; this.cachedAt = Date.now(); }
        return apiKey;
      }
      if (creds.expiresAt === 0 || creds.expiresAt - now > REFRESH_THRESHOLD_SECONDS) {
        this.cachedToken = creds.accessToken;
        this.cachedAt = Date.now();
        return creds.accessToken;
      }
      if (!creds.refreshToken) return undefined;
      const refreshed = await refreshAccessToken(creds, this.fetcher);
      await this.writeOAuth(refreshed);
      this.cachedToken = refreshed.accessToken;
      this.cachedAt = Date.now();
      return refreshed.accessToken;
    } catch {
      // Preserve saved credentials on transient network/SecretStorage failures.
      log('Kimi token resolution failed; saved credentials were preserved.');
      this.invalidate();
      return undefined;
    }
  }

  async startLoginFlow(): Promise<boolean> {
    if (this.loginPromise) return this.loginPromise;
    this.loginPromise = this.doLogin();
    try { return await this.loginPromise; }
    finally { this.loginPromise = undefined; }
  }

  private async doLogin(): Promise<boolean> {
    const t = makeT(ConfigService.getInstance().effectiveLanguage);
    try {
      void vscode.window.showInformationMessage(t('kimi.loginStarting'));
      if (await this.resolveToken()) {
        void vscode.window.showInformationMessage(t('kimi.loginReused'));
        return true;
      }
      if (!this.secrets) {
        void vscode.window.showErrorMessage(t('kimi.loginUnavailable'));
        return false;
      }
      const deviceId = newDeviceId();
      const response = await requestDeviceCode(deviceId, this.fetcher);
      const uri = response.verification_uri_complete ?? response.verification_uri;
      if (typeof uri !== 'string' || !uri.startsWith('https://') || !Number.isFinite(response.expires_in) || response.expires_in <= 0) {
        void vscode.window.showErrorMessage(t('kimi.loginFailed'));
        return false;
      }
      void vscode.window.showInformationMessage(t('kimi.loginCode').replace('{code}', response.user_code));
      if (!await vscode.env.openExternal(vscode.Uri.parse(uri))) {
        void vscode.window.showErrorMessage(t('kimi.loginBrowserFailed'));
        return false;
      }
      const expiresAt = Date.now() + Math.min(response.expires_in, 600) * 1000;
      const intervalMs = Math.max(1, Number.isFinite(response.interval) ? response.interval : 5) * 1000;
      while (Date.now() < expiresAt) {
        await sleep(intervalMs);
        const outcome = await exchangeDeviceCode(deviceId, response.device_code, this.fetcher);
        if (outcome.kind === 'success') {
          await this.writeOAuth(outcome.creds);
          this.invalidate();
          void vscode.window.showInformationMessage(t('kimi.loginSuccess'));
          return true;
        }
        if (outcome.kind === 'failed') {
          void vscode.window.showErrorMessage(t('kimi.loginFailed'));
          return false;
        }
      }
      void vscode.window.showWarningMessage(t('kimi.loginTimeout'));
    } catch {
      log('Kimi sign-in failed during browser authorization.');
      void vscode.window.showErrorMessage(t('kimi.loginFailed'));
    }
    return false;
  }

  invalidate(): void {
    this.cachedToken = null;
    this.cachedAt = 0;
  }

  private async readOAuth(): Promise<KimiOAuthCredentials | undefined> {
    if (!this.secrets) return undefined;
    const raw = await this.secrets.get(SECRET_OAUTH);
    if (!raw) return undefined;
    try { return parseCredentials(JSON.parse(raw)); } catch { return undefined; }
  }

  private async writeOAuth(creds: KimiOAuthCredentials): Promise<void> {
    if (!this.secrets) return;
    await this.secrets.store(SECRET_OAUTH, JSON.stringify(creds));
  }

}
