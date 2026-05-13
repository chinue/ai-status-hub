// DESIGN: v2-provider-abstraction.md#codex-local-parser
// AGENTS: err->try-catch | disk-OK
// 🔀 Provider boundary: scans ~/.codex/sessions/**/*.jsonl
// TODO(Phase 3): implement real Codex JSONL parsing per tokscale codex.rs

import { ILocalUsageProvider, UnifiedUsageEntry } from '../base/types';

export class CodexLocalParser implements ILocalUsageProvider {
  async scanSessions(): Promise<UnifiedUsageEntry[]> {
    // Phase 2 placeholder: return empty until Phase 3 implements real parsing
    return [];
  }

  invalidate(): void {
    // no-op until Phase 3
  }
}
