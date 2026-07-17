import { expect } from 'chai';
import {
  DEFAULT_KIMI_PRICING,
  KimiPricingProvider,
  kimiModelFamily,
} from '../src/providers/kimi/pricing';

describe('kimiModelFamily', () => {
  it('maps k3 model names to the k3 family', () => {
    expect(kimiModelFamily('kimi-k3')).to.equal('k3');
    expect(kimiModelFamily('kimi-code/k3')).to.equal('k3');
    expect(kimiModelFamily('Kimi-K3')).to.equal('k3');
  });

  it('falls back to k2_6 for legacy/unknown models', () => {
    expect(kimiModelFamily('kimi-k2.6')).to.equal('k2_6');
    expect(kimiModelFamily('kimi-k2.5')).to.equal('k2_6');
    expect(kimiModelFamily('unknown')).to.equal('k2_6');
  });
});

describe('DEFAULT_KIMI_PRICING', () => {
  it('k3 matches official prices published 2026-07-16', () => {
    expect(DEFAULT_KIMI_PRICING.k3).to.deep.equal({
      inputPerMillion: 20,
      outputPerMillion: 100,
      cacheReadPerMillion: 2,
      cacheCreatePerMillion: 20,
    });
  });

  it('k2_6 keeps previous prices', () => {
    expect(DEFAULT_KIMI_PRICING.k2_6).to.deep.equal({
      inputPerMillion: 6.5,
      outputPerMillion: 27,
      cacheReadPerMillion: 1.1,
      cacheCreatePerMillion: 6.5,
    });
  });
});

describe('KimiPricingProvider', () => {
  it('keeps kimi-k2.6 as fallback for model-less legacy entries', () => {
    expect(new KimiPricingProvider().defaultModelName).to.equal('kimi-k2.6');
  });

  it('getPricing returns four numeric fields for k3', () => {
    const pricing = new KimiPricingProvider().getPricing('kimi-k3');
    expect(pricing.inputPerMillion).to.be.a('number');
    expect(pricing.outputPerMillion).to.be.a('number');
    expect(pricing.cacheReadPerMillion).to.be.a('number');
    expect(pricing.cacheCreatePerMillion).to.be.a('number');
  });

  it('calculateCost sums all token classes', () => {
    const cost = new KimiPricingProvider().calculateCost(
      { inputOther: 1_000_000, output: 1_000_000, inputCacheRead: 1_000_000, inputCacheCreation: 1_000_000 },
      DEFAULT_KIMI_PRICING.k3,
    );
    expect(cost).to.be.closeTo(20 + 100 + 2 + 20, 1e-9);
  });
});
