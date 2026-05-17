// DESIGN: v2-provider-abstraction.md#claude-auth
// AGENTS: err->try-catch | disk-OK
// 🔀 Provider boundary: reads ~/.claude/.credentials.json (Claude OAuth format)

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import * as vscode from 'vscode';
import { exec } from 'child_process';
import { promisify } from 'util';
import { IAuthProvider } from '../base/types';
import { log } from '../../utils';

const execAsync = promisify(exec);
const DEFAULT_CREDENTIALS_PATH = path.join(os.homedir(), '.claude', '.credentials.json');

interface ClaudeCredentials {
  claudeAiOauth?: {
    accessToken: string;
    expiresAt: number;
  };
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

  async resolveToken(): Promise<string | undefined> {
    if (this.cachedToken) {
      return this.cachedToken;
    }

    try {
      const raw = await fs.readFile(DEFAULT_CREDENTIALS_PATH, 'utf-8');
      const creds: ClaudeCredentials = JSON.parse(raw);
      const token = creds.claudeAiOauth?.accessToken;
      if (!token) {
        return undefined;
      }
      if (isTokenExpired(creds)) {
        log('Claude OAuth token has expired');
        this.cachedToken = undefined;
        return undefined;
      }
      this.cachedToken = token;
      return token;
    } catch (err) {
      log(`Claude auth read error: ${(err as Error).message}`);
      return undefined;
    }
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
  }
}
