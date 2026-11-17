// DESIGN: v2-provider-abstraction.md#kimi-provider
// AGENTS: keep-minimal

import { IProvider } from '../base/types';
import { KimiAuthProvider } from './auth';
import { KimiApiProvider } from './api';
import { KimiLocalParser } from './localParser';
import { KimiPricingProvider } from './pricing';
import { kimiUIProvider } from './ui';

export function createKimiProvider(): IProvider {
  const auth = new KimiAuthProvider();
  return {
    id: 'kimi',
    displayName: 'Kimi',
    currency: { code: 'CNY', symbol: '¥' },
    auth,
    api: new KimiApiProvider(undefined, () => auth.resolveWebToken()),
    localUsage: new KimiLocalParser(),
    pricing: new KimiPricingProvider(),
    ui: kimiUIProvider,
  };
}
