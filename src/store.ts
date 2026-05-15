// DESIGN: v2-phase2-implementation.md#storets
// AGENTS: pure-reducer | no-mutation
import { AppState, Action, AuthStatus } from './types';

export const defaultState = (): AppState => ({
  quota: null,
  lastFetchAt: null,
  lastSuccessfulFetchAt: null,
  error: null,
  authStatus: 'unknown',
  dataSource: 'no-data',
  isLoading: false,
  localEstimate: null,
  usageEntries: [],
  estHistory: [],
  windowAnchors: null,
  activeProvider: 'codex',
  ui: {
    displayMode: 'percent',
    language: 'auto',
    isPaused: false,
  },
});

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'INIT':
      return state;

    case 'CACHE_LOADED':
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: action.fetchedAt ?? null,
        dataSource: 'cache',
        error: null,
      };

    case 'API_SUCCESS': {
      const now = Date.now();
      return {
        ...state,
        quota: action.payload,
        lastFetchAt: now,
        lastSuccessfulFetchAt: now,
        dataSource: action.source ?? 'api',
        error: null,
        authStatus: state.authStatus === 'missing' ? 'authenticated' : state.authStatus,
        isLoading: false,
      };
    }

    case 'API_ERROR':
      return {
        ...state,
        error: action.payload.error,
        isLoading: false,
        authStatus: action.payload.authFailed
          ? (state.authStatus === 'authenticated' ? 'expired' : 'failed')
          : state.authStatus,
      };

    case 'LOCAL_ESTIMATE': {
      const payload = action.payload;
      const current = state.localEstimate;
      const entries = payload.entries ?? state.usageEntries;

      // 如果 localEstimate 已存在，且 payload 中每个字段的值都与当前值严格相等，
      // 且 entries 没有变化，则返回原 state 引用，Store 会跳过所有 listener（避免不必要的 UI 刷新）
      if (
        current &&
        Object.keys(payload).every((k) => k === 'entries' || (payload as any)[k] === (current as any)[k]) &&
        entries === state.usageEntries
      ) {
        return state;
      }

      const next: AppState = {
        ...state,
        usageEntries: entries,
        localEstimate: current
          ? { ...current, ...payload }
          : {
              weeklyPct: 0,
              windowPct: 0,
              weeklyP: 0,
              weeklyC: 0,
              weeklyK: 0,
              windowP: 0,
              windowC: 0,
              windowK: 0,
              calibratedAt: null,
              cost5h: 0,
              cost7d: 0,
              costToday: 0,
              requestsToday: 0,
              tokensToday: 0,
              tokensOutToday: 0,
              tokensCacheReadToday: 0,
              tokensCacheCreateToday: 0,
              tokensIn5h: 0,
              tokensOut5h: 0,
              tokensCacheRead5h: 0,
              tokensCacheCreate5h: 0,
              requests5h: 0,
              tokensIn7d: 0,
              tokensOut7d: 0,
              tokensCacheRead7d: 0,
              tokensCacheCreate7d: 0,
              requests7d: 0,
              tokensThisCycle: 0,
              tokensOutThisCycle: 0,
              tokensCacheReadThisCycle: 0,
              tokensCacheCreateThisCycle: 0,
              costThisCycle: 0,
              requestsThisCycle: 0,
              ...payload,
            },
      };
      // When we have a local estimate but no API quota yet, upgrade dataSource
      if (!state.quota && next.localEstimate) {
        next.dataSource = state.dataSource === 'no-data' ? 'local-only' : state.dataSource;
      }
      return next;
    }

    case 'AUTH_STATUS':
      return { ...state, authStatus: action.payload };

    case 'UI_SET_DISPLAY_MODE':
      return { ...state, ui: { ...state.ui, displayMode: action.payload } };

    case 'UI_SET_LANGUAGE':
      return { ...state, ui: { ...state.ui, language: action.payload } };

    case 'UI_SET_PAUSED':
      return { ...state, ui: { ...state.ui, isPaused: action.payload } };

    case 'SET_PROVIDER':
      return { ...state, activeProvider: action.payload };

    case 'LOADING_START':
      return { ...state, isLoading: true };

    case 'LOADING_END':
      return { ...state, isLoading: false };

    case 'API_HISTORY': {
      const maxEntries = action.payload.maxEntries;
      const next = [...state.estHistory, action.payload.entry];
      if (next.length > maxEntries) {
        next.shift();
      }
      return { ...state, estHistory: next };
    }

    case 'API_HISTORY_LOAD':
      return { ...state, estHistory: action.payload };

    case 'WINDOW_ANCHORS_SET':
      return { ...state, windowAnchors: action.payload };

    case 'SIGN_OUT':
      return {
        ...defaultState(),
        activeProvider: state.activeProvider,
        ui: state.ui,
        estHistory: state.estHistory,
      };

    default:
      return state;
  }
}

export class Store {
  private state: AppState;
  private listeners = new Set<(s: AppState) => void>();

  constructor() {
    this.state = defaultState();
  }

  dispatch(action: Action): void {
    const next = reducer(this.state, action);
    if (next !== this.state) {
      this.state = next;
      this.listeners.forEach((fn) => {
        try { fn(this.state); } catch (e) { console.error('Store listener error', e); }
      });
    }
  }

  getState(): AppState { return this.state; }

  subscribe(fn: (s: AppState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
