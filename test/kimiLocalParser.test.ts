import { expect } from 'chai';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { KimiLocalParser, normalizeKimiModel } from '../src/providers/kimi/localParser';

function mkTmp(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'kimi-parser-'));
}

function writeFile(filePath: string, lines: unknown[]): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, lines.map(l => JSON.stringify(l)).join('\n') + '\n');
}

describe('normalizeKimiModel', () => {
  it('normalizes kimi-code aliases to canonical names', () => {
    expect(normalizeKimiModel('kimi-code/k3')).to.equal('kimi-k3');
    expect(normalizeKimiModel('kimi-k3')).to.equal('kimi-k3');
    expect(normalizeKimiModel('kimi-k2.6')).to.equal('kimi-k2.6');
  });

  it('returns undefined for missing/invalid model', () => {
    expect(normalizeKimiModel(undefined)).to.be.undefined;
    expect(normalizeKimiModel(null)).to.be.undefined;
    expect(normalizeKimiModel('')).to.be.undefined;
    expect(normalizeKimiModel(42)).to.be.undefined;
  });
});

describe('KimiLocalParser', () => {
  const tmpDirs: string[] = [];

  after(() => {
    for (const dir of tmpDirs) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function tmp(): string {
    const dir = mkTmp();
    tmpDirs.push(dir);
    return dir;
  }

  it('parses k3.0 usage.record from the new ~/.kimi-code layout', async () => {
    const root = tmp();
    const now = Date.now();
    writeFile(path.join(root, 'wd_proj_ab12', 'ses_1', 'agents', 'main', 'wire.jsonl'), [
      { type: 'metadata', protocol_version: '1.4', created_at: now },
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 100, output: 50, inputCacheRead: 200, inputCacheCreation: 10 }, usageScope: 'turn', time: now },
    ]);

    const entries = await new KimiLocalParser([root]).scanSessions();
    expect(entries).to.have.length(1);
    expect(entries[0].model).to.equal('kimi-k3');
    expect(entries[0].timestamp).to.equal(now);
    expect(entries[0].inputOther).to.equal(100);
    expect(entries[0].output).to.equal(50);
    expect(entries[0].inputCacheRead).to.equal(200);
    expect(entries[0].inputCacheCreation).to.equal(10);
    expect(entries[0].messageId).to.be.null;
  });

  it('skips usage.record with non-turn scope', async () => {
    const root = tmp();
    const now = Date.now();
    writeFile(path.join(root, 'wd_proj_ab12', 'ses_1', 'agents', 'main', 'wire.jsonl'), [
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 }, usageScope: 'session', time: now },
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 2, output: 2, inputCacheRead: 0, inputCacheCreation: 0 }, usageScope: 'turn', time: now },
    ]);

    const entries = await new KimiLocalParser([root]).scanSessions();
    expect(entries).to.have.length(1);
    expect(entries[0].inputOther).to.equal(2);
  });

  it('parses legacy StatusUpdate from the old ~/.kimi layout and dedupes by messageId', async () => {
    const root = tmp();
    const nowSec = Date.now() / 1000;
    const legacy = {
      timestamp: nowSec,
      message: {
        type: 'StatusUpdate',
        payload: {
          token_usage: { input_other: 11, output: 22, input_cache_read: 33, input_cache_creation: 44 },
          message_id: 'msg_dup',
        },
      },
    };
    // Same message in two different conversation files (e.g. forked sessions)
    writeFile(path.join(root, 'bucket1', 'conv-1', 'wire.jsonl'), [legacy]);
    writeFile(path.join(root, 'bucket1', 'conv-2', 'wire.jsonl'), [legacy]);

    const entries = await new KimiLocalParser([root]).scanSessions();
    expect(entries).to.have.length(1);
    expect(entries[0].messageId).to.equal('msg_dup');
    expect(entries[0].timestamp).to.equal(Math.floor(nowSec * 1000));
    expect(entries[0].inputOther).to.equal(11);
    expect(entries[0].inputCacheCreation).to.equal(44);
    expect(entries[0].model).to.be.undefined;
  });

  it('scans multiple session roots without duplication', async () => {
    const newRoot = tmp();
    const oldRoot = tmp();
    const now = Date.now();
    writeFile(path.join(newRoot, 'wd_p_h', 'ses_1', 'agents', 'main', 'wire.jsonl'), [
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 }, usageScope: 'turn', time: now },
    ]);
    writeFile(path.join(oldRoot, 'bucket', 'conv', 'wire.jsonl'), [
      { timestamp: now / 1000, message: { type: 'StatusUpdate', payload: { token_usage: { input_other: 5, output: 6, input_cache_read: 7, input_cache_creation: 8 }, message_id: 'm1' } } },
    ]);

    const entries = await new KimiLocalParser([newRoot, oldRoot]).scanSessions();
    expect(entries).to.have.length(2);
    expect(entries.map(e => e.model)).to.have.members(['kimi-k3', undefined]);
  });

  it('caches unchanged files and rescans after invalidate()', async () => {
    const root = tmp();
    const now = Date.now();
    const wire = path.join(root, 'wd_p_h', 'ses_1', 'agents', 'main', 'wire.jsonl');
    writeFile(wire, [
      { type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 1, output: 1, inputCacheRead: 0, inputCacheCreation: 0 }, usageScope: 'turn', time: now },
    ]);

    const parser = new KimiLocalParser([root]);
    expect(await parser.scanSessions()).to.have.length(1);
    // Second scan uses cached file state (same result)
    expect(await parser.scanSessions()).to.have.length(1);

    // Append a new record; mtime/size change triggers reparse
    fs.appendFileSync(wire, JSON.stringify({ type: 'usage.record', model: 'kimi-code/k3', usage: { inputOther: 2, output: 2, inputCacheRead: 0, inputCacheCreation: 0 }, usageScope: 'turn', time: now + 1 }) + '\n');
    expect(await parser.scanSessions()).to.have.length(2);

    parser.invalidate();
    expect(await parser.scanSessions()).to.have.length(2);
  });

  it('returns empty when sessions dirs do not exist', async () => {
    const missing = path.join(os.tmpdir(), 'kimi-parser-no-such-dir');
    const entries = await new KimiLocalParser([missing]).scanSessions();
    expect(entries).to.deep.equal([]);
  });
});
