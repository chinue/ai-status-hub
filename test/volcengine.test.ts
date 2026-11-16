import { expect } from 'chai';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createVolcengineProvider } from '../src/providers/volcengine';
import { KimiLocalParser } from '../src/providers/kimi/localParser';
import { ClaudeLocalParser } from '../src/providers/claude/localParser';
import { claudeLogProvider, normalizeStatusBarProviders, resolveClaudeLogProvider, isVolcenginePeak, pricingModelKey } from '../src/calc';
import { getProvider } from '../src/providers/registry';
import { ConfigService } from '../src/config';
import { LocalUsageService } from '../src/services/localUsageService';
import manifest from '../package.json';

describe('Volcengine Claude usage', () => {
  let root: string;
  let overrides: Record<string, unknown>;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'volcengine-'));
    sinon.useFakeTimers({ now: Date.parse('2026-11-16T12:00:00Z'), toFake: ['Date'] });
    overrides = { 'claudeLog.glmVolcengineCutover': '' };
    const properties = manifest.contributes.configuration.properties as Record<string, { default?: unknown }>;
    sinon.stub(vscode.workspace, 'getConfiguration').returns({
      get: (key: string, fallback: unknown) => overrides[key] ?? properties[`aiStatusHub.${key}`]?.default ?? fallback,
    } as any);
  });
  afterEach(() => { sinon.restore(); fs.rmSync(root, { recursive: true, force: true }); });

  it('registers the independent CNY provider and status bar choice', () => {
    expect(getProvider('volcengine')?.displayName).to.equal('火山');
    expect(normalizeStatusBarProviders(['volcengine', 'glm'])).to.deep.equal(['volcengine', 'glm']);
    expect(ConfigService.getInstance().currencyForProvider('volcengine').code).to.equal('CNY');
  });

  it('uses the requested GLM and Volcengine status bar icons', () => {
    expect(getProvider('glm')!.ui.mainIcon).to.equal('⚡');
    expect(getProvider('volcengine')!.ui.mainIcon).to.equal('🌋');
  });

  it('recognizes Ark namespaces and economy aliases without changing ambiguous bare models', () => {
    for (const name of ['volcengine/glm-5.3-flash', 'ark/kimi-k3.1-pro', 'deepseek-v4.1-flash-economy',
      'deepseek-v4-1-flash-economy-261017']) expect(claudeLogProvider(name)).to.equal('volcengine');
    expect(claudeLogProvider('glm-5.3-flash')).to.equal('glm');
    expect(claudeLogProvider('kimi-k3.1-pro')).to.equal('kimi');
  });

  it('separates identical GLM names by session and refreshes cached routing after settings change', async () => {
    const row = (sessionId: string, id: string, model = 'glm-5.3-flash') => ({ type: 'assistant',
      timestamp: new Date().toISOString(), sessionId, requestId: id,
      message: { model, usage: { input_tokens: 100, output_tokens: 20, cache_read_input_tokens: 30 } } });
    fs.writeFileSync(path.join(root, 'session.jsonl'), [row('ark-session', 'a'), row('official-session', 'b'),
      row('k-session', 'k', 'kimi-k2.6')].map(r => JSON.stringify(r)).join('\n'));
    overrides['claudeLog.sessionProviders'] = { 'ark-session': 'volcengine' };
    const ark = new ClaudeLocalParser('volcengine', root);
    const glm = new ClaudeLocalParser('glm', root);
    expect((await ark.scanSessions()).map(e => e.messageId)).to.deep.equal(['a']);
    expect((await glm.scanSessions()).map(e => e.messageId)).to.deep.equal(['b']);
    overrides['claudeLog.modelProviders'] = { 'kimi-k2.6': 'volcengine' };
    expect((await ark.scanSessions()).map(e => e.messageId)).to.deep.equal(['a', 'k']);
    expect(await new ClaudeLocalParser('kimi', root).scanSessions()).to.have.length(0);
    overrides['claudeLog.sessionProviders'] = { 'ark-session': 'glm' };
    expect((await ark.scanSessions()).map(e => e.messageId)).to.deep.equal(['k']);
    expect((await glm.scanSessions()).map(e => e.messageId)).to.deep.equal(['a', 'b']);
  });

  it('uses only valid overrides and keeps explicit namespaces authoritative', () => {
    expect(resolveClaudeLogProvider('glm-5.3-flash', 's', { s: 'bogus' }, {})).to.equal('glm');
    expect(resolveClaudeLogProvider('GLM-5.3-Flash', null, {}, { 'glm-5.3-flash': 'volcengine' })).to.equal('volcengine');
    expect(resolveClaudeLogProvider('z-ai/glm-5.3-flash', null, {}, { 'z-ai/glm-5.3-flash': 'volcengine' })).to.equal('glm');
    expect(resolveClaudeLogProvider('volcengine/glm-5.3-flash', 's', { s: 'glm' }, {})).to.equal('glm');
    expect(resolveClaudeLogProvider(null, null, {}, {})).to.equal('claude');
    expect(isVolcenginePeak(NaN)).to.equal(false);
  });

  it('routes bare GLM 5.3 records at the user cutoff including the exact boundary', async () => {
    const cutoff = '2026-11-16T13:00:00+08:00';
    const cutover = Date.parse(cutoff);
    const rows = [
      ['before', '2026-11-16T12:59:59+08:00', 'glm-5.3-flash'],
      ['boundary', cutoff, 'glm-5-3-flash'],
      ['after', '2026-11-16T13:01:00+08:00', 'glm-5.3'],
    ].map(([id, timestamp, model]) => ({ type: 'assistant', timestamp, sessionId: 'mixed-session', requestId: id,
      message: { model, usage: { input_tokens: 100, output_tokens: 20 } } }));
    fs.writeFileSync(path.join(root, 'cutover.jsonl'), rows.map(r => JSON.stringify(r)).join('\n'));
    const glm = new ClaudeLocalParser('glm', root);
    const ark = new ClaudeLocalParser('volcengine', root);
    expect(await glm.scanSessions()).to.have.length(3);
    overrides['claudeLog.glmVolcengineCutover'] = cutoff;
    expect((await glm.scanSessions()).map(e => e.messageId)).to.deep.equal(['before']);
    expect((await ark.scanSessions()).map(e => e.messageId)).to.deep.equal(['boundary', 'after']);
    overrides['claudeLog.glmVolcengineCutover'] = '';
    expect(await glm.scanSessions()).to.have.length(3);
    expect(await ark.scanSessions()).to.have.length(0);
    const context = { timestamp: cutover, glmVolcengineCutover: cutover };
    expect(resolveClaudeLogProvider('glm-5.30', null, {}, {}, context)).to.equal('glm');
    expect(resolveClaudeLogProvider('z-ai/glm-5.3', null, {}, {}, context)).to.equal('glm');
    expect(resolveClaudeLogProvider('glm-5.3', 's', { s: 'glm' }, {}, context)).to.equal('glm');
    expect(resolveClaudeLogProvider('glm-5.3', null, {}, {}, { ...context, glmVolcengineCutover: NaN })).to.equal('glm');
  });

  it('routes the audited Claude Kimi names exclusively while honoring official namespaces and overrides', () => {
    for (const model of ['kimi-k2-8-preview', 'kimi-k2.8-preview', 'kimi-k3.1-pro', ' KIMI-K3-1-PRO ',
      'kimi-k3-1-pro-261024', 'kimi-k2.8-preview[1m]']) {
      expect(resolveClaudeLogProvider(model, null, {}, {}), model).to.equal('volcengine');
    }
    for (const model of ['k3.1-pro', 'k3-1-pro', 'k3.1-pro[1m]', 'kimi-for-coding',
      'kimi-code/kimi-k3.1-pro', 'moonshotai/k3.1-pro', 'kimi-k3.1-pro-highspeed']) {
      expect(resolveClaudeLogProvider(model, null, {}, {}), model).to.equal('kimi');
    }
    expect(resolveClaudeLogProvider('kimi-k3.1-proxy', null, {}, {})).to.equal('kimi');
    expect(resolveClaudeLogProvider('kimi-k3.1-pro', 'official', { official: 'kimi' }, {})).to.equal('kimi');
    expect(resolveClaudeLogProvider('kimi-k3.1-pro', null, {}, { 'kimi-k3.1-pro': 'kimi' })).to.equal('kimi');
  });



  it('keeps official dotted GLM Flash records after the Ark cutoff in the same session', async () => {
    overrides['claudeLog.glmVolcengineCutover'] = '2026-11-16T13:00:00+08:00';
    const rows = [
      ['ark', 'glm-5-3-flash', '2026-11-16T13:58:00+08:00'],
      ['official', 'glm-5.3-flash', '2026-11-16T17:22:00+08:00'],
    ].map(([id, model, timestamp]) => ({ type: 'assistant', timestamp, sessionId: 'mixed',
      message: { id, model, usage: { input_tokens: 100, output_tokens: 20 } } }));
    fs.writeFileSync(path.join(root, 'glm-return.jsonl'), rows.map(row => JSON.stringify(row)).join('\n'));
    expect((await new ClaudeLocalParser('glm', root).scanSessions()).map(e => e.messageId)).to.deep.equal(['official']);
    expect((await new ClaudeLocalParser('volcengine', root).scanSessions()).map(e => e.messageId)).to.deep.equal(['ark']);
    const context = { timestamp: Date.now(), glmVolcengineCutover: Date.parse(overrides['claudeLog.glmVolcengineCutover'] as string) };
    expect(resolveClaudeLogProvider('glm-5.3-flash', null, {}, { 'glm-5.3-flash': 'volcengine' }, context)).to.equal('volcengine');
  });

  it('aggregates the five audited model names with separate provider prices and no duplicate requests', async () => {
    overrides['claudeLog.glmVolcengineCutover'] = '2026-11-16T13:00:00+08:00';
    overrides['pricing.volcengine.models.k2_8Preview.inputPerMillion'] = 3;
    overrides['pricing.volcengine.models.k2_8Preview.outputPerMillion'] = 5;
    overrides['pricing.volcengine.models.k2_8Preview.cacheReadPerMillion'] = 7;
    overrides['pricing.volcengine.models.k2_8Preview.cacheCreatePerMillion'] = 11;
    overrides['pricing.kimi.models.k3_1Pro.inputPerMillion'] = 99;
    const data = [
      ['d', 'deepseek-v4-1-flash-economy', '2026-11-16T13:57:46+08:00'],
      ['k2', 'kimi-k2-8-preview', '2026-11-16T14:32:16+08:00'],
      ['k3', 'kimi-k3.1-pro', '2026-11-16T14:32:37+08:00'],
      ['official', 'k3.1-pro', '2026-11-16T14:37:15+08:00'],
      ['coding', 'kimi-for-coding', '2026-11-16T14:37:31+08:00'],
      ['g-before', 'glm-5.3-flash', '2026-11-16T12:59:59+08:00'],
      ['g-after', 'glm-5-3-flash', '2026-11-16T13:58:00+08:00'],
      ['c', 'claude-sonnet-4', '2026-11-16T14:40:00+08:00'],
    ];
    const rows = data.map(([id, model, timestamp]) => ({ type: 'assistant', timestamp, sessionId: 'mixed',
      message: { id, model, usage: { input_tokens: 100, output_tokens: 20,
        cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } } }));
    fs.writeFileSync(path.join(root, 'audited.jsonl'), [...rows, rows[2]].map(r => JSON.stringify(r)).join('\n'));
    const seen: string[] = [];
    for (const [providerId, ids, expectedCost] of [
      ['volcengine', ['d', 'k2', 'k3', 'g-after'], 0.00462038],
      ['kimi', ['official', 'coding'], 0.013302],
      ['glm', ['g-before'], 0.0001749],
      ['claude', ['c'], undefined],
    ] as const) {
      const provider = getProvider(providerId)!;
      provider.localUsage = new ClaudeLocalParser(providerId, root);
      const service = new LocalUsageService([]);
      service.setProvider(provider);
      const usage = await service.getLocalUsage();
      expect(usage.entries.map(e => e.messageId), providerId).to.have.members([...ids]);
      expect(usage.requestsToday).to.equal(ids.length);
      if (expectedCost !== undefined) expect(usage.costToday, providerId).to.be.closeTo(expectedCost, 1e-10);
      seen.push(...usage.entries.map(e => e.messageId!));
    }
    expect(seen).to.have.length(data.length);
    expect(new Set(seen).size).to.equal(data.length);
  });

  it('preserves official native Kimi usage even when its normalized name matches the Ark alias', async () => {
    fs.writeFileSync(path.join(root, 'wire.jsonl'), JSON.stringify({ type: 'usage.record',
      model: 'kimi-code/k3.1-pro', time: Date.now(), usageScope: 'turn',
      usage: { inputOther: 100, output: 20, inputCacheRead: 30, inputCacheCreation: 40 } }));
    const parser = new KimiLocalParser([root], new ClaudeLocalParser('kimi', root));
    const entries = await parser.scanSessions();
    expect(entries).to.have.length(1);
    expect(entries[0].model).to.equal('kimi-k3.1-pro');
    expect(await new ClaudeLocalParser('volcengine', root).scanSessions()).to.have.length(0);
  });

  it('prices supported aliases, preserves unknown-price tokens and respects private overrides', () => {
    const p = createVolcengineProvider().pricing;
    expect(p.getPricing('ark/glm-5-3-flash-260828')).to.include({ inputPerMillion: 0.8, outputPerMillion: 2.8, cacheReadPerMillion: 0.23 });
    expect(p.getPricing('kimi-k3-1-pro-261024')).to.include({ inputPerMillion: 13, outputPerMillion: 68, cacheReadPerMillion: 1.3 });
    expect(p.getPricing('kimi-k2.8-preview').outputPerMillion).to.equal(0);
    expect(p.getPricing(' KIMI-K2-8-PREVIEW[1m] ').outputPerMillion).to.equal(0);
    expect(p.getPricing('unknown').outputPerMillion).to.equal(0);
    expect(pricingModelKey('kimi-k2.8-preview')).to.equal('k2_6');
    expect(p.getPricing('deepseek-v4-1-flash-economy').inputPerMillion).to.equal(0.8);
    overrides['pricing.volcengine.models.k2_8Preview.outputPerMillion'] = 27;
    expect(p.getPricing('kimi-k2.8-preview').outputPerMillion).to.equal(27);
    expect(p.getPricing(' KIMI-K2-8-PREVIEW[1m] ').outputPerMillion).to.equal(27);
    overrides['pricing.volcengine.models.glm5_3Flash.inputPerMillion'] = 9;
    expect(p.getPricing('glm-5.3-flash').inputPerMillion).to.equal(9);
    expect(getProvider('glm')!.pricing.getPricing('glm-5.3-flash').inputPerMillion).to.equal(0.8);
  });

  it('calculates economy peak and off-peak prices per record in Beijing time', async () => {
    const provider = createVolcengineProvider();
    const entries = ['2026-11-16T00:59:59Z', '2026-11-16T01:00:00Z', '2026-11-16T04:00:00Z',
      '2026-11-16T06:00:00Z', '2026-11-16T10:00:00Z', '2026-11-15T01:00:00Z'].map((date, i) => ({
      timestamp: Date.parse(date), messageId: String(i), model: 'deepseek-v4.1-flash-economy',
      inputOther: 1e6, output: 1e6, inputCacheRead: 1e6, inputCacheCreation: 0, cost: 0,
    }));
    provider.localUsage = { scanSessions: async () => entries, getRateLimits: async () => null, invalidate() {} };
    const service = new LocalUsageService([]);
    service.setProvider(provider);
    const usage = await service.getLocalUsage();
    expect(usage.entries.sort((a, b) => Number(a.messageId) - Number(b.messageId)).map(e => e.cost)).to.deep.equal([4.016, 8.032, 4.016, 8.032, 4.016, 4.016]);
  });
});
