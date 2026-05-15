// AGENTS: fmt->calc.ts | err->try-catch | no-disk-IO
import * as vscode from 'vscode';

const SECRET_API_KEY = 'aiStatusHub.apiKey';
const SECRET_OAUTH = 'aiStatusHub.oauthCredentials';

let outputChannel: vscode.OutputChannel | undefined;

export function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel) {
    outputChannel = vscode.window.createOutputChannel('AI Status Hub');
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

export async function readApiKey(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_API_KEY);
}

export async function readOAuth(secrets: vscode.SecretStorage): Promise<string | undefined> {
  return secrets.get(SECRET_OAUTH);
}

export async function deleteOAuth(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SECRET_OAUTH);
}
