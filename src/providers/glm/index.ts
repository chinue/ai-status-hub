// DESIGN: v2-provider-abstraction.md#glm-provider
// AGENTS: keep-minimal
// Local usage and read-only personal Coding Plan quota queries.

import { IProvider, IPricingProvider, IUIProvider, Currency, TokenPricing, TokenUsage } from '../base/types';
import { ClaudeLocalParser } from '../claude/localParser';
import { GlmAuthProvider } from './auth';
import { GlmApiProvider } from './api';

const CNY: Currency = { code: 'CNY', symbol: '¥' };

const placeholderPricing: IPricingProvider = {
  currency: CNY,
  defaultModelName: 'glm-4',
  getPricing() {
    return { inputPerMillion: 1.0, outputPerMillion: 2.0, cacheReadPerMillion: 0.5, cacheCreatePerMillion: 1.0 };
  },
  calculateCost(usage: TokenUsage, pricing: TokenPricing) {
    return (usage.inputOther * pricing.inputPerMillion + usage.output * pricing.outputPerMillion +
            usage.inputCacheRead * pricing.cacheReadPerMillion + usage.inputCacheCreation * pricing.cacheCreatePerMillion) / 1_000_000;
  },
};

const glmUIProvider: IUIProvider = {
  mainIcon: '🧠',
  statusBarName: 'GLM Code Usage',
  dashboardTitle: 'GLM Dashboard',
  displayName: 'GLM',
  officialUrl: 'https://open.bigmodel.cn/pricing',
  extensionDisplayName: 'GLMStatusPro',
};

export function createGlmProvider(): IProvider {
  const api = new GlmApiProvider();
  return {
    id: 'glm',
    displayName: 'GLM',
    currency: CNY,
    auth: new GlmAuthProvider(api),
    api,
    localUsage: new ClaudeLocalParser('glm'),
    pricing: placeholderPricing,
    ui: glmUIProvider,
  };
}
