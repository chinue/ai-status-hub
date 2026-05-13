// DESIGN: v2-provider-abstraction.md#codex-auth
// AGENTS: err->try-catch | disk-OK
// 🔀 Provider boundary: reads ~/.codex/auth.json (OpenAI JWT format)

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IAuthProvider } from '../base/types';
import { log } from '../../utils';

const AUTH_FILE = path.join(os.homedir(), '.codex', 'auth.json');

interface CodexAuthJson {
  tokens?: {
    id_token?: string;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
}

function parseJWT(token: string): Record<string, any> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return {};
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8');
    return JSON.parse(payload);
  } catch {
    return {};
  }
}

export interface CodexAuthInfo {
  accessToken: string;
  accountId?: string;
  email: string;
  planType: string;
}

export class CodexAuthProvider implements IAuthProvider {
  private cachedToken: string | undefined;
  private cachedInfo: CodexAuthInfo | undefined;

  async resolveToken(): Promise<string | undefined> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    const info = await this.readAuthFile();
    if (!info) {
      return undefined;
    }

    this.cachedToken = info.accessToken;
    this.cachedInfo = info;
    return this.cachedToken;
  }

  async resolveAuthInfo(): Promise<CodexAuthInfo | undefined> {
    if (this.cachedInfo) {
      return this.cachedInfo;
    }
    const info = await this.readAuthFile();
    if (info) {
      this.cachedInfo = info;
    }
    return info;
  }

  invalidate(): void {
    this.cachedToken = undefined;
    this.cachedInfo = undefined;
  }

  private async readAuthFile(): Promise<CodexAuthInfo | undefined> {
    try {
      const raw = await fs.readFile(AUTH_FILE, 'utf-8');
      const parsed: CodexAuthJson = JSON.parse(raw);
      const tokens = parsed.tokens;
      if (!tokens?.access_token) {
        return undefined;
      }

      const idPayload = tokens.id_token ? parseJWT(tokens.id_token) : {};
      const planType =
        idPayload['https://api.openai.com/auth']?.chatgpt_plan_type ??
        idPayload['https://api.openai.com/auth.chatgpt_plan_type'] ??
        'Unknown';

      return {
        accessToken: tokens.access_token,
        accountId: tokens.account_id,
        email: idPayload.email ?? 'Unknown',
        planType,
      };
    } catch (err) {
      log(`Codex auth read error: ${(err as Error).message}`);
      return undefined;
    }
  }
}
