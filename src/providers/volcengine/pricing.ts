// DESIGN: v2-provider-abstraction.md#volcengine-pricing
import { IPricingProvider, TokenPricing, TokenUsage } from '../base/types';
import { ConfigService } from '../../config';
import { calculateCost, pricingModelKey, isVolcenginePeak } from '../../calc';

// CNY / million tokens. Official Ark price list checked 2026-11-16.
// K2.8 Preview has no verified public API rate: count tokens, allow custom rates.
export const DEFAULT_VOLCENGINE_PRICING: Record<string, TokenPricing> = {
  glm5_3Flash: { inputPerMillion: 0.8, outputPerMillion: 2.8, cacheReadPerMillion: 0.23, cacheCreatePerMillion: 0.8 },
  k3_1Pro: { inputPerMillion: 13, outputPerMillion: 68, cacheReadPerMillion: 1.3, cacheCreatePerMillion: 13 },
  k2_8Preview: { inputPerMillion: 0, outputPerMillion: 0, cacheReadPerMillion: 0, cacheCreatePerMillion: 0 },
  deepseekV4_1FlashEconomy: { inputPerMillion: 0.8, outputPerMillion: 3.2, cacheReadPerMillion: 0.016, cacheCreatePerMillion: 0.8 },
  deepseekV4_1FlashEconomyPeak: { inputPerMillion: 1.6, outputPerMillion: 6.4, cacheReadPerMillion: 0.032, cacheCreatePerMillion: 1.6 },
};

export class VolcenginePricingProvider implements IPricingProvider {
  readonly currency = { code: 'CNY', symbol: '¥' };
  readonly defaultModelName = 'glm-5.3-flash';
  getPricing(modelName: string, timestamp?: number): TokenPricing {
    let key = pricingModelKey(modelName, 'volcengine');
    if (key === 'deepseekV4_1FlashEconomy' && isVolcenginePeak(timestamp ?? Date.now())) key += 'Peak';
    const defaults = DEFAULT_VOLCENGINE_PRICING[key] ?? DEFAULT_VOLCENGINE_PRICING.k2_8Preview;
    return ConfigService.getInstance().getPricing(modelName, 'volcengine', defaults, key);
  }
  calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
    return calculateCost(usage, pricing);
  }
}
