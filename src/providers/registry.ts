// DESIGN: v2-provider-abstraction.md#provider-registry
// AGENTS: keep-minimal

import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IProvider } from './base/types';
import { createCodexProvider } from './codex';
import { createKimiProvider } from './kimi';
import { createClaudeProvider } from './claude';
import { createVolcengineProvider } from './volcengine';
import { createGlmProvider } from './glm';
import { createDeepseekProvider } from './deepseek';
import { createCursorProvider } from './cursor';

export interface ProviderInfo {
  id: string;
  displayName: string;
  displayNameZh: string;
  create: () => IProvider;
}

const PROVIDERS: ProviderInfo[] = [
  { id: 'codex', displayName: 'Codex', displayNameZh: 'Codex', create: createCodexProvider },
  { id: 'kimi', displayName: 'Kimi', displayNameZh: 'Kimi', create: createKimiProvider },
  { id: 'claude', displayName: 'Claude', displayNameZh: 'Claude', create: createClaudeProvider },
  { id: 'glm', displayName: 'GLM', displayNameZh: '智谱', create: createGlmProvider },
  { id: 'volcengine', displayName: '火山', displayNameZh: '火山', create: createVolcengineProvider },
  { id: 'deepseek', displayName: 'DeepSeek', displayNameZh: 'DeepSeek', create: createDeepseekProvider },
  { id: 'cursor', displayName: 'Cursor', displayNameZh: 'Cursor', create: createCursorProvider },
];

export function getProvider(id: string): IProvider | undefined {
  const info = PROVIDERS.find((p) => p.id === id);
  return info?.create();
}

export function listProviders(): ProviderInfo[] {
  return PROVIDERS.slice();
}

export function getProviderInfo(id: string): ProviderInfo | undefined {
  return PROVIDERS.find((p) => p.id === id);
}

/**
 * Auto-detect which provider to use based on the presence of local session directories.
 */
export async function detectProvider(): Promise<string> {
  const home = os.homedir();
  const checks = [
    { id: 'codex', dir: path.join(home, '.codex', 'sessions') },
    { id: 'kimi', dir: path.join(home, '.kimi', 'sessions') },
    { id: 'claude', dir: path.join(home, '.claude') },
  ];

  for (const check of checks) {
    try {
      await fs.access(check.dir);
      return check.id;
    } catch {
      // continue
    }
  }

  return 'codex'; // fallback
}

export function resolveProviderId(configured: string): Promise<string> {
  if (configured !== 'auto') {
    return Promise.resolve(configured);
  }
  return detectProvider();
}
