// DESIGN: v2-provider-abstraction.md#codex-api
// AGENTS: err->try-catch | network-fallback
// 🔀 Provider boundary: dummy POST to chatgpt.com/backend-api/codex/responses
// Reference: codex-stats/src/codex-client.ts (axios stream approach ported to node-fetch)

import fetch from 'node-fetch';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { IQuotaApiProvider, ApiResult, UnifiedQuota } from '../base/types';
import { log } from '../../utils';

const BASE_URL = 'https://chatgpt.com/backend-api';
const ENDPOINT = '/codex/responses';
const AUTH_FILE = path.join(os.homedir(), '.codex', 'auth.json');

export class CodexApiProvider implements IQuotaApiProvider {
  async fetchQuota(token: string): Promise<ApiResult> {
    try {
      const accountId = await this.readAccountId();
      const result = await this.sendMinimalRequest(token, accountId);
      if (result.rateLimits) {
        const data = this.mapToUnifiedQuota(result.rateLimits);
        return { ok: true, data };
      }
      return { ok: false, error: 'No rate limit headers found', networkError: false };
    } catch (err) {
      const msg = (err as Error).message;
      const isNetwork = /fetch|network|ECONN|ENOTFOUND|ETIMEDOUT|abort/i.test(msg);
      const authFailed = /401|403|Unauthorized| Forbidden/i.test(msg);
      return { ok: false, error: msg, networkError: isNetwork, authFailed };
    }
  }

  private async readAccountId(): Promise<string | undefined> {
    try {
      const raw = await fs.readFile(AUTH_FILE, 'utf-8');
      const parsed = JSON.parse(raw);
      return parsed.tokens?.account_id;
    } catch {
      return undefined;
    }
  }

  private async sendMinimalRequest(token: string, accountId?: string): Promise<{ rateLimits: Record<string, string> | null }> {
    const sessionId = this.generateSessionId();
    const payload = {
      model: 'gpt-5',
      instructions:
        'You are a coding agent running in the Codex CLI, a terminal-based coding assistant. Codex CLI is an open source project led by OpenAI. You are expected to be precise, safe, and helpful.\n\nYour capabilities:\n\n- Receive user prompts and other context provided by the harness, such as files in the workspace.\n- Communicate with the user by streaming thinking & responses, and by making & updating plans.\n- Emit function calls to run terminal commands and apply patches. Depending on how this specific run is configured, you can request that these function calls be escalated to the user for approval before running. More on this in the "Sandbox and approvals" section.\n\nWithin this context, Codex refers to the open-source agentic coding interface (not the old Codex language model built by OpenAI).\n\n# How you work\n\n## Personality\n\nYour default personality and tone is concise, direct, and friendly. You communicate efficiently, always keeping the user clearly informed about ongoing actions without unnecessary detail. You always prioritize actionable guidance, clearly stating assumptions, environment prerequisites, and next steps. Unless explicitly asked, you avoid excessively verbose explanations about your work.',
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
      'User-Agent': 'ai-status-hub/1.0.0',
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    };

    if (accountId) {
      headers['chatgpt-account-id'] = accountId;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let resp: any;
    try {
      resp = await fetch(`${BASE_URL}${ENDPOINT}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      clearTimeout(timeout);
      throw err;
    }

    try {
      // Extract headers immediately — do NOT wait for SSE body to finish.
      // For stream responses the server keeps the connection open; resp.text()
      // would hang until the body completes or the abort fires.
      const rateLimits = this.extractHeaders(resp.headers.raw());

      if (resp.status === 401 || resp.status === 403) {
        throw new AuthError(`HTTP ${resp.status}`, true);
      }

      // Drain / destroy the body stream so the connection is released.
      if (resp.body) {
        const body = resp.body as any;
        if (typeof body.destroy === 'function') {
          body.destroy();
        } else if (typeof body.cancel === 'function') {
          body.cancel().catch(() => {});
        } else {
          // Fallback: resume and ignore data
          body.resume?.();
          body.on?.('error', () => {});
        }
      }

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
      weeklyLimit: 100,
      weeklyUsed: secondaryPct,
      weeklyUsedPct: secondaryPct,
      weeklyResetAt: secondaryResetSec > 0 ? now + secondaryResetSec * 1000 : now + 7 * 24 * 3600 * 1000,
      windowLimit: 100,
      windowUsed: primaryPct,
      windowRemaining: Math.max(0, 100 - primaryPct),
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
