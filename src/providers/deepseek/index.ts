// DESIGN: v2-provider-abstraction.md#deepseek-provider
import { IProvider } from '../base/types';
import { ClaudeLocalParser } from '../claude/localParser';
import { DeepseekApiProvider } from './api';
import { DeepseekAuthProvider } from './auth';
import { DeepseekPricingProvider } from './pricing';
import { ConfigService } from '../../config';
import { makeT } from '../../i18n';

export function createDeepseekProvider(): IProvider {
  const auth = new DeepseekAuthProvider();
  const api = new DeepseekApiProvider(undefined, () => auth.resolveWebToken());
  const name = makeT(ConfigService.getInstance().effectiveLanguage)('provider.deepseek');
  return { id: 'deepseek', displayName: name, currency: { code: 'CNY', symbol: '¥' },
    api, auth, localUsage: new ClaudeLocalParser('deepseek'),
    pricing: new DeepseekPricingProvider(),
    ui: { mainIcon: '🐋', statusBarName: name, dashboardTitle: name, displayName: name,
      officialUrl: 'https://api-docs.deepseek.com/zh-cn/quick_start/pricing/', extensionDisplayName: 'AI Status Hub' } };
}
