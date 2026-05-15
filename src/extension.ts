// DESIGN: v2-phase2-implementation.md#extensionts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { getProvider, resolveProviderId } from './providers/registry';
import { IProvider } from './providers/base/types';
import { CacheService } from './services/cacheService';
import { LocalUsageService } from './services/localUsageService';
import { ApiHistoryService } from './services/apiHistoryService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, deleteApiKey, deleteOAuth } from './utils';

const PAUSE_STATE_KEY = 'aiStatusHub._pauseSignal';
let activeStore: Store | undefined;
let activeCacheService: CacheService | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('AI Status Hub v2 activated');

  const store = new Store();
  const config = ConfigService.getInstance();
  const cacheService = CacheService.getInstance();
  const localUsageService = LocalUsageService.getInstance();
  const apiHistoryService = ApiHistoryService.getInstance();
  activeStore = store;
  activeCacheService = cacheService;

  let currentProvider: IProvider;
  let scheduler: Scheduler;
  let statusBar: StatusBarPresenter;

  async function activateProvider(providerId: string): Promise<void> {
    // 1. Stop existing scheduler
    scheduler?.stop();

    // 2. Create new provider
    const provider = getProvider(providerId);
    if (!provider) {
      log(`Unknown provider "${providerId}", falling back to codex`);
      currentProvider = getProvider('codex')!;
    } else {
      currentProvider = provider;
    }

    // 2a. Update config provider context so currency / defaultModelName / pricing resolve correctly
    config.setActiveProviderId(currentProvider.id);

    // 3. Update services
    cacheService.setProviderId(currentProvider.id);
    localUsageService.setProvider(currentProvider);
    apiHistoryService.setProviderId(currentProvider.id);
    if (currentProvider.auth.initSecrets) {
      currentProvider.auth.initSecrets(context.secrets);
    }

    // 4. Reset store but preserve UI settings and activeProvider
    const prevUi = store.getState().ui;
    store.dispatch({ type: 'SIGN_OUT' });
    store.dispatch({ type: 'SET_PROVIDER', payload: currentProvider.id });
    store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: prevUi.displayMode });
    store.dispatch({ type: 'UI_SET_LANGUAGE', payload: prevUi.language });
    store.dispatch({ type: 'UI_SET_PAUSED', payload: prevUi.isPaused });

    // 5. Restore cache and API history for new provider
    const cached = await cacheService.read();
    const historyEntries = await apiHistoryService.readFromDisk();
    if (historyEntries.length > 0) {
      store.dispatch({ type: 'API_HISTORY_LOAD', payload: historyEntries });
    }
    if (cached) {
      store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota, fetchedAt: cached.fetchedAt });
      if (cached.calibration) {
        store.dispatch({
          type: 'LOCAL_ESTIMATE',
          payload: {
            weeklyP: cached.calibration.weeklyP ?? 0,
            weeklyC: cached.calibration.weeklyC ?? 0,
            weeklyK: cached.calibration.weeklyK ?? 0,
            windowP: cached.calibration.windowP ?? 0,
            windowC: cached.calibration.windowC ?? 0,
            windowK: cached.calibration.windowK ?? 0,
            calibratedAt: cached.calibration.calibratedAt,
          },
        });
      }
    }

    // 6. Recreate status bar
    statusBar?.dispose();
    statusBar = new StatusBarPresenter(store, currentProvider);

    // 7. Recreate and start scheduler
    scheduler = new Scheduler(store, currentProvider.auth, currentProvider.api, cacheService, localUsageService);
    scheduler.start();
  }

  // Determine initial provider
  const providerId = await resolveProviderId(config.provider);
  await activateProvider(providerId);
  apiHistoryService.setStore(store);

  // 1. Restore pause state from globalState (cross-window sync)
  const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
  if (pausedFromGlobal) {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
  }

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('aiStatusHub.refresh', () => {
      scheduler.force();
    }),
    vscode.commands.registerCommand('aiStatusHub.signIn', async () => {
      if (currentProvider.auth.startLoginFlow) {
        const ok = await currentProvider.auth.startLoginFlow();
        if (ok) {
          store.dispatch({ type: 'AUTH_STATUS', payload: 'authenticated' });
        }
      } else {
        void vscode.window.showInformationMessage(`Please run "${currentProvider.ui.displayName.toLowerCase()} login" in your terminal to authenticate.`);
      }
    }),
    vscode.commands.registerCommand('aiStatusHub.signOut', async () => {
      // Clear provider-specific credentials
      if (currentProvider.id === 'kimi') {
        await context.secrets.delete('aiStatusHub.apiKey');
        await context.secrets.delete('aiStatusHub.oauthCredentials');
      } else {
        await deleteApiKey(context.secrets);
        await deleteOAuth(context.secrets);
      }
      currentProvider.auth.invalidate();
      localUsageService.invalidate();
      store.dispatch({ type: 'SIGN_OUT' });
    }),
    vscode.commands.registerCommand('aiStatusHub.setApiKey', () => {
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('aiStatusHub.showDashboard', () => {
      DashboardPanel.createOrShow(store);
    }),
    vscode.commands.registerCommand('aiStatusHub.togglePause', async () => {
      const next = !store.getState().ui.isPaused;
      store.dispatch({ type: 'UI_SET_PAUSED', payload: next });
      await context.globalState.update(PAUSE_STATE_KEY, next);
      // Broadcast via configuration change so other windows pick it up
      const cfg = vscode.workspace.getConfiguration('aiStatusHub');
      await cfg.update('_pauseSignal', Date.now(), true);
    }),
    vscode.commands.registerCommand('aiStatusHub.openSettings', () => {
      void vscode.commands.executeCommand('workbench.action.openSettings', '@ext:kayuii.ai-status-hub');
    }),
  );

  // Listen to configuration changes
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration(async (e) => {
      if (e.affectsConfiguration('aiStatusHub')) {
        store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
        store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });

        // Handle provider change
        if (e.affectsConfiguration('aiStatusHub.provider')) {
          const newId = await resolveProviderId(config.provider);
          if (newId !== store.getState().activeProvider) {
            await activateProvider(newId);
          }
        }

        // Sync pause state from other windows via _pauseSignal broadcast
        if (e.affectsConfiguration('aiStatusHub._pauseSignal')) {
          const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
          const currentPaused = store.getState().ui.isPaused;
          if (pausedFromGlobal !== currentPaused) {
            store.dispatch({ type: 'UI_SET_PAUSED', payload: pausedFromGlobal });
          }
        }
      }
    })
  );

  // Persist cache on deactivation via subscription disposal
  context.subscriptions.push(
    { dispose: () => { scheduler.stop(); statusBar.dispose(); } }
  );
}

export async function deactivate(): Promise<void> {
  const anchors = activeStore?.getState().windowAnchors;
  if (anchors) {
    await activeCacheService?.writeWindowAnchors(anchors.providerId, anchors);
  }
  await ApiHistoryService.getInstance().persistIfEnabled();
  log('AI Status Hub v2 deactivated');
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
