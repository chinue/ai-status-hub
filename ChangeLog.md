# ChangeLog

## [0.3.17] - 2026-05-13

### 新增

- **在 Settings UI 中恢复 `language` 配置项**：此前 `language` 的 setter 虽然保留在 `src/config.ts` 中，但已从 `package.json` 的 `contributes.configuration` 中移除，导致 Dashboard 语言切换按钮无法持久化到用户配置（fallback 到 store 内存）。现已将 `codexStatusPro.language` 重新加入 `package.json`，支持 `auto`/`en`/`zh-CN` 三档，与 VS Code 设置同步。

### Bug 修复

- **修复 Dashboard 设置按钮打开空设置面板**：`openSettings` 命令传入了错误的扩展 ID `@ext:codex-status-pro`（缺少 publisher 前缀）。VS Code 的 `@ext:` 过滤需要完整 ID（`publisher.name`），导致搜索不到任何配置项。已修正为 `@ext:kayuii.codex-status-pro`。

## [0.3.16] - 2026-05-13

### Bug 修复

- **彻底修复 `getRateLimits()` 返回错误值（P0）**：之前 `isRateLimitsNewer` 仅比较 `resets_at`，但同一个 window 内所有记录的 `resets_at` 完全相同。05/11 的 session 文件中，`resets_at=1778699210` 的记录有上百条，used_percent 从 1% → 2% → 21% → 26% 不断递增，但 `isRateLimitsNewer` 认为它们"相同"，只保留了**第一个遇到的**（2%）。
  - 现已改为**按 `timestamp` 选择最新记录**：`parseLine` 中遇到 rate_limits 时，比较记录的 `timestamp`，timestamp 更大才更新。
  - `resets_at` 降级为 tie-breaker：仅当两条记录 timestamp 完全相同时，才用 `resets_at` 打破平局。
  - 这与 codex-ratelimit-vscode 的选择策略一致（它也按 `timestamp` 取最新）。

## [0.3.15] - 2026-05-13

### Bug 修复

- **修复 `getRateLimits()` 因缓存跳过导致返回 null**：`getRateLimits()` 清空 `latestRateLimits` 后调用 `updateFileState`，但如果文件已在 `fileStates` 缓存中（未变化），`updateFileState` 直接返回现有对象而不重新解析，导致 `latestRateLimits` 始终为 null。现已改为强制重新读取文件并解析，确保每次都能正确提取 rate_limits。
- **修复 Dashboard 与状态栏/Tooltip 百分比不一致**：`buildKimiUsageData` 之前使用独立的优先级逻辑（`localEstimate` 优先），与状态栏的 `resolveWeeklyPct/resolveWindowPct`（API quota 优先）不一致。现已统一使用 `resolveWeeklyPct/resolveWindowPct`，确保三个界面显示相同的百分比。

## [0.3.14] - 2026-05-13

### Bug 修复

- **修复 `getRateLimits()` 读取到错误的旧 rate_limits**：用户本地 `~/.codex/sessions/` 中有多个 session 文件，其中 `2026/05/13` 的文件最后 rate_limits 是 `2%/46%`，而 `2026/05/11` 的文件在更晚时间（21:52）追加到了 `92%/63%`（接近官网真实值）。但由于 `fs.readdir` 按目录名顺序遍历，`2026/05/13` 排在后面，其旧值覆盖了前面的更新值。现已修复：
  1. `getRateLimits()` 每次调用前清空 `latestRateLimits`，避免被之前的扫描污染。
  2. 新增 `resets_at` 字段解析（本地 jsonl 使用绝对时间戳，而非 API 头中的 `resets_in_seconds`）。
  3. 新增 `isRateLimitsNewer()` 比较逻辑：只有遇到 `resets_at` 更大的 rate_limits 时才更新，确保始终保留最新值。
  4. `rateLimitsToQuota()` 优先使用 `resets_at` 计算重置时间，修复剩余时间显示错误。

## [0.3.13] - 2026-05-13

### Bug 修复

- **彻底修复百分比严重偏离官网（P0）**：
  1. **`resolveWeeklyPct` 优先级反转**：之前 `localEstimate.weeklyPct` 无条件优先于 `quota.weeklyUsedPct`，导致缓存恢复时默认值为 0、short tick 错误覆盖、本地 rate_limits fallback 污染后都会显示错误百分比。现已改为**API quota 为权威来源**，`localEstimate` 仅在四舍五入后与 API 值匹配时才用于保留小数精度。
  2. **本地 rate_limits 不再污染缓存**：API 失败 fallback 到本地 `rate_limits` 时，之前会调用 `processQuotaData` 将过时的本地值（如 2%/46%）写入 `~/.codex/codex-status-pro-cache-v1.json`，导致每次启动都加载错误数据。现已增加 `persistToCache` 参数，本地 fallback 时**只显示、不持久化**。
  3. **修复 `lastFetchAt` 被错误设为 `weeklyResetAt`**：`CACHE_LOADED` 之前将 `lastFetchAt` 设为 `quota.weeklyResetAt`（重置时间），导致 tooltip 显示错误，stale 检测混乱。现已改为使用缓存的 `fetchedAt` 字段。

## [0.3.12] - 2026-05-13

### Bug 修复

- **修复百分比严重偏离官网（P0）**：官网 5h 89%/7d 62%，扩展却显示 5h 2%/7d 46%。根因有两处：
  1. `archived_sessions` 中的过期 `rate_limits`（如 2%）覆盖了最新值。现已限制扫描范围，仅读取 `~/.codex/sessions/`，排除 `archived_sessions`。
  2. 多设备/headless 使用时本地 session 日志不完整，`calibration` 估算值远低于真实 API 值。现已增加漂移阈值保护：当 calibration 估算与现有 API quota 相差 >5% 时，保留 API 值，避免状态栏显示严重偏低的百分比。

## [0.3.11] - 2026-05-13

### Bug 修复

- **移除 JSONL 增量解析**：恢复全量解析，彻底消除文件前缀变化导致增量解析出错的潜在风险。codex-status-pro 全程只读 jsonl，不会写入或删除 session 文件。
- **short tick 不再用本地 rate_limits 覆盖 API 值**：只要 API 成功过（`quota` 存在），short tick 只使用 calibration 估算；仅在 API 完全不可用时才 fallback 到本地 `rate_limits`，避免过时的本地数据覆盖权威 API 百分比。

## [0.3.10] - 2026-05-13

### Bug 修复

- **修复 short tick 错误覆盖 API 百分比**：当本地 session 文件在当前周期内没有记录（`tokensThisCycle === 0`）时，calibration 估算会算出 `0%`，错误覆盖 API 返回的准确百分比。现已增加保护：只有当校准估算值 `> 0`（或 API 本身为 `0%`）时才允许 short tick 覆盖，防止状态栏显示错误的 `0%`。
- **恢复 tooltip Quota 表格显示**：之前因 Codex API 不返回绝对限额而隐藏了 Quota Summary 表格，导致 tooltip 中一个表格都没有。现已恢复显示。

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
