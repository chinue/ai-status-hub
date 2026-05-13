// DESIGN: v2-provider-abstraction.md#codex-api
// AGENTS: err->try-catch | network-fallback
// 🔀 Provider boundary: dummy POST to chatgpt.com/backend-api/codex/responses

import fetch from 'node-fetch';
import { IQuotaApiProvider, ApiResult, UnifiedQuota } from '../base/types';
import { log } from '../../utils';

const BASE_URL = 'https://chatgpt.com/backend-api';
const ENDPOINT = '/codex/responses';

export class CodexApiProvider implements IQuotaApiProvider {
  async fetchQuota(token: string): Promise<ApiResult> {
    try {
      const result = await this.sendMinimalRequest(token);
      if (result.rateLimits) {
        const data = this.mapToUnifiedQuota(result.rateLimits);
        return { ok: true, data };
      }
      return { ok: false, error: 'No rate limit headers found', networkError: false };
    } catch (err) {
      const msg = (err as Error).message;
      const isNetwork = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT/i.test(msg);
      return { ok: false, error: msg, networkError: isNetwork };
    }
  }

  private async sendMinimalRequest(token: string): Promise<{ rateLimits: Record<string, string> | null }> {
    const sessionId = this.generateSessionId();
    const payload = {
      model: 'gpt-5',
      instructions: 'You are a coding agent running in the Codex CLI.',
      input: [
        {
          type: 'message',
          id: null,
          role: 'user',
          content: [{ type: 'input_text', text: 'hi' }],
        },
      ],
      tools: [],
      tool_choice: 'auto',
      parallel_tool_calls: false,
      reasoning: { effort: 'medium', summary: 'auto' },
      store: false,
      stream: true,
      include: ['reasoning.encrypted_content'],
      prompt_cache_key: sessionId,
    };

    const headers: Record<string, string> = {
      'OpenAI-Beta': 'responses=experimental',
      session_id: sessionId,
      Accept: 'text/event-stream',
      originator: 'codex_vscode_extension',
      'User-Agent': 'codex-status-pro/1.0.0',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    };

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    try {
      const resp = await fetch(`${BASE_URL}${ENDPOINT}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      // Consume body minimally to free connection
      try {
        const bodyText = await resp.text();
        // We don't care about body; headers are what we need
        void bodyText;
      } catch {
        // ignore body read errors
      }

      if (resp.status === 401 || resp.status === 403) {
        throw new AuthError(`HTTP ${resp.status}`, true);
      }

      const rateLimits = this.extractHeaders(resp.headers.raw());
      return { rateLimits };
    } finally {
      clearTimeout(timeout);
    }
  }

  private extractHeaders(headers: Record<string, string[]>): Record<string, string> | null {
    const out: Record<string, string> = {};
    const keys = Object.keys(headers);

    const wanted = [
      'x-codex-primary-used-percent',
      'x-codex-primary-window-minutes',
      'x-codex-primary-reset-after-seconds',
      'x-codex-secondary-used-percent',
      'x-codex-secondary-window-minutes',
      'x-codex-secondary-reset-after-seconds',
    ];

    for (const w of wanted) {
      const found = keys.find(k => k.toLowerCase() === w.toLowerCase());
      if (found && headers[found]?.[0]) {
        out[w] = headers[found][0];
      }
    }

    return Object.keys(out).length > 0 ? out : null;
  }

  private mapToUnifiedQuota(headers: Record<string, string>): UnifiedQuota {
    const toFloat = (key: string) => {
      const v = headers[key];
      if (!v) return 0;
      const n = parseFloat(v);
      return isNaN(n) ? 0 : n;
    };
    const toInt = (key: string) => {
      const v = headers[key];
      if (!v) return 0;
      const n = parseInt(v, 10);
      return isNaN(n) ? 0 : n;
    };

    const now = Date.now();
    const primaryPct = toFloat('x-codex-primary-used-percent');
    const primaryResetSec = toInt('x-codex-primary-reset-after-seconds');
    const secondaryPct = toFloat('x-codex-secondary-used-percent');
    const secondaryResetSec = toInt('x-codex-secondary-reset-after-seconds');

    return {
      weeklyLimit: 0, // Codex headers don't expose absolute limits
      weeklyUsed: 0,
      weeklyUsedPct: secondaryPct,
      weeklyResetAt: secondaryResetSec > 0 ? now + secondaryResetSec * 1000 : now + 7 * 24 * 3600 * 1000,
      windowLimit: 0,
      windowUsed: 0,
      windowRemaining: 0,
      windowUsedPct: primaryPct,
      windowResetAt: primaryResetSec > 0 ? now + primaryResetSec * 1000 : now + 5 * 3600 * 1000,
      parallelLimit: 0,
    };
  }

  private generateSessionId(): string {
    return Array.from({ length: 16 }, () =>
      Math.floor(Math.random() * 256).toString(16).padStart(2, '0'),
    ).join('');
  }
}

class AuthError extends Error {
  constructor(message: string, public readonly authFailed: boolean) {
    super(message);
  }
}
