import { expect } from 'chai';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { Store } from '../src/store';
import * as sinon from 'sinon';
import * as vscode from 'vscode';

describe('StatusBarPresenter', () => {
  let store: Store;
  let presenter: StatusBarPresenter;

  beforeEach(() => {
    store = new Store();
    presenter = new StatusBarPresenter(store);
  });

  afterEach(() => {
    presenter.dispose();
  });

  it('renders loading state initially', () => {
    // itemWeekly text was set to spinner in constructor, then render(defaultState) runs
    const weeklyText = (presenter as any).itemWeekly.text;
    expect(weeklyText).to.include('Codex');
  });

  it('uses a single item when auth is missing', () => {
    store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
    expect((presenter as any).itemWindow).to.be.undefined;
  });

  it('provides a working provider-specific login link when credentials are missing', async () => {
    store.dispatch({ type: 'SET_PROVIDER', payload: 'kimi' });
    store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
    await Promise.resolve();
    const tooltip = (presenter as any).itemWeekly.tooltip.value;
    expect(tooltip).to.include('command:aiStatusHub.signIn?%5B%22kimi%22%5D');
  });

  it('shows weekly percentage after API_SUCCESS', () => {
    store.dispatch({
      type: 'API_SUCCESS',
      payload: {
        weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
        windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
        parallelLimit: 30,
      },
    });
    // First data arrival shows the value immediately without animation
    const weeklyText = (presenter as any).itemWeekly.text as string;
    expect(weeklyText).to.include('25.00%');
  });

  it('hides data items and shows moon icon when paused', () => {
    store.dispatch({
      type: 'API_SUCCESS',
      payload: {
        weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
        windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
        parallelLimit: 30,
      },
    });
    // Stop animation manually before checking normal state
    (presenter as any).stopUpdateAnimation();
    (presenter as any).render(store.getState());

    // Before pause: data items visible
    expect((presenter as any).itemWeekly.text).to.include('25.00%');

    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    // After pause: weekly item shows only the provider icon, window hidden
    expect((presenter as any).itemWeekly.visible).to.be.true;
    expect((presenter as any).itemWeekly.text).to.equal('$(openai)');
    expect((presenter as any).itemWindow).to.be.undefined;

    store.dispatch({ type: 'UI_SET_PAUSED', payload: false });
    // After resume: data items visible again
    expect((presenter as any).itemWeekly.visible).to.be.true;
    expect((presenter as any).itemWeekly.text).to.include('25.00%');
  });

  it('degrades gracefully when auth expires with cached data', () => {
    store.dispatch({
      type: 'API_SUCCESS',
      payload: {
        weeklyLimit: 1000, weeklyUsed: 250, weeklyUsedPct: 25, weeklyResetAt: Date.now() + 86400000,
        windowLimit: 200, windowUsed: 50, windowRemaining: 150, windowUsedPct: 25, windowResetAt: Date.now() + 18000000,
        parallelLimit: 30,
      },
    });
    // authStatus: authenticated → expired (API returned 401 on a later tick)
    store.dispatch({ type: 'API_ERROR', payload: { error: 'HTTP 401', authFailed: true, networkError: false } });
    (presenter as any).stopUpdateAnimation();
    (presenter as any).render(store.getState());

    const weeklyText = (presenter as any).itemWeekly.text as string;
    expect(weeklyText).to.include('25.00%');
    expect(weeklyText).to.include('\uD83D\uDD10');
    expect(weeklyText).to.not.include('auth expired');
    expect((presenter as any).itemWeekly.backgroundColor).to.be.undefined;
    expect((presenter as any).itemWindow).to.be.undefined;
    expect(weeklyText).to.include(' | 5️⃣ 25.00%');
  });

  it('shows blocking error when auth expires without any data', () => {
    store.dispatch({ type: 'AUTH_STATUS', payload: 'authenticated' });
    store.dispatch({ type: 'API_ERROR', payload: { error: 'HTTP 401', authFailed: true, networkError: false } });

    const weeklyText = (presenter as any).itemWeekly.text as string;
    expect(weeklyText).to.include('auth expired');
    expect((presenter as any).itemWindow).to.be.undefined;
  });

  it('creates one cell, uses weekly remaining quota for color, and opens its own dashboard', async () => {
    presenter.dispose();
    const create = sinon.spy(vscode.window, 'createStatusBarItem');
    presenter = new StatusBarPresenter(store);
    try {
      expect(create.callCount).to.equal(1);
      store.dispatch({ type: 'API_SUCCESS', payload: {
        weeklyLimit: 100, weeklyUsed: 90, weeklyUsedPct: 90, weeklyResetAt: Date.now() + 86400000,
        windowLimit: 100, windowUsed: 5, windowRemaining: 95, windowUsedPct: 5, windowResetAt: Date.now() + 18000000,
        parallelLimit: 0,
      } });
      await Promise.resolve();
      const item = (presenter as any).itemWeekly;
      expect(item.text).to.include('$(openai) Codex:90.00% | 5️⃣ 5.00%');
      expect(item.color).to.equal('#FF0000');
      expect(item.command).to.include({ command: 'aiStatusHub.showDashboard' });
      expect(item.command.arguments).to.deep.equal(['codex']);
      expect(item.tooltip.value).to.include('5h');
      expect(item.tooltip.value).to.include('7d');
    } finally { create.restore(); }
  });
});
