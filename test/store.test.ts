import { expect } from 'chai';
import { Store, defaultState } from '../src/store';
import { QuotaData } from '../src/types';

describe('Store', () => {
  it('initial state matches defaultState', () => {
    const store = new Store();
    expect(store.getState()).to.deep.equal(defaultState());
  });

  it('CACHE_LOADED sets quota and dataSource', () => {
    const store = new Store();
    const quota = makeQuota();
    store.dispatch({ type: 'CACHE_LOADED', payload: quota });
    expect(store.getState().quota).to.deep.equal(quota);
    expect(store.getState().dataSource).to.equal('cache');
  });

  it('API_SUCCESS sets quota, lastFetchAt, lastSuccessfulFetchAt', () => {
    const store = new Store();
    const before = Date.now();
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    const s = store.getState();
    expect(s.dataSource).to.equal('api');
    expect(s.error).to.be.null;
    expect(s.lastFetchAt).to.be.at.least(before);
    expect(s.lastSuccessfulFetchAt).to.be.at.least(before);
  });

  it('API_ERROR sets error and preserves lastSuccessfulFetchAt', () => {
    const store = new Store();
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    const prevSuccess = store.getState().lastSuccessfulFetchAt;
    store.dispatch({ type: 'API_ERROR', payload: { error: 'network' } });
    expect(store.getState().error).to.equal('network');
    expect(store.getState().lastSuccessfulFetchAt).to.equal(prevSuccess);
  });

  it('API_ERROR with authFailed sets authStatus to expired', () => {
    const store = new Store();
    store.dispatch({ type: 'AUTH_STATUS', payload: 'authenticated' });
    store.dispatch({ type: 'API_ERROR', payload: { error: '401', authFailed: true } });
    expect(store.getState().authStatus).to.equal('expired');
  });

  it('UI_SET_PAUSED toggles isPaused', () => {
    const store = new Store();
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    expect(store.getState().ui.isPaused).to.be.true;
    store.dispatch({ type: 'UI_SET_PAUSED', payload: false });
    expect(store.getState().ui.isPaused).to.be.false;
  });

  it('LOADING_START/END toggles isLoading', () => {
    const store = new Store();
    store.dispatch({ type: 'LOADING_START' });
    expect(store.getState().isLoading).to.be.true;
    store.dispatch({ type: 'LOADING_END' });
    expect(store.getState().isLoading).to.be.false;
  });

  it('SIGN_OUT resets to default but preserves UI settings', () => {
    const store = new Store();
    store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: 'absolute' });
    store.dispatch({ type: 'SIGN_OUT' });
    const s = store.getState();
    expect(s.quota).to.be.null;
    expect(s.ui.displayMode).to.equal('absolute');
  });

  it('notifies subscribers on state change', () => {
    const store = new Store();
    let called = 0;
    store.subscribe(() => called++);
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    expect(called).to.equal(1);
  });

  it('does not notify subscribers when state is unchanged', () => {
    const store = new Store();
    let called = 0;
    store.subscribe(() => called++);
    store.dispatch({ type: 'INIT' });
    expect(called).to.equal(0);
  });

  it('LOCAL_ESTIMATE sets localEstimate fields', () => {
    const store = new Store();
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 62.5, windowPct: 30.1 } });
    const s = store.getState();
    expect(s.localEstimate).to.not.be.null;
    expect(s.localEstimate!.weeklyPct).to.equal(62.5);
    expect(s.localEstimate!.windowPct).to.equal(30.1);
    expect(s.dataSource).to.equal('local-only');
  });

  it('LOCAL_ESTIMATE merges with existing estimate', () => {
    const store = new Store();
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 50, windowPct: 20, tokenCapacity: 1000 } });
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { windowPct: 25 } });
    expect(store.getState().localEstimate!.weeklyPct).to.equal(50);
    expect(store.getState().localEstimate!.windowPct).to.equal(25);
    expect(store.getState().localEstimate!.tokenCapacity).to.equal(1000);
  });

  it('LOCAL_ESTIMATE does not change dataSource when quota exists', () => {
    const store = new Store();
    store.dispatch({ type: 'API_SUCCESS', payload: makeQuota() });
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 70 } });
    expect(store.getState().dataSource).to.equal('api');
  });

  it('LOCAL_ESTIMATE skips listener when all payload values unchanged', () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 25, windowPct: 10 } });
    expect(calls).to.equal(1);
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 25, windowPct: 10 } });
    expect(calls).to.equal(1); // skipped
  });

  it('LOCAL_ESTIMATE fires listener when any payload value changes', () => {
    const store = new Store();
    let calls = 0;
    store.subscribe(() => calls++);
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 25, windowPct: 10 } });
    store.dispatch({ type: 'LOCAL_ESTIMATE', payload: { weeklyPct: 26, windowPct: 10 } });
    expect(calls).to.equal(2);
  });
});

function makeQuota(): QuotaData {
  return {
    weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
    windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
    parallelLimit: 30,
  };
}
