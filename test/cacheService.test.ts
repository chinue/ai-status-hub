import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CacheService } from '../src/services/cacheService';
import { QuotaData, WindowAnchorData } from '../src/types';

describe('CacheService', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `kimi-test-${Date.now()}`);
    await fs.mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it('write -> read roundtrip', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    const data = { quota: makeQuota(), fetchedAt: Date.now() };
    await svc.write(data);
    const read = await svc.read();
    expect(read?.quota).to.deep.equal(data.quota);
  });

  it('returns null for non-existent file', async () => {
    const svc = new CacheService(path.join(tempDir, 'no-such-file.json'));
    const read = await svc.read();
    expect(read).to.be.null;
  });

  it('returns null for old schema version', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    const bad = { version: 1, schema: 'v1', data: {} };
    await fs.writeFile(path.join(tempDir, 'cache.json'), JSON.stringify(bad));
    const read = await svc.read();
    expect(read).to.be.null;
  });

  it('returns null for corrupted JSON', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    await fs.writeFile(path.join(tempDir, 'cache.json'), 'not json');
    const read = await svc.read();
    expect(read).to.be.null;
  });

  it('writes and reads window anchors', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    const anchors = makeAnchors('claude');
    await svc.writeWindowAnchors('claude', anchors);
    const read = await svc.readWindowAnchors('claude');
    expect(read).to.deep.equal({ ...anchors, source: 'disk' });
  });

  it('returns null when window anchors file does not exist', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    const read = await svc.readWindowAnchors('claude');
    expect(read).to.be.null;
  });

  it('returns null for window anchors schema mismatch', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    await fs.writeFile(path.join(tempDir, 'ai-status-hub-window-anchors-claude.json'), JSON.stringify({
      version: 1,
      schema: 'wrong-schema',
      data: makeAnchors('claude'),
    }));
    const read = await svc.readWindowAnchors('claude');
    expect(read).to.be.null;
  });

  it('returns null for corrupted window anchors JSON', async () => {
    const svc = new CacheService(path.join(tempDir, 'cache.json'));
    await fs.writeFile(path.join(tempDir, 'ai-status-hub-window-anchors-claude.json'), 'not json');
    const read = await svc.readWindowAnchors('claude');
    expect(read).to.be.null;
  });
});

function makeQuota(): QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
    windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
    parallelLimit: 30,
  };
}

function makeAnchors(providerId: string): WindowAnchorData {
  const now = Date.now();
  return {
    providerId,
    window5hStartMs: now - 5 * 3600 * 1000,
    window5hResetAtMs: now,
    window7dStartMs: now - 7 * 24 * 3600 * 1000,
    window7dResetAtMs: now,
    updatedAt: now,
    source: 'api',
  };
}
