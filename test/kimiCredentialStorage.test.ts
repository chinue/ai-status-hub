import { expect } from 'chai';
import * as sinon from 'sinon';
import * as path from 'path';
import { CacheService } from '../src/services/cacheService';
const fs = require('fs/promises');
const os = require('os');

describe('Kimi credential locations', () => {
  afterEach(() => sinon.restore());

  it('reads modern and legacy locations while skipping corrupt files', async () => {
    const home = path.resolve('test-kimi-home');
    sinon.stub(os, 'homedir').returns(home);
    sinon.stub(process, 'env').value({ ...process.env, KIMI_CODE_HOME: '', KIMI_SHARE_DIR: '' });
    const read = sinon.stub(fs, 'readFile');
    read.onFirstCall().resolves('broken JSON');
    read.onSecondCall().resolves(JSON.stringify({ access_token: 'fixture' }));
    expect(await new CacheService().readKimiCredentials()).to.deep.equal([{ access_token: 'fixture' }]);
    expect(read.firstCall.args[0]).to.equal(path.join(home, '.kimi-code', 'credentials', 'kimi-code.json'));
    expect(read.secondCall.args[0]).to.equal(path.join(home, '.kimi', 'credentials', 'kimi-code.json'));
  });

  for (const variable of ['KIMI_CODE_HOME', 'KIMI_SHARE_DIR']) {
    it(`honors ${variable} without mixing accounts from default directories`, async () => {
      const root = path.resolve('test-kimi-custom');
      sinon.stub(process, 'env').value({ ...process.env, KIMI_CODE_HOME: '', KIMI_SHARE_DIR: '', [variable]: root });
      const read = sinon.stub(fs, 'readFile').resolves(JSON.stringify({ access_token: 'fixture' }));
      await new CacheService().readKimiCredentials();
      expect(read.calledOnce).to.equal(true);
      expect(read.firstCall.args[0]).to.equal(path.join(root, 'credentials', 'kimi-code.json'));
    });
  }
});
