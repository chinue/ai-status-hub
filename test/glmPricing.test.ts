import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { createGlmProvider } from '../src/providers/glm';
import { ConfigService } from '../src/config';
import { pricingModelKey } from '../src/calc';
import { LocalUsageService } from '../src/services/localUsageService';
import manifest from '../package.json';

describe('GLM official API-equivalent pricing', () => {
  let overrides: Record<string, unknown>;
  beforeEach(() => {
    overrides = {};
    const properties = manifest.contributes.configuration.properties as Record<string, { default?: unknown }>;
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => overrides[key] ?? properties[`aiStatusHub.${key}`]?.default ?? fallback,
    } as any);
  });
  afterEach(() => { sinon.restore(); ConfigService.getInstance().setActiveProviderId('codex'); });

  for (const [model, key, rates] of [
    ['glm-5.3', 'glm5_3', [8, 28, 2, 8]],
    ['z-ai/GLM-5.3', 'glm5_3', [8, 28, 2, 8]],
    ['flash-gateway/glm-5.3', 'glm5_3', [8, 28, 2, 8]],
    ['glm-5.3-superflash', 'glm5_3', [8, 28, 2, 8]],
    ['glm-5.3-flashxy', 'glm5_3', [8, 28, 2, 8]],
    ['glm-5.2', 'glm5_2', [8, 28, 2, 8]],
    ['glm-5.3-flash', 'glm5_3Flash', [0.8, 2.8, 0.23, 0.8]],
    ['GLM 5.3 FlashX', 'glm5_3FlashX', [2, 7, 0.57, 2]],
  ] as const) {
    it(`prices ${model} using its registered CNY rate`, () => {
      const pricing = createGlmProvider().pricing;
      expect(pricingModelKey(model)).to.equal(key);
      expect(pricing.getPricing(model)).to.deep.equal({ inputPerMillion: rates[0], outputPerMillion: rates[1],
        cacheReadPerMillion: rates[2], cacheCreatePerMillion: rates[3] });
      expect(pricing.calculateCost({ inputOther: 1e6, output: 1e6, inputCacheRead: 1e6, inputCacheCreation: 1e6 },
        pricing.getPricing(model))).to.be.closeTo(rates.reduce((a, b) => a + b, 0), 1e-9);
    });
  }
  it('respects custom prices and zero-valued provider overrides', () => {
    const pricing = createGlmProvider().pricing;
    overrides['pricing.glm.models.glm5_3.cacheReadPerMillion'] = 0;
    expect(pricing.getPricing('glm-5.3').cacheReadPerMillion).to.equal(0);
    overrides['pricing.customModels'] = { 'glm-5.3': '1,2,3,4' };
    expect(pricing.getPricing('glm-5.3')).to.deep.equal({ inputPerMillion: 1, outputPerMillion: 2,
      cacheReadPerMillion: 3, cacheCreatePerMillion: 4 });
  });
  it('uses the flagship reference for missing or unrecognized GLM model versions', () => {
    const provider = createGlmProvider();
    expect(provider.pricing.defaultModelName).to.equal('glm-5.3');
    expect(provider.pricing.getPricing('glm-5.30')).to.deep.equal(provider.pricing.getPricing('glm-5.3'));
    ConfigService.getInstance().setActiveProviderId('glm');
    expect(ConfigService.getInstance().defaultModelName).to.equal('glm-5.3');
  });
  it('recalculates the audited local tokens as API-equivalent CNY instead of the placeholder cost', async () => {
    const provider = createGlmProvider();
    provider.localUsage = { scanSessions: async () => [
      { timestamp: Date.now(), messageId: 'cline-aggregate', model: 'glm-5.3', inputOther: 145204,
        output: 9158, inputCacheRead: 4070592, inputCacheCreation: 0, cost: 0 },
      { timestamp: Date.now(), messageId: 'claude-aggregate', model: 'glm-5.3-flash', inputOther: 31023,
        output: 229, inputCacheRead: 64, inputCacheCreation: 0, cost: 0 },
    ], getRateLimits: async () => null, invalidate() {} };
    const service = new LocalUsageService([]);
    service.setProvider(provider);
    expect((await service.getLocalUsage()).costToday).to.be.closeTo(9.58471432, 1e-9);
  });
});
