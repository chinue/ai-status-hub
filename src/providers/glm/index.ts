// DESIGN: v2-provider-abstraction.md#glm-provider
// AGENTS: keep-minimal
// Local usage and read-only personal Coding Plan quota queries.

import { IProvider, IUIProvider, Currency } from '../base/types';
import { ClaudeLocalParser } from '../claude/localParser';
import { GlmAuthProvider } from './auth';
import { GlmApiProvider } from './api';
import { GlmPricingProvider } from './pricing';

const CNY: Currency = { code: 'CNY', symbol: '¥' };

const glmUIProvider: IUIProvider = {
  mainIcon: '🧠',
  statusBarName: 'GLM Code Usage',
  dashboardTitle: 'GLM Dashboard',
  displayName: 'GLM',
  officialUrl: 'https://docs.bigmodel.cn/cn/guide/start/pricing',
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
    pricing: new GlmPricingProvider(),
    ui: glmUIProvider,
  };
}
