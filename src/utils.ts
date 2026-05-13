// AGENTS: fmt->calc.ts | err->try-catch | no-disk-IO
import * as vscode from 'vscode';

const SECRET_API_KEY = 'codexStatusPro.apiKey';
const SECRET_OAUTH = 'codexStatusPro.oauthCredentials';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('CodexStatusPro');
  }
  return outputChannel;
}

export function log(message: string): void {
  const ts = new Date().toLocaleString('zh-CN', { hour12: false });
  getOutputChannel().appendLine(`[${ts}] ${message}`);
}

export async function writeApiKey(secrets: vscode.SecretStorage, key: string): Promise<void> {
  await secrets.store(SECRET_API_KEY, key);
}

export async function deleteApiKey(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_API_KEY);
}

export async function deleteOAuth(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_OAUTH);
}
