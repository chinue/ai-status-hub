import { expect } from 'chai';
import { StatusBarPresenter } from '../src/presenters/statusBar';
import { Store } from '../src/store';

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

  it('hides window item when auth missing', () => {
    store.dispatch({ type: 'AUTH_STATUS', payload: 'missing' });
    expect((presenter as any).itemWindow.visible).to.be.false;
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
    expect(weeklyText).to.include('25.0%');
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
    expect((presenter as any).itemWeekly.text).to.include('25.0%');

    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
    // After pause: data items hidden, pause item shows moon
    expect((presenter as any).itemWeekly.visible).to.be.false;
    expect((presenter as any).itemWindow.visible).to.be.false;
    expect((presenter as any).itemPause.text).to.equal('\uD83C\uDF18');

    store.dispatch({ type: 'UI_SET_PAUSED', payload: false });
    // After resume: data items visible again, pause item shows pause symbol
    expect((presenter as any).itemWeekly.visible).to.be.true;
    expect((presenter as any).itemWeekly.text).to.include('25.0%');
    expect((presenter as any).itemPause.text).to.equal('\u23F8\uFE0F');
  });
});
