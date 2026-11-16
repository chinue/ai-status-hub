// DESIGN: v2-provider-abstraction.md#deepseek-provider
import { IPricingProvider, TokenPricing, TokenUsage } from '../base/types';
import { ConfigService } from '../../config';
import { calculateCost, isDeepseekPeak, pricingModelKey } from '../../calc';

// Official CNY/USD rates checked 2026-11-16. Rates are per million tokens.
export class DeepseekPricingProvider implements IPricingProvider {
  readonly currency = { code: 'CNY', symbol: '¥' };
  readonly defaultModelName = 'deepseek-flash';
  getPricing(modelName: string, timestamp = Date.now()): TokenPricing {
    const config = ConfigService.getInstance();
    const key = pricingModelKey(modelName, 'deepseek');
    const usd = config.currencyForProvider('deepseek').code === 'USD';
    const peak = isDeepseekPeak(timestamp, config.deepseekOffPeakDates);
    const factor = peak ? 2 : 1;
    const values = key === 'deepseekFlash' ? (usd ? [0.15, 0.6, 0.003] : [1, 4, 0.02])
      : key === 'deepseekPro' ? (usd ? [0.66, 1.98, 0.022] : [4.5, 13.5, 0.15]) : [0, 0, 0];
    const defaults = { inputPerMillion: values[0] * factor, outputPerMillion: values[1] * factor,
      cacheReadPerMillion: values[2] * factor, cacheCreatePerMillion: values[0] * factor };
    // Peak settings are separate so a base override cannot accidentally erase the time multiplier.
    return config.getPricing(modelName, 'deepseek', defaults, key + (peak ? 'Peak' : ''));
  }
  calculateCost(usage: TokenUsage, pricing: TokenPricing): number { return calculateCost(usage, pricing); }
}
