# ChangeLog

## [0.3.9] - 2026-05-13

### 改进

- **Tooltip 时间格式统一**：将 `Last update` 时间从系统本地格式（可能为 12 小时制）改为固定的 `YYYY-MM-DD HH:mm:ss` 24 小时制格式，避免不同 locale 下的显示不一致。

## [0.3.8] - 2026-05-13

### UI 改进

- **更新数据刷新动画图标**：将状态栏数据刷新动画从 `🎆🎇✨` 替换为月相循环序列 `🌑🌒🌓🌔🌕🌖🌗🌘`，更贴合扩展名称中的"Status"意境。

## [0.3.7] - 2026-05-13

### 改进

- **状态栏显示优化**：状态栏第一个百分数（Weekly）后面不再显示 `%` 符号，保持与 codex-ratelimit-vscode 一致的紧凑风格。
- **参考 codex-ratelimit-vscode 改进 short tick 算法**：当 API 校准容量不可用时，short tick 会直接从本地 `~/.codex/sessions` 的 `rate_limits` 中读取 `used_percent`，实现不依赖 API 调用的实时百分比显示。
- **参考 tokscale 优化本地解析器**：
  - 增加 content hash（MD5）作为文件指纹的第三重校验，防止 mtime 不变但内容变化时漏更新。
  - 支持增量行解析：当 JSONL 文件仅追加内容时，只解析新增行，避免重复处理历史数据。
  - 去重 key 增加 model 字段，防止不同模型的相同 token 用量被误去重。

## [0.3.4] - 2026-05-13

### Bug 修复

- **修复 Codex API 调用**：参考 `codex-stats` 实现进行多项改进：
  - 添加缺失的 `chatgpt-account-id` header（从 `~/.codex/auth.json` 读取）。
  - 不再调用 `resp.text()` 读取 SSE stream（会挂起），改为立即提取 headers 后销毁 body stream。
  - 使用完整的 Codex CLI instructions payload。
  - 错误响应也标记 `authFailed`（支持 401/403 检测）。
- **延长默认刷新间隔**：60 秒 → 300 秒（5 分钟），与 Codex CLI 使用频率匹配，避免过于频繁的 API 探测。

## [0.3.3] - 2026-05-13

### 代码清理

- **删除 Kimi 遗留死代码**：移除 `src/services/authService.ts`、`src/services/apiService.ts` 及对应测试文件。
- **清理违规磁盘访问**：从 `src/utils.ts` 删除 `readKimiCliCredentials()`（直接读取 `~/.kimi/credentials/kimi-code.json`），以及仅被死代码引用的 `readApiKey`、`readOAuth`、`writeOAuth`。
- **测试同步**：`scheduler.test.ts` 改用 `IAuthProvider`/`IQuotaApiProvider` mock 对象替代已删除的具体类。

## [0.3.2] - 2026-05-13

### Bug 修复

- **修复百分比一直为 0**：`doShortTick()` 在校准容量（`tokenCapacity`/`windowCostCapacity`）无效时，会错误地将 API 百分比覆盖为 0。现已改为：仅当校准有效时才更新 `weeklyPct`/`windowPct`，保留 API 返回的真实使用率。

## [0.3.1] - 2026-05-13

### Bug 修复

- **去除硬编码人民币符号**：Dashboard 的 i18n 字符串、Chart.js 坐标轴 callback、成本标签等处原来硬编码了 `¥` 和 `RMB`，已全部改为使用配置化货币符号（默认 `$`），与 Codex/USD 定价体系保持一致。

## [0.3.0] - 2026-05-13

### 重大变更

- **完整迁移**：从 `kimi-status-pro` 迁移至 `codex-status-pro`，全面支持 OpenAI Codex CLI 的用量监控与状态追踪。
- **Provider 抽象层**：引入统一的 Provider 架构（`IProvider`），将认证、API 配额、本地用量解析、定价策略与 UI 表现完全解耦，为未来多 Provider 扩展奠定基础。

### 功能

- **Codex 认证**：自动读取 `~/.codex/auth.json`，解析 JWT `id_token` 获取账户信息，使用 `access_token` 作为 Bearer Token。
- **API 配额监控**：通过向 Codex API 发送探测请求，从响应头中提取 `x-codex-primary-*`（5 小时窗口）与 `x-codex-secondary-*`（7 天窗口）的速率限制使用率与重置时间。
- **本地 JSONL 用量解析**：扫描 `~/.codex/sessions/**/*.jsonl` 与 `archived_sessions`，基于 `last_token_usage` 增量（delta）逻辑精确计算每轮对话的 token 消耗，支持模型追踪与缓存 token 钳位。
- **成本估算**：内置 USD 定价（默认 `gpt-5` 模型），支持通过 `codexStatusPro.currency` 配置币种符号（默认 `$`）。
- **状态栏 UI**：使用 `$(openai)` Codex 图标，更新动画替换为 `['🎆','🎇','✨️']`，所有文案统一为 Codex 品牌。

### 技术细节

- **Delta 解析逻辑**：直接适配 tokscale Rust 实现，处理 `last_token_usage` 为增量、总用量 stale regression 防护、缓存 token 上限钳制。
- **文件 I/O 隔离**：仅 `LocalUsageService` 与 `CacheService` 执行磁盘访问。
- **国际化**：所有用户可见字符串通过 `makeT()` 管理，新增 Codex 专用词条。
- **测试**：99 项测试全部通过，覆盖认证、API、缓存、计算、历史、调度与状态栏。
