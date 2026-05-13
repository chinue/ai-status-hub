// DESIGN: v2-provider-abstraction.md#codex-pricing
// AGENTS: keep-minimal | no-disk-IO

import { IPricingProvider, Currency, TokenPricing, TokenUsage } from '../base/types';
import { ConfigService } from '../../config';

export class CodexPricingProvider implements IPricingProvider {
  readonly currency: Currency = { code: 'USD', symbol: '$' };
  readonly defaultModelName = 'gpt-5';

  getPricing(modelName: string): TokenPricing {
    return ConfigService.getInstance().getPricing(modelName);
  }

  calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
    const cost = (
      (usage.inputOther / 1_000_000) * pricing.inputPerMillion +
      (usage.output / 1_000_000) * pricing.outputPerMillion +
      (usage.inputCacheRead / 1_000_000) * pricing.cacheReadPerMillion +
      (usage.inputCacheCreation / 1_000_000) * pricing.cacheCreatePerMillion
    );
    return isFinite(cost) && cost >= 0 ? cost : 0;
  }
}
