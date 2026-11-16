// DESIGN: v2-test-design.md#bounded-jsonl-reading
import { expect } from 'chai';
import * as sinon from 'sinon';
import * as fs from 'fs';
const fsp = require('fs/promises');
import * as os from 'os';
import * as path from 'path';
import { LocalUsageService } from '../src/services/localUsageService';
import { ClaudeLocalParser } from '../src/providers/claude/localParser';
import { KimiLocalParser } from '../src/providers/kimi/localParser';
import { CodexLocalParser } from '../src/providers/codex/localParser';

describe('Bounded JSONL reading', () => {
  let root: string;
  beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'bounded-jsonl-')); });
  afterEach(() => { sinon.restore(); fs.rmSync(root, { recursive: true, force: true }); });
  it('streams UTF-8, CRLF, chunk boundaries and a final line without a newline', async () => {
    const file = path.join(root, 'lines.jsonl');
    const values = ['start!', '中'.repeat(24000), 'tail'];
    fs.writeFileSync(file, values.join('\r\n'));
    const read = sinon.stub(fsp, 'readFile').rejects(new Error('Whole-file reads are forbidden'));
    const lines: string[] = [];
    const result = await (LocalUsageService as any).readJsonl(file, (line: string) => lines.push(line));
    expect(result).not.to.equal(null);
    expect(lines).to.deep.equal(values);
    expect(read.called).to.equal(false);
  });
  it('drops an oversized record without retaining it or losing subsequent valid records', async () => {
    const file = path.join(root, 'large.jsonl');
    fs.writeFileSync(file, 'valid\n' + 'x'.repeat(200000) + '\nnext\n' + 'y'.repeat(1000));
    const lines: string[] = [];
    const result = await (LocalUsageService as any).readJsonl(file, (line: string) => lines.push(line), 128);
    expect(lines).to.deep.equal(['valid', 'next']);
    expect(result.skippedLines).to.equal(2);
    const digestOnly = await (LocalUsageService as any).readJsonl(file);
    expect(digestOnly.fingerprint).to.equal(result.fingerprint);
  });
  it('returns a safe failure for missing files and callback errors', async () => {
    expect(await (LocalUsageService as any).readJsonl(path.join(root, 'missing'))).to.equal(null);
    const file = path.join(root, 'bad.jsonl');
    fs.writeFileSync(file, '{}\n');
    expect(await (LocalUsageService as any).readJsonl(file, () => { throw new Error('fixture'); })).to.equal(null);
  });
  it('parses Claude usage without whole-file reads and preserves cached data on read failure', async () => {
    const file = path.join(root, 'claude.jsonl');
    fs.writeFileSync(file, JSON.stringify({ type: 'assistant', timestamp: new Date().toISOString(),
      message: { id: 'c', model: 'claude-sonnet-4', usage: { input_tokens: 12, output_tokens: 3 } } }) + '\n');
    sinon.stub(fsp, 'readFile').rejects(new Error('Whole-file reads are forbidden'));
    const parser = new ClaudeLocalParser('claude', root);
    expect((await parser.scanSessions()).map(e => e.inputOther)).to.deep.equal([12]);
    const reader = sinon.stub(LocalUsageService as any, 'readJsonl').resolves(null);
    fs.appendFileSync(file, '{}\n');
    expect((await parser.scanSessions()).map(e => e.inputOther)).to.deep.equal([12]);
    reader.restore();
  });
  it('parses native Kimi usage without whole-file reads', async () => {
    fs.writeFileSync(path.join(root, 'wire.jsonl'), JSON.stringify({ type: 'usage.record', time: Date.now(),
      model: 'kimi-code/k3', usage: { inputOther: 12, output: 3 } }) + '\n');
    sinon.stub(fsp, 'readFile').rejects(new Error('Whole-file reads are forbidden'));
    const parser = new KimiLocalParser([root], { scanSessions: async () => [], getRateLimits: async () => null, invalidate() {} });
    expect((await parser.scanSessions()).map(e => e.inputOther)).to.deep.equal([12]);
  });
  it('streams Codex cumulative deltas, detects same-metadata rewrites, and reads rate limits', async () => {
    const file = path.join(root, 'codex.jsonl');
    const row = (input: number) => JSON.stringify({ timestamp: new Date().toISOString(), type: 'event_msg',
      payload: { type: 'token_count', rate_limits: { primary: { used_percent: 12, window_minutes: 300 } },
        info: { total_token_usage: { input_tokens: input, output_tokens: 2, cached_input_tokens: 0 } } } });
    fs.writeFileSync(file, row(10) + '\n' + row(25) + '\n');
    sinon.stub(fsp, 'readFile').rejects(new Error('Whole-file reads are forbidden'));
    const parser = new CodexLocalParser();
    const first = await (parser as any).updateFileState(file);
    expect(first.entries.map((e: any) => e.inputOther)).to.deep.equal([10, 15]);
    const stat = fs.statSync(file);
    fs.writeFileSync(file, row(10) + '\n' + row(35) + '\n');
    fs.utimesSync(file, stat.atime, stat.mtime);
    sinon.stub(fsp, 'stat').resolves({ mtimeMs: first.mtimeMs, size: first.size });
    const next = await (parser as any).updateFileState(file);
    expect(next.entries.map((e: any) => e.inputOther)).to.deep.equal([10, 25]);
    sinon.stub(parser as any, 'scanDir').resolves([file]);
    expect((await parser.getRateLimits())?.primary?.used_percent).to.equal(12);
  });
});
