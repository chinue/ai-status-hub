// DESIGN: v2-phase2-implementation.md#extensionts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { makeT } from './i18n';
import { getProvider, getProviderInfo, resolveProviderId } from './providers/registry';
import { IProvider } from './providers/base/types';
import { CacheService } from './services/cacheService';
import { LocalUsageService } from './services/localUsageService';
import { ApiHistoryService } from './services/apiHistoryService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, deleteApiKey, deleteOAuth } from './utils';

const PAUSE_STATE_KEY = 'aiStatusHub._pauseSignal';
interface ProviderRuntime {
  provider: IProvider;
  store: Store;
  cache: CacheService;
  local: LocalUsageService;
  history: ApiHistoryService;
  scheduler: Scheduler;
  statusBar?: StatusBarPresenter;
  started: boolean;
}
const runtimes = new Map<string, ProviderRuntime>();

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const config = ConfigService.getInstance();
  config.initializeSelectionStorage(context.globalState);
  let activeId = await resolveProviderId(config.provider);
  if (!getProviderInfo(activeId)) activeId = 'codex';
  let disposed = false;
  let queue = Promise.resolve();

  // Serialize selection changes so slow cache restores cannot replace a newer selection.
  const enqueue = (work: () => Promise<void>): Promise<void> => {
    queue = queue.then(async () => { if (!disposed) await work(); })
      .catch(err => { log(`Provider update failed: ${err}`); });
    return queue;
  };

  async function ensureRuntime(id: string): Promise<ProviderRuntime> {
    const existing = runtimes.get(id);
    if (existing) return existing;
    const provider = getProvider(id)!;
    const store = new Store();
    store.dispatch({ type: 'SET_PROVIDER', payload: id });
    const cache = new CacheService();
    cache.setProviderId(id);
    const local = new LocalUsageService();
    local.setProvider(provider);
    const history = new ApiHistoryService();
    history.setProviderId(id);
    history.setStore(store);
    provider.auth.initSecrets?.(context.secrets);
    const runtime: ProviderRuntime = {
      provider, store, cache, local, history, started: false,
      scheduler: new Scheduler(store, provider.auth, provider.api, cache, local),
    };
    runtimes.set(id, runtime);
    const cached = await cache.read();
    const entries = await history.readFromDisk();
    if (entries.length) store.dispatch({ type: 'API_HISTORY_LOAD', payload: entries });
    if (cached) {
      store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota, fetchedAt: cached.fetchedAt });
      if (cached.calibration) store.dispatch({ type: 'LOCAL_ESTIMATE', payload: {
        weeklyP: cached.calibration.weeklyP ?? 0, weeklyC: cached.calibration.weeklyC ?? 0,
        weeklyK: cached.calibration.weeklyK ?? 0, windowP: cached.calibration.windowP ?? 0,
        windowC: cached.calibration.windowC ?? 0, windowK: cached.calibration.windowK ?? 0,
        calibratedAt: cached.calibration.calibratedAt,
      } });
    }
    return runtime;
  }

  async function reconcile(): Promise<void> {
    config.setActiveProviderId(activeId);
    const selected = config.statusBarProviders.filter(id => !!getProviderInfo(id));
    for (const id of new Set([activeId, ...selected])) await ensureRuntime(id);
    if (disposed) return;
    for (const [id, runtime] of runtimes) {
      const { store } = runtime;
      store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
      store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });
      store.dispatch({ type: 'UI_SET_PAUSED', payload: context.globalState.get<boolean>(PAUSE_STATE_KEY, false) });
      if (selected.includes(id)) {
        if (!runtime.statusBar) runtime.statusBar = new StatusBarPresenter(store, runtime.provider);
      } else {
        runtime.statusBar?.dispose();
        runtime.statusBar = undefined;
      }
      const enabled = selected.includes(id) || id === activeId;
      if (enabled && !runtime.started) runtime.scheduler.start();
      if (!enabled && runtime.started) runtime.scheduler.stop();
      runtime.started = enabled;
    }
    DashboardPanel.updateSelection();
  }

  const showDashboard = (id?: unknown): Promise<void> => enqueue(async () => {
    if (id !== undefined && (typeof id !== 'string' || !getProviderInfo(id))) return;
    if (typeof id === 'string') activeId = id;
    await reconcile();
    if (!disposed) DashboardPanel.createOrShow(runtimes.get(activeId)!.store);
  });
  const withRuntime = (id: unknown, work: (runtime: ProviderRuntime) => Promise<void> | void): Promise<void> => enqueue(async () => {
    const target = typeof id === 'string' ? id : activeId;
    if (!getProviderInfo(target)) return;
    await work(await ensureRuntime(target));
  });

  context.subscriptions.push(
    vscode.commands.registerCommand('aiStatusHub.showDashboard', showDashboard),
    vscode.commands.registerCommand('aiStatusHub.syncStatusBars', () => enqueue(reconcile)),
    vscode.commands.registerCommand('aiStatusHub.refresh', (id?: unknown) => withRuntime(id, runtime => runtime.scheduler.force())),
    vscode.commands.registerCommand('aiStatusHub.signIn', (id?: unknown) => withRuntime(id, async runtime => {
      if (runtime.provider.auth.startLoginFlow) {
        if (await runtime.provider.auth.startLoginFlow()) runtime.store.dispatch({ type: 'AUTH_STATUS', payload: 'authenticated' });
      } else {
        const t = makeT(config.effectiveLanguage);
        await vscode.window.showInformationMessage(t('tooltip.loginCommand').replace('{provider}', runtime.provider.ui.displayName.toLowerCase()));
      }
    })),
    vscode.commands.registerCommand('aiStatusHub.signOut', (id?: unknown) => withRuntime(id, async runtime => {
      if (runtime.provider.id === 'kimi') {
        await context.secrets.delete('aiStatusHub.apiKey');
        await context.secrets.delete('aiStatusHub.oauthCredentials');
      } else {
        await deleteApiKey(context.secrets);
        await deleteOAuth(context.secrets);
      }
      runtime.provider.auth.invalidate();
      runtime.local.invalidate();
      runtime.store.dispatch({ type: 'SIGN_OUT' });
    })),
    vscode.commands.registerCommand('aiStatusHub.setApiKey', () => enqueue(() => promptForApiKey(context))),
    vscode.commands.registerCommand('aiStatusHub.togglePause', () => enqueue(async () => {
      const next = !context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
      await context.globalState.update(PAUSE_STATE_KEY, next);
      for (const runtime of runtimes.values()) runtime.store.dispatch({ type: 'UI_SET_PAUSED', payload: next });
      await vscode.workspace.getConfiguration('aiStatusHub').update('_pauseSignal', Date.now(), true);
    })),
    vscode.commands.registerCommand('aiStatusHub.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.ai-status-hub');
    }),
    vscode.workspace.onDidChangeConfiguration(e => {
      if (!e.affectsConfiguration('aiStatusHub')) return;
      void enqueue(async () => {
        if (e.affectsConfiguration('aiStatusHub.provider')) {
          const id = await resolveProviderId(config.provider);
          if (getProviderInfo(id)) activeId = id;
          await reconcile();
          DashboardPanel.switchStore(runtimes.get(activeId)!.store);
        } else await reconcile();
      });
    }),
    { dispose: () => {
      disposed = true;
      for (const runtime of runtimes.values()) {
        runtime.scheduler.stop();
        runtime.statusBar?.dispose();
      }
    } },
  );
  await enqueue(reconcile);
  log('AI Status Hub activated');
}

export async function deactivate(): Promise<void> {
  for (const runtime of runtimes.values()) {
    runtime.scheduler.stop();
    runtime.statusBar?.dispose();
    const anchors = runtime.store.getState().windowAnchors;
    if (anchors) await runtime.cache.writeWindowAnchors(runtime.provider.id, anchors);
    await runtime.history.persistIfEnabled();
  }
  runtimes.clear();
  ConfigService.getInstance().initializeSelectionStorage();
  log('AI Status Hub deactivated');
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'AI Status Hub – Set API Key',
    prompt: 'Paste your OpenAI API key (sk-...).',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
  });
  if (!value?.trim()) return;
  await writeApiKey(context.secrets, value.trim());
  void vscode.window.showInformationMessage('API key saved.');
}
