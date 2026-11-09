// DESIGN: v2-provider-abstraction.md#glm-pricing
import { IPricingProvider, TokenPricing, TokenUsage } from '../base/types';
import { ConfigService } from '../../config';
import { calculateCost, pricingModelKey } from '../../calc';

// Standard domestic API list prices, CNY per million tokens, checked 2026-11-09.
// Cache creation tokens use the ordinary input rate; storage duration/tool fees are not included.
export const DEFAULT_GLM_PRICING: Record<string, TokenPricing> = {
  glm5_3: { inputPerMillion: 8, outputPerMillion: 28, cacheReadPerMillion: 2, cacheCreatePerMillion: 8 },
  glm5_2: { inputPerMillion: 8, outputPerMillion: 28, cacheReadPerMillion: 2, cacheCreatePerMillion: 8 },
  glm5_3Flash: { inputPerMillion: 0.8, outputPerMillion: 2.8, cacheReadPerMillion: 0.23, cacheCreatePerMillion: 0.8 },
  glm5_3FlashX: { inputPerMillion: 2, outputPerMillion: 7, cacheReadPerMillion: 0.57, cacheCreatePerMillion: 2 },
};

export class GlmPricingProvider implements IPricingProvider {
  readonly currency = { code: 'CNY', symbol: '¥' };
  readonly defaultModelName = 'glm-5.3';
  getPricing(modelName: string): TokenPricing {
    const key = pricingModelKey(modelName);
    const defaults = DEFAULT_GLM_PRICING[key] ?? DEFAULT_GLM_PRICING.glm5_3;
    return ConfigService.getInstance().getPricing(modelName, 'glm', defaults);
  }
  calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
    return calculateCost(usage, pricing);
  }
}
