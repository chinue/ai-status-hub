import { expect } from 'chai';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { CacheService } from '../src/services/cacheService';
import { QuotaData } from '../src/types';

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
});

function makeQuota(): QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
    windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
    parallelLimit: 30,
  };
}
