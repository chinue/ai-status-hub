// DESIGN: v2-phase2-implementation.md#extensionts
// AGENTS: fmt->calc.ts | err->try-catch | i18n->makeT() | no-disk-IO
import * as vscode from 'vscode';
import { Store } from './store';
import { ConfigService } from './config';
import { createCodexProvider } from './providers/codex';
import { CacheService } from './services/cacheService';
import { LocalUsageService } from './services/localUsageService';
import { Scheduler } from './services/scheduler';
import { StatusBarPresenter } from './presenters/statusBar';
import { DashboardPanel } from './presenters/dashboard';
import { log, writeApiKey, deleteApiKey, deleteOAuth } from './utils';

const PAUSE_STATE_KEY = 'codexStatusPro._pauseSignal';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  log('CodexStatusPro v2 activated');

  const store = new Store();
  const config = ConfigService.getInstance();
  const provider = createCodexProvider();
  const cacheService = CacheService.getInstance();
  const localUsageService = LocalUsageService.getInstance();

  // 1. Restore pause state from globalState (cross-window sync)
  const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
  if (pausedFromGlobal) {
    store.dispatch({ type: 'UI_SET_PAUSED', payload: true });
  }

  // 2. Restore cache
  const cached = await cacheService.read();
  if (cached) {
    store.dispatch({ type: 'CACHE_LOADED', payload: cached.quota });
    // Restore calibration
    if (cached.calibration) {
      store.dispatch({
        type: 'LOCAL_ESTIMATE',
        payload: {
          tokenCapacity: cached.calibration.tokenCapacity,
          windowCostCapacity: cached.calibration.windowCostCapacity,
          calibratedAt: cached.calibration.calibratedAt,
        },
      });
    }
  }

  // 3. Sync language from config to store so StatusBar uses consistent locale
  store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });

  // 4. Initialize Presenters
  const statusBar = new StatusBarPresenter(store, provider);

  // 5. Start scheduler
  const scheduler = new Scheduler(store, provider.auth, provider.api, cacheService, localUsageService);
  scheduler.start();

  // 5. Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('codexStatusPro.refresh', () => {
      scheduler.force();
    }),
    vscode.commands.registerCommand('codexStatusPro.signIn', async () => {
      void vscode.window.showInformationMessage('Please run "codex login" in your terminal to authenticate.');
    }),
    vscode.commands.registerCommand('codexStatusPro.signOut', async () => {
      await deleteApiKey(context.secrets);
      await deleteOAuth(context.secrets);
      provider.auth.invalidate();
      localUsageService.invalidate();
      store.dispatch({ type: 'SIGN_OUT' });
    }),
    vscode.commands.registerCommand('codexStatusPro.setApiKey', () => {
      promptForApiKey(context);
    }),
    vscode.commands.registerCommand('codexStatusPro.showDashboard', () => {
      DashboardPanel.createOrShow(store);
    }),
    vscode.commands.registerCommand('codexStatusPro.togglePause', async () => {
      const next = !store.getState().ui.isPaused;
      store.dispatch({ type: 'UI_SET_PAUSED', payload: next });
      await context.globalState.update(PAUSE_STATE_KEY, next);
      // Broadcast via configuration change so other windows pick it up
      const cfg = vscode.workspace.getConfiguration('codexStatusPro');
      await cfg.update('_pauseSignal', Date.now(), true);
    }),
  );

  // 6. Listen to configuration changes (including pause broadcast)
  context.subscriptions.push(
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('codexStatusPro')) {
        store.dispatch({ type: 'UI_SET_DISPLAY_MODE', payload: config.displayMode });
        store.dispatch({ type: 'UI_SET_LANGUAGE', payload: config.language });
        // Sync pause state from other windows via _pauseSignal broadcast
        if (e.affectsConfiguration('codexStatusPro._pauseSignal')) {
          const pausedFromGlobal = context.globalState.get<boolean>(PAUSE_STATE_KEY, false);
          const currentPaused = store.getState().ui.isPaused;
          if (pausedFromGlobal !== currentPaused) {
            store.dispatch({ type: 'UI_SET_PAUSED', payload: pausedFromGlobal });
          }
        }
      }
    })
  );

  // 7. Persist cache on deactivation via subscription disposal
  context.subscriptions.push(
    { dispose: () => { scheduler.stop(); statusBar.dispose(); } }
  );
}

export function deactivate(): void {
  log('CodexStatusPro v2 deactivated');
}

async function promptForApiKey(context: vscode.ExtensionContext): Promise<void> {
  const value = await vscode.window.showInputBox({
    title: 'CodexStatusPro – Set API Key',
    prompt: 'Paste your OpenAI API key (sk-...).',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'sk-...',
  });
  if (!value?.trim()) return;
  await writeApiKey(context.secrets, value.trim());
  void vscode.window.showInformationMessage('API key saved.');
}
