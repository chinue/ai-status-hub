import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { ClaudeLocalParser } from '../src/providers/claude/localParser';
import { KimiLocalParser } from '../src/providers/kimi/localParser';
import { createGlmProvider } from '../src/providers/glm';
import { LocalUsageService } from '../src/services/localUsageService';
import { createKimiProvider } from '../src/providers/kimi';
import { claudeLogProvider } from '../src/calc';

describe('Claude log model routing', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'claude-routing-')); });
  afterEach(() => { fs.rmSync(root, { recursive: true, force: true }); });

  function record(model: unknown, id: string, timestamp = Date.now()) {
    return { type: 'assistant', timestamp: new Date(timestamp).toISOString(), requestId: id,
      message: { id, model, usage: { input_tokens: 100, output_tokens: 20,
        cache_read_input_tokens: 30, cache_creation_input_tokens: 40 } } };
  }
  function write(name: string, lines: unknown[]) {
    const file = path.join(root, name);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, lines.map(line => JSON.stringify(line)).join('\n') + '\n', 'utf8');
    return file;
  }

  it('recognizes model families and namespaces without guessing hidden aliases', () => {
    for (const model of ['kimi-k2.6', ' KIMI-K3 ', 'moonshotai/Kimi-K2-Instruct', 'kimi-code/k3']) {
      expect(claudeLogProvider(model)).to.equal('kimi');
    }
    for (const model of ['glm-4.7', 'GLM-5', 'z-ai/glm-4.5-air']) {
      expect(claudeLogProvider(model)).to.equal('glm');
    }
    for (const model of [undefined, null, 42, '', 'claude-sonnet-4', 'custom-proxy', 'not-kimi-model']) {
      expect(claudeLogProvider(model)).to.equal('claude');
    }
  });

  it('routes mixed logs exclusively and preserves all token categories', async () => {
    write('project/session.jsonl', [record('claude-sonnet-4', 'c'), record('kimi-k2.6', 'k'),
      record('z-ai/GLM-4.7', 'g'), record(undefined, 'legacy')]);
    for (const [provider, ids] of [['claude', ['c', 'legacy']], ['kimi', ['k']], ['glm', ['g']]] as const) {
      const entries = await new ClaudeLocalParser(provider, root).scanSessions();
      expect(entries.map(e => e.messageId)).to.deep.equal(ids);
      expect(entries[0]).to.include({ inputOther: 100, output: 20, inputCacheRead: 30, inputCacheCreation: 40 });
    }
  });

  it('scans nested subagents, deduplicates requests across files and applies retention', async () => {
    const k = record('kimi-k3', 'k');
    write('project/session.jsonl', [k, { ...k, message: { ...k.message, id: 'other-block' } },
      record('kimi-k3', 'old', Date.now() - 3 * 86400000)]);
    write('project/session/subagents/agent.jsonl', [k, record('kimi-k3', 'sub')]);
    const entries = await new ClaudeLocalParser('kimi', root).scanSessions({ dataRetentionDays: 1 });
    expect(entries.map(e => e.messageId)).to.have.members(['k', 'sub']);
  });

  it('ignores malformed logs and handles cache refresh, invalidation and deletion', async () => {
    const file = write('project/session.jsonl', [null, {}, record('glm-4', 'g')]);
    fs.appendFileSync(file, '{broken\n');
    const parser = new ClaudeLocalParser('glm', root);
    expect(await parser.scanSessions()).to.have.length(1);
    expect(await parser.scanSessions()).to.have.length(1);
    fs.appendFileSync(file, JSON.stringify(record('glm-5', 'g2')) + '\n');
    expect(await parser.scanSessions()).to.have.length(2);
    parser.invalidate();
    expect(await parser.scanSessions()).to.have.length(2);
    fs.unlinkSync(file);
    expect(await parser.scanSessions()).to.deep.equal([]);
    expect(await new ClaudeLocalParser('kimi', path.join(root, 'missing')).scanSessions()).to.deep.equal([]);
  });

  it('merges native Kimi and Claude Kimi records once and uses Kimi pricing', async () => {
    write('project/session.jsonl', [record('kimi-k2.6', 'shared'), record('claude-sonnet-4', 'c')]);
    const native = write('native/session/wire.jsonl', [{ timestamp: Date.now() / 1000,
      message: { type: 'StatusUpdate', payload: { message_id: 'shared', token_usage: { input_other: 100,
        output: 20, input_cache_read: 30, input_cache_creation: 40 }, model: 'kimi-k2.6' } } },
      { type: 'usage.record', model: 'kimi-code/k3', time: Date.now(), usageScope: 'turn',
        usage: { inputOther: 5, output: 6, inputCacheRead: 7, inputCacheCreation: 8 } }]);
    const provider = createKimiProvider();
    provider.localUsage = new KimiLocalParser([path.join(root, 'native')], new ClaudeLocalParser('kimi', root));
    const service = new LocalUsageService();
    service.setProvider(provider);
    const usage = await service.getLocalUsage();
    expect(usage.entries).to.have.length(2);
    expect(usage.tokensToday).to.equal(105);
    const expected = usage.entries.reduce((sum, entry) => sum + provider.pricing.calculateCost(entry,
      provider.pricing.getPricing(entry.model!)), 0);
    expect(usage.costToday).to.be.closeTo(expected, 1e-10);
    provider.localUsage.invalidate();
    fs.unlinkSync(native);
    expect(await provider.localUsage.scanSessions()).to.have.length(1);
  });

  it('connects GLM local usage to the Claude log scanner', () => {
    expect(createGlmProvider().localUsage).to.be.instanceOf(ClaudeLocalParser);
  });
});
