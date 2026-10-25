// DESIGN: v2-provider-abstraction.md#claude-pricing
// AGENTS: keep-minimal

import { IPricingProvider, Currency, TokenPricing, TokenUsage } from '../base/types';
import { ConfigService } from '../../config';
import { pricingModelKey } from '../../calc';

const USD: Currency = { code: 'USD', symbol: '$' };

export const DEFAULT_CLAUDE_PRICING = {
  fable5_1: {
    inputPerMillion: 10, outputPerMillion: 50, cacheReadPerMillion: 0.25, cacheCreatePerMillion: 12.5,
  },
  sonnet5_5: {
    inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.1, cacheCreatePerMillion: 2.5,
  },
  sonnet5: {
    inputPerMillion: 2, outputPerMillion: 10, cacheReadPerMillion: 0.2, cacheCreatePerMillion: 2.5,
  },
  haiku5_5: {
    inputPerMillion: 0.1, outputPerMillion: 0.5, cacheReadPerMillion: 0.01, cacheCreatePerMillion: 0.125,
  },
  fable: {
    inputPerMillion: 10.00,
    outputPerMillion: 50.00,
    cacheReadPerMillion: 1.00,
    cacheCreatePerMillion: 12.50,
  },
  opus5_5: {
    inputPerMillion: 4.00,
    outputPerMillion: 20.00,
    cacheReadPerMillion: 0.20,
    cacheCreatePerMillion: 5.00,
  },
  opus: {
    inputPerMillion: 5.00,
    outputPerMillion: 25.00,
    cacheReadPerMillion: 0.50,
    cacheCreatePerMillion: 6.25,
  },
  sonnet: {
    inputPerMillion: 3.00,
    outputPerMillion: 15.00,
    cacheReadPerMillion: 0.30,
    cacheCreatePerMillion: 3.75,
  },
  haiku: {
    inputPerMillion: 1.00,
    outputPerMillion: 5.00,
    cacheReadPerMillion: 0.10,
    cacheCreatePerMillion: 1.25,
  },
};

export class ClaudePricingProvider implements IPricingProvider {
  readonly currency = USD;
  readonly defaultModelName = 'claude-sonnet-4';

  getPricing(modelName: string): TokenPricing {
    // Read from config so users can customize; config.getPricing handles model family mapping
    const cfgPricing = ConfigService.getInstance().getPricing(modelName, 'claude');
    const m = modelName.toLowerCase();
    const key = pricingModelKey(m);
    const newDefaults: Record<string, TokenPricing> = {
      claudeFable5_1: DEFAULT_CLAUDE_PRICING.fable5_1,
      claudeSonnet5_5: DEFAULT_CLAUDE_PRICING.sonnet5_5,
      claudeSonnet5: DEFAULT_CLAUDE_PRICING.sonnet5,
      claudeHaiku5_5: DEFAULT_CLAUDE_PRICING.haiku5_5,
    };
    if (Object.prototype.hasOwnProperty.call(newDefaults, key)) {
      return { ...newDefaults[key], ...cfgPricing };
    }
    if (key === 'claudeFable') {
      return { ...DEFAULT_CLAUDE_PRICING.fable, ...cfgPricing };
    }
    if (key === 'claudeOpus5_5') {
      return { ...DEFAULT_CLAUDE_PRICING.opus5_5, ...cfgPricing };
    }
    if (m.includes('opus')) {
      return { ...DEFAULT_CLAUDE_PRICING.opus, ...cfgPricing };
    }
    if (m.includes('haiku')) {
      return { ...DEFAULT_CLAUDE_PRICING.haiku, ...cfgPricing };
    }
    // Default to sonnet pricing for anything else (including 'sonnet' and unknown models)
    return { ...DEFAULT_CLAUDE_PRICING.sonnet, ...cfgPricing };
  }

  calculateCost(usage: TokenUsage, pricing: TokenPricing): number {
    const inputCost = (usage.inputOther * pricing.inputPerMillion) / 1_000_000;
    const outputCost = (usage.output * pricing.outputPerMillion) / 1_000_000;
    const cacheReadCost = (usage.inputCacheRead * pricing.cacheReadPerMillion) / 1_000_000;
    const cacheCreateCost = (usage.inputCacheCreation * pricing.cacheCreatePerMillion) / 1_000_000;
    return inputCost + outputCost + cacheReadCost + cacheCreateCost;
  }
}
