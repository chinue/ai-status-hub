// DESIGN: v2-provider-abstraction.md#codex-ui
// AGENTS: keep-minimal

import { IUIProvider } from '../base/types';

export const codexUIProvider: IUIProvider = {
  mainIcon: '$(openai)',
  statusBarName: 'AI Status Hub',
  dashboardTitle: 'Codex Dashboard',
  displayName: 'Codex',
  officialUrl: 'https://openai.com/pricing',
  extensionDisplayName: 'AI Status Hub',
};
