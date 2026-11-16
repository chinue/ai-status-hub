// DESIGN: v2-provider-abstraction.md#volcengine-provider
import { IProvider } from '../base/types';
import { ClaudeLocalParser } from '../claude/localParser';
import { VolcenginePricingProvider } from './pricing';
import { VolcengineAuthProvider } from './auth';
import { VolcengineApiProvider } from './api';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

export function createVolcengineProvider(): IProvider {
  const t = makeT(ConfigService.getInstance().effectiveLanguage);
  const name = t('provider.volcengine');
  const api = new VolcengineApiProvider();
  return {
    id: 'volcengine', displayName: name, currency: { code: 'CNY', symbol: '¥' },
    auth: new VolcengineAuthProvider(api),
    api,
    localUsage: new ClaudeLocalParser('volcengine'),
    pricing: new VolcenginePricingProvider(),
    ui: { mainIcon: '🌋', statusBarName: name, dashboardTitle: name, displayName: name,
      officialUrl: 'https://ark.volcengine.com/region:cn-beijing/docs/model-pricing',
      extensionDisplayName: 'AI Status Hub' },
  };
}
