// DESIGN: v2-provider-abstraction.md#claude-auth
// AGENTS: err->try-catch | disk-OK
// 🔀 Provider boundary: reads ~/.claude/.credentials.json (Claude OAuth format)
//   Falls back to ANTHROPIC_API_KEY env var and respects CLAUDE_CONFIG_DIR.

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IAuthProvider } from '../base/types';
import { log } from '../../utils';

const execAsync = promisify(exec);

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    expiresAt: number;
  };
}

function getCredentialsPath(): string {
  const configDir = process.env.CLAUDE_CONFIG_DIR
    ? path.normalize(process.env.CLAUDE_CONFIG_DIR)
    : path.join(os.homedir(), '.claude');
  return path.join(configDir, '.credentials.json');
}

function isTokenExpired(creds: ClaudeCredentials): boolean {
  const expiresAt = creds.claudeAiOauth?.expiresAt;
  if (!expiresAt) { return false; }
  // expiresAt may be in milliseconds (Claude Code writes ms), normalize to seconds.
  const expiresSec = expiresAt > 1_000_000_000_000 ? expiresAt / 1000 : expiresAt;
  return Date.now() / 1000 > expiresSec;
}

async function isClaudeInstalled(): Promise<boolean> {
  try {
    const cmd = process.platform === 'win32' ? 'where claude' : 'which claude';
    await execAsync(cmd, { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export class ClaudeAuthProvider implements IAuthProvider {
  private cachedToken: string | undefined;
  private lastStatus: 'ok' | 'missing' | 'expired' = 'ok';

  async resolveToken(): Promise<string | undefined> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    // 1. API Key (highest priority — matches Claude Code CLI behaviour)
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (apiKey) {
      this.cachedToken = apiKey;
      this.lastStatus = 'ok';
      return apiKey;
    }

    // 2. OAuth credentials file
    const credsPath = getCredentialsPath();
    try {
      const raw = await fs.readFile(credsPath, 'utf-8');
      const creds: ClaudeCredentials = JSON.parse(raw);
      const token = creds.claudeAiOauth?.accessToken;
      if (!token) {
        log(`Claude credentials file exists but accessToken is empty: ${credsPath}`);
        this.lastStatus = 'missing';
        return undefined;
      }
      if (isTokenExpired(creds)) {
        log(`Claude OAuth token expired at ${creds.claudeAiOauth?.expiresAt} (path: ${credsPath})`);
        this.cachedToken = undefined;
        this.lastStatus = 'expired';
        // Return the expired token anyway so the scheduler can attempt the API
        // call. If Claude Code has refreshed the token in the meantime, the file
        // read above already got the new one. If not, the API will return 401
        // and the scheduler falls back to local data.
        return token;
      }
      this.cachedToken = token;
      this.lastStatus = 'ok';
      return token;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOENT') {
        log(`Claude credentials file not found: ${credsPath}`);
      } else {
        log(`Claude auth read error from ${credsPath}: ${(err as Error).message}`);
      }
      this.lastStatus = 'missing';
      return undefined;
    }
  }

  getAuthStatus(): 'missing' | 'expired' | 'unknown' {
    return this.lastStatus === 'ok' ? 'unknown' : this.lastStatus;
  }

  async startLoginFlow(): Promise<boolean> {
    try {
      const installed = await isClaudeInstalled();
      if (!installed) {
        const msg = 'Claude Code is not installed on this system. Install it first, or switch to another provider in the Dashboard.';
        const openDashboard = 'Open Dashboard';
        const result = await vscode.window.showInformationMessage(msg, openDashboard);
        if (result === openDashboard) {
          vscode.commands.executeCommand('aiStatusHub.showDashboard');
        }
        return false;
      }

      const terminal = vscode.window.createTerminal('Claude Login');
      terminal.sendText('claude login', true);
      terminal.show();

      // Poll for token for up to 120 seconds
      const deadline = Date.now() + 120_000;
      const interval = 3000;
      while (Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, interval));
        const token = await this.resolveToken();
        if (token) {
          void vscode.window.showInformationMessage('Claude sign-in successful.');
          return true;
        }
      }

      void vscode.window.showWarningMessage('Claude sign-in timed out. Please try again.');
      return false;
    } catch (err) {
      log(`Claude startLoginFlow error: ${(err as Error).message}`);
      void vscode.window.showErrorMessage(`Claude sign-in failed: ${(err as Error).message}`);
      return false;
    }
  }

  invalidate(): void {
    this.cachedToken = undefined;
    this.lastStatus = 'ok';
  }
}
