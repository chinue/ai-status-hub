import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { ConfigService } from '../src/config';
import { pricingModelKey } from '../src/calc';
import { ClaudePricingProvider } from '../src/providers/claude/pricing';
import { CodexPricingProvider } from '../src/providers/codex/pricing';
import { KimiPricingProvider, kimiModelFamily } from '../src/providers/kimi/pricing';
import manifest from '../package.json';

const fields = ['inputPerMillion', 'outputPerMillion', 'cacheReadPerMillion', 'cacheCreatePerMillion'];
const cases: Array<[string, string, string, number[]]> = [
  ['claude', 'claude-fable-5-1', 'claudeFable5_1', [10, 50, 0.25, 12.5]],
  ['claude', 'claude-mythos-5-1', 'claudeFable5_1', [10, 50, 0.25, 12.5]],
  ['claude', 'claude-mythos-5', 'claudeFable', [10, 50, 1, 12.5]],
  ['claude', 'claude-fable-5', 'claudeFable', [10, 50, 1, 12.5]],
  ['claude', 'claude-opus-5-5', 'claudeOpus5_5', [4, 20, 0.2, 5]],
  ['claude', 'claude-sonnet-5-5', 'claudeSonnet5_5', [2, 10, 0.1, 2.5]],
  ['claude', 'claude-sonnet-5', 'claudeSonnet5', [2, 10, 0.2, 2.5]],
  ['claude', 'claude-sonnet-4-6', 'claudeSonnet', [3, 15, 0.3, 3.75]],
  ['claude', 'claude-haiku-5-5', 'claudeHaiku5_5', [0.1, 0.5, 0.01, 0.125]],
  ['claude', 'claude-haiku-4-5', 'claudeHaiku', [1, 5, 0.1, 1.25]],
  ['codex', 'gpt-6.1-sol', 'gpt6_1Sol', [2, 10, 0.1, 2.5]],
  ['codex', 'gpt-6-sol', 'gpt6Sol', [2, 10, 0.2, 2.5]],
  ['codex', 'gpt-6-astra', 'gpt6Astra', [10, 50, 1, 12.5]],
  ['codex', 'gpt-6-luna', 'gpt6Luna', [0.1, 0.5, 0.01, 0.125]],
  ['codex', 'gpt-5.6-sol', 'gpt5_6Sol', [4, 20, 0.4, 5]],
  ['codex', 'gpt-5.6', 'gpt5_6Sol', [4, 20, 0.4, 5]],
  ['kimi', 'kimi-k3.1-pro', 'k3_1Pro', [13, 68, 1.3, 13]],
  ['kimi', 'kimi-k3.1-pro-highspeed', 'k3_1ProHighspeed', [26, 136, 1.3, 26]],
  ['kimi', 'kimi-k2.7-code', 'k2_7Code', [6.5, 27, 1.3, 6.5]],
  ['kimi', 'kimi-k2.7-code-highspeed', 'k2_7CodeHighspeed', [13, 54, 2.6, 13]],
  ['kimi', 'kimi-k3', 'k3', [20, 100, 2, 20]],
  ['kimi', 'kimi-k2.6', 'k2_6', [6.5, 27, 1.1, 6.5]],
];

describe('official model pricing (2026-10-25)', () => {
  const config = ConfigService.getInstance();
  let overrides: Record<string, unknown>;
  beforeEach(() => {
    overrides = {};
    const properties = manifest.contributes.configuration.properties as Record<string, { default?: unknown }>;
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => overrides[key] ?? properties[`aiStatusHub.${key}`]?.default ?? fallback,
    } as any);
  });
  afterEach(() => { sinon.restore(); config.setActiveProviderId('codex'); });

  for (const [provider, model, key, rates] of cases) {
    it(`resolves ${model} to its registered prices and computes cost`, () => {
      config.setActiveProviderId(provider);
      expect(pricingModelKey(model)).to.equal(key);
      if (provider === 'kimi') expect(kimiModelFamily(model)).to.equal(key);
      const pricingProvider = provider === 'kimi' ? new KimiPricingProvider()
        : provider === 'claude' ? new ClaudePricingProvider() : new CodexPricingProvider();
      const pricing = pricingProvider.getPricing(model);
      expect(pricing).to.deep.equal(Object.fromEntries(fields.map((field, i) => [field, rates[i]])));
      expect(pricingProvider.calculateCost({ inputOther: 1e6, output: 1e6, inputCacheRead: 1e6, inputCacheCreation: 1e6 }, pricing))
        .to.be.closeTo(rates.reduce((sum, rate) => sum + rate, 0), 1e-9);
    });
  }

  it('supports display names, provider prefixes, snapshots and version boundaries', () => {
    for (const [name, key] of [
      ['Claude Sonnet 5.5', 'claudeSonnet5_5'], ['claude-haiku-5-5-20261001', 'claudeHaiku5_5'],
      ['Claude Fable 5.1', 'claudeFable5_1'], ['GPT-6.1 Sol', 'gpt6_1Sol'],
      ['kimi-code/k3.1-pro-highspeed', 'k3_1ProHighspeed'], ['kimi-code/k2.7-code', 'k2_7Code'],
      ['claude-opus-5-50', 'claudeOpus'], ['claude-sonnet-5-50', 'claudeSonnet'],
    ]) expect(pricingModelKey(name)).to.equal(key);
  });

  it('preserves custom prices and provider-specific overrides', () => {
    config.setActiveProviderId('codex');
    overrides['pricing.codex.models.gpt6_1Sol.inputPerMillion'] = 0;
    expect(config.getPricing('gpt-6.1-sol').inputPerMillion).to.equal(0);
    overrides['pricing.customModels'] = { 'gpt-6.1-sol': '7,8,9,10' };
    expect(config.getPricing('gpt-6.1-sol')).to.deep.equal({
      inputPerMillion: 7, outputPerMillion: 8, cacheReadPerMillion: 9, cacheCreatePerMillion: 10,
    });
  });
});
