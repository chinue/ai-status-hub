// DESIGN: v2-provider-abstraction.md#kimi-pricing
// AGENTS: keep-minimal

import { IPricingProvider, Currency, TokenPricing, TokenUsage } from '../base/types';
import { ConfigService } from '../../config';

const CNY: Currency = { code: 'CNY', symbol: '¥' };

// Official prices (CNY per 1M tokens). k3: Kimi Open Platform, published 2026-07-16.
export const DEFAULT_KIMI_PRICING = {
  k3: {
    inputPerMillion: 20.00,
    outputPerMillion: 100.00,
    cacheReadPerMillion: 2.00,
    cacheCreatePerMillion: 20.00,
  },
  k2_6: {
    inputPerMillion: 6.50,
    outputPerMillion: 27.00,
    cacheReadPerMillion: 1.10,
    cacheCreatePerMillion: 6.50,
  },
};

export type KimiModelFamily = keyof typeof DEFAULT_KIMI_PRICING;

/** Map a model name to its pricing family. Unknown/legacy kimi models fall back to k2_6. */
export function kimiModelFamily(modelName: string): KimiModelFamily {
  return modelName.toLowerCase().includes('k3') ? 'k3' : 'k2_6';
}

export class KimiPricingProvider implements IPricingProvider {
  readonly currency = CNY;
  // Legacy wire entries carry no model field and belong to the k2.6 era,
  // so the fallback stays k2.6 to keep historical costs accurate.
  readonly defaultModelName = 'kimi-k2.6';

  getPricing(modelName: string): TokenPricing {
    // Read from config so users can customize; config.getPricing handles model family mapping
    const cfgPricing = ConfigService.getInstance().getPricing(modelName);
    return { ...DEFAULT_KIMI_PRICING[kimiModelFamily(modelName)], ...cfgPricing };
  }

  calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
    const inputCost = (usage.inputOther * pricing.inputPerMillion) / 1_000_000;
    const outputCost = (usage.output * pricing.outputPerMillion) / 1_000_000;
    const cacheReadCost = (usage.inputCacheRead * pricing.cacheReadPerMillion) / 1_000_000;
    const cacheCreateCost = (usage.inputCacheCreation * pricing.cacheCreatePerMillion) / 1_000_000;
    return inputCost + outputCost + cacheReadCost + cacheCreateCost;
  }
}
