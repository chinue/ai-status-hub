// DESIGN: v2-provider-abstraction.md#kimi-auth
// AGENTS: err->try-catch | secret-safe
// 🔀 Provider boundary: Kimi OAuth + API Key authentication

import * as crypto from 'crypto';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import fetch from 'node-fetch';
import { IAuthProvider } from '../base/types';
import { log } from '../../utils';

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
): Promise<{ status: number; body: string }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS);
  try {
    const resp = await fetch(`${host}${path}`, {
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

async function requestDeviceCode(deviceId: string): Promise<DeviceCodeResponse> {
  const body = new URLSearchParams({ client_id: CLIENT_ID });
  const { status, body: text } = await postForm(OAUTH_HOST, DEVICE_CODE_PATH, body, commonHeaders(deviceId));
  if (status !== 200) {
    throw new Error(`device_authorization failed: HTTP ${status} ${text.slice(0, 200)}`);
  }
  const parsed = JSON.parse(text) as DeviceCodeResponse;
  if (!parsed.device_code || !parsed.user_code) {
    throw new Error('device_authorization response missing required fields');
  }
  return parsed;
}

async function exchangeDeviceCode(deviceId: string, deviceCode: string): Promise<PollOutcome> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    device_code: deviceCode,
    grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
  });
  const { body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(deviceId));
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

async function refreshAccessToken(creds: KimiOAuthCredentials): Promise<KimiOAuthCredentials> {
  const body = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: creds.refreshToken,
  });
  const { status, body: text } = await postForm(OAUTH_HOST, TOKEN_PATH, body, commonHeaders(creds.deviceId));
  if (status === 401 || status === 403) {
    throw new Error(`refresh_token rejected (HTTP ${status})`);
  }
  if (status !== 200) {
    throw new Error(`refresh failed: HTTP ${status} ${text.slice(0, 200)}`);
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

function readKimiCliCredentials(): KimiOAuthCredentials | undefined {
  try {
    const credPath = path.join(os.homedir(), '.kimi', 'credentials', 'kimi-code.json');
    if (!fs.existsSync(credPath)) return undefined;
    const raw = fs.readFileSync(credPath, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed.access_token) return undefined;
    return {
      accessToken: parsed.access_token,
      refreshToken: parsed.refresh_token ?? '',
      tokenType: parsed.token_type ?? 'Bearer',
      expiresAt: Math.floor(parsed.expires_at ?? 0),
      scope: parsed.scope ?? 'kimi-code',
      deviceId: parsed.device_id ?? '',
    };
  } catch { return undefined; }
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

  initSecrets(secrets: vscode.SecretStorage): void {
    this.secrets = secrets;
  }

  async resolveToken(): Promise<string | undefined> {
    if (!this.secrets) return undefined;
    if (this.cachedToken && Date.now() - this.cachedAt < 60_000) {
      return this.cachedToken;
    }

    let creds = await this.readOAuth();

    // Fallback 1: CLI credentials file
    if (!creds) {
      creds = readKimiCliCredentials();
      if (creds) { await this.writeOAuth(creds); }
    }

    // Fallback 2: API Key
    if (!creds) {
      const apiKey = await this.secrets.get(SECRET_API_KEY);
      if (apiKey) {
        this.cachedToken = apiKey;
        this.cachedAt = Date.now();
        return apiKey;
      }
    }

    if (!creds) return undefined;

    // Check expiration
    const now = Math.floor(Date.now() / 1000);
    if (creds.expiresAt === 0 || creds.expiresAt - now > REFRESH_THRESHOLD_SECONDS) {
      this.cachedToken = creds.accessToken;
      this.cachedAt = Date.now();
      return creds.accessToken;
    }

    // Refresh token
    try {
      const refreshed = await refreshAccessToken(creds);
      await this.writeOAuth(refreshed);
      this.cachedToken = refreshed.accessToken;
      this.cachedAt = Date.now();
      return refreshed.accessToken;
    } catch (err) {
      log(`Kimi refresh failed: ${(err as Error).message}. Clearing OAuth credentials.`);
      await this.deleteOAuth();
      this.invalidate();
      return undefined;
    }
  }

  async startLoginFlow(): Promise<boolean> {
    if (!this.secrets) return false;

    const deviceId = newDeviceId();
    let deviceCodeResp: DeviceCodeResponse;
    try {
      deviceCodeResp = await requestDeviceCode(deviceId);
    } catch (err) {
      void vscode.window.showErrorMessage(`Kimi sign-in failed: ${(err as Error).message}`);
      return false;
    }

    const uri = deviceCodeResp.verification_uri_complete ?? deviceCodeResp.verification_uri;
    void vscode.env.openExternal(vscode.Uri.parse(uri));
    void vscode.window.showInformationMessage(
      `Kimi sign-in: enter code "${deviceCodeResp.user_code}" in the browser if not automatically redirected.`,
    );

    const expiresAt = Date.now() + deviceCodeResp.expires_in * 1000;
    const intervalMs = (deviceCodeResp.interval ?? 5) * 1000;

    while (Date.now() < expiresAt) {
      await sleep(intervalMs);
      const outcome = await exchangeDeviceCode(deviceId, deviceCodeResp.device_code);
      if (outcome.kind === 'success') {
        await this.writeOAuth(outcome.creds);
        this.invalidate();
        void vscode.window.showInformationMessage('Kimi sign-in successful.');
        return true;
      }
      if (outcome.kind === 'failed') {
        void vscode.window.showErrorMessage(`Kimi sign-in failed: ${outcome.error}`);
        return false;
      }
    }

    void vscode.window.showWarningMessage('Kimi sign-in timed out. Please try again.');
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
    try { return JSON.parse(raw); } catch { return undefined; }
  }

  private async writeOAuth(creds: KimiOAuthCredentials): Promise<void> {
    if (!this.secrets) return;
    await this.secrets.store(SECRET_OAUTH, JSON.stringify(creds));
  }

  private async deleteOAuth(): Promise<void> {
    if (!this.secrets) return;
    await this.secrets.delete(SECRET_OAUTH);
  }
}
