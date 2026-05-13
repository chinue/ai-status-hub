// DESIGN: v2-provider-abstraction.md#codex-provider
// AGENTS: keep-minimal

import { IProvider } from '../base/types';
import { CodexAuthProvider } from './auth';
import { CodexApiProvider } from './api';
import { CodexLocalParser } from './localParser';
import { CodexPricingProvider } from './pricing';
import { codexUIProvider } from './ui';

export function createCodexProvider(): IProvider {
  return {
    id: 'codex',
    displayName: 'Codex',
    currency: { code: 'USD', symbol: '$' },
    auth: new CodexAuthProvider(),
    api: new CodexApiProvider(),
    localUsage: new CodexLocalParser(),
    pricing: new CodexPricingProvider(),
    ui: codexUIProvider,
  };
}
