# ChangeLog

## [0.5.13] - 2026-05-15

### 变更

- **工程 Fork 并改名为 AI Status Hub**：将扩展包名、展示名、命令 ID、配置命名空间、缓存文件名和文档中的当前工程名统一迁移到 `ai-status-hub` / `aiStatusHub`。
- **README 双语重写**：新增英文 `README.md` 与中文 `README.zh-CN.md`，说明项目从 Kimi-only 用量统计扩展为支持 Kimi / Claude / Codex / GLM / Cursor 的多 Provider 用量状态中心。
- **迁移项目级 skills**：提交 `.kimi/skills` 下的协作、编码和发版规则，并忽略本地临时 `.skills/` 目录，避免其进入 VSIX 包。
- **新增通用 AI 工具入口**：以 `.skills/` 作为共享 skills 主目录，并新增 `CLAUDE.md`、`GEMINI.md`、`.cursor/rules/ai-status-hub.mdc`、`.github/copilot-instructions.md`，让 Claude、Gemini、Cursor、Copilot 等工具能发现同一套项目规则。

## [0.5.12] - 2026-05-13

### 改进

- **localEstimate / quota 详情 Total 与总览 Size 保持一致**：
  - `estimateStateMemory` 中为 `localEstimate`（1024 bytes）和 `quota`（512 bytes）生成 `detailEntries`，包含每个字段的精确估算 + `object overhead` 项
  - Dashboard 中 `localEstimate` / `quota` 的展开详情改为统一读取 `memoryBreakdown.detailEntries` 渲染
  - 详情页 Total 行累加值 = 总览表格 Size 列显示值，消除不一致

## [0.5.11] - 2026-05-13

### 改进

- **非数组模块详情表格显示 object 并添加 Total**：
  - `Store.localEstimate` / `Store.quota` 不再跳过 object 类型，value 显示为 `[object]`，bytes 估算为 256
  - 每行根据实际类型估算 bytes：`number=8`、`boolean=4`、`string=2×length+8`、`null=0`
  - 表格底部新增 **Total** 行，累加所有项的 bytes，方便与模块总大小验证
  - `Store.storeOverhead` 同步添加 Total 行

## [0.5.10] - 2026-05-13

### 改进

- **非数组模块详情表格统一添加 bytes (est.) 列**：`Store.localEstimate` 和 `Store.quota` 的展开详情表格新增第三列 `bytes (est.)`，每个字段估算 8 bytes，与 `Store.storeOverhead` 风格保持一致

## [0.5.9] - 2026-05-13

### 改进

- **Dashboard Memory Usage 按钮间距优化**：内存标签 / 保存 / 保存全部 三个按钮间距从 8px 加大到 20px，减少误触
- **Save All 按钮去掉图标**：纯文字显示，与其他按钮风格统一
- **Store Overhead 展开详情增强**：不再只显示固定说明文本，改为显示详细的 component/value/bytes 表格，包含 activeProvider、displayMode、language、isPaused、authStatus、dataSource、listeners、reducer/dispatch 等 9 项 breakdown

## [0.5.8] - 2026-05-13

### 新增

- **Memory Usage 一键保存全部数据**：
  - 新增 `💾 Save All` / `💾 一键保存` 按钮，点击后弹出选择文件夹对话框
  - 在用户选中的文件夹下自动创建子目录（命名格式 `YYYYMMDD_HHMMSS`，如 `20260515_021115`）
  - 将所有有数据的模块（usageEntries / localEstimate / quota / estHistory）分别保存为各自 CSV 文件到该子目录
- **单独保存文件名添加时间戳后缀**：点击单个模块的 💾 保存按钮时，默认文件名后附加 `_YYYYMMDD_HHMMSS` 后缀，方便区分不同时间保存的数据

## [0.5.7] - 2026-05-13

### 改进

- **Dashboard 时间格式去掉毫秒**：`fmtTimestamp` 从 `YYYY-MM-DD HH:mm:ss.SSS` 改为 `YYYY-MM-DD HH:mm:ss`
- **详情表格滚动条**：展开表格（usageEntries / estHistory / localEstimate / quota）超出可见行数时显示垂直滚动条
- **`memoryDetailMaxRows` 扩容**：默认值 50 → 500，最大值 200 → 1000（控制传给 Webview 的最大数据条数）
- **新增 `memoryDetailDisplayMaxRows`**：默认值 40，范围 1–200，控制详情表格可见区域最大行数（滚动条阈值）
- **新增 `memoryDetailCellMaxChars`**：默认值 64，范围 8–256，控制详情表格每个单元格最大字符数
- **messageId 不再硬编码截断**：统一受 `memoryDetailCellMaxChars` 控制

## [0.5.6] - 2026-05-13

### 改进

- **Dashboard 时间格式化统一**：所有时间戳以 `YYYY-MM-DD HH:mm:ss.SSS` 显示（usageEntries / estHistory / quota 的 ResetAt 字段）
- **CSV 时间戳保持原始整数**：导出时不受格式化影响
- **EstHistoryEntry 新增窗口起始时间**：`windowStartMs`（5h 窗口开始）/ `weeklyStartMs`（7d 窗口开始），Scheduler 中通过 `resolveResetTime` 推算后填入
- **Dashboard estHistory 展开表格**：新增 `windowStartMs` / `weeklyStartMs` 两列，同步格式化显示

## [0.5.5] - 2026-05-13

### 改进

- **Estimator History 全面重构**：
  - `ApiHistoryEntry` 重命名为 `EstHistoryEntry`，扩展为 15 字段（新增 source/weeklyP/weeklyC/windowP/windowC）
  - `doShortTick` 现在也保存估算历史，可观察两次 API 调用之间的估算轨迹
  - timestamp 在存储、传输、显示、CSV 导出时均强制取整（`Math.round`）
  - 容量配置 `apiHistoryMaxEntries` 默认值提升至 10000，最大值 100000
  - Dashboard 展开表格支持 15 列（含 source 列，api*Pct 为 null 时显示 '-'）
  - CSV 导出同步更新为 15 字段

## [0.5.4] - 2026-05-13

### 新增

- **API 调用历史记录（ApiHistory）**：
  - 内存中滑动窗口保存最近 N 条 API 调用结果（FIFO），用于评估线性增量模型准确性
  - 9 个字段：timestamp（原始整数）/ apiWeeklyPct / apiWindowPct / estimatedWeeklyPct / estimatedWindowPct / localCost7d / localCost5h / weeklyK / windowK
  - 配置项 `apiHistoryMaxEntries`（默认 1000，范围 1–10000）
  - 配置项 `apiHistoryPersistOnExit` checkbox 控制是否在插件退出时写入磁盘 JSONL
  - 磁盘文件：`~/.codex/ai-status-hub-api-history-{provider}.jsonl`
  - Dashboard 内存表格新增 `Store.apiHistory` 模块，可展开详情并导出 CSV

## [0.5.3] - 2026-05-13

### 改进

- **Dashboard 内存详情全面增强**：
  - UsageEntry 展开表格展示全部 8 个字段（timestamp 显示原始 64 位整数 / inputOther / output / inputCacheRead / inputCacheCreation / cost / messageId / model）
  - 标题显示 `Recent usage entries (X/Y)`，X = 展示条数，Y = 总条数
  - 过滤 object 类型值，避免 `[object Object]` 污染
  - 新增配置项 `aiStatusHub.dashboard.memoryDetailMaxRows`（默认 50，范围 1–200）
  - 展开详情时内存按钮旁显示 💾 保存按钮，点击可将完整数据导出为 CSV

## [0.5.2] - 2026-05-13

### 改进

- **Dashboard 内存占用表格 UI/UX 全面优化**：
  - 按钮图标改为 `🔺🖥️`（展开）/ `🔻🖥️`（收起），更加直观
  - 表头（模块/内存大小/说明）和按钮文案支持 i18n 中英文切换
  - 模块名显示完整路径：`Store.usageEntries`、`Store.localEstimate`、`Store.quota`、`Store.storeOverhead`
  - 点击表格行可展开该模块具体存储数据（最多 20 条）：
    - `Store.usageEntries`：列出最近 20 条使用记录（时间/模型/费用）
    - `Store.localEstimate` / `Store.quota`：列出所有字段 key-value
    - `Store.storeOverhead`：显示固定说明文本

## [0.5.1] - 2026-05-13

### 新增

- **Dashboard 内存占用统计**：Current Usage 卡片新增 🧠 内存占用折叠表格
  - 按钮实时显示总内存（如 "🧠 内存占用 (15.32 MB)"）
  - 表格按模块内存从大到小排列：模块 | 内存大小 | 说明
  - 默认隐藏，点击按钮切换显示/隐藏
  - 每次短周期刷新自动更新数据
- 新增 `estimateStateMemory()` + `formatMemorySize()` 纯函数用于内存估算

## [0.5.0] - 2026-05-13

### 重构

- **统一 5h/7d 本地估算为线性增量模型**：
  - 删除旧的 capacity-based 校准（`tokenCapacity`、`windowCostCapacity`），替换为线性增量估算器 `ILinearEstimator`。
  - 每个窗口独立维护 `(P, C, k)`：P = 最近一次 API 百分比，C = 同一时刻本地费用，k = P / C（仅在 P > 5% 且 C > 0 时更新）。
  - Short tick 估算公式：`p = P + k * (c - C)`，实现 5h/7d 双窗口的平滑小数变化。
  - 7d 窗口本地度量从 `tokensThisCycle` 统一为 `costThisCycle`，与 5h 窗口同为 cost-based，跨厂商更通用。
- **缓存 schema 升级至 v3**：旧缓存自动失效，首次启动时使用 fallback 模式（k = 0），等待下次 API 成功后建立新的 k 值。

## [0.4.9] - 2026-05-13

### 修复

- **Tooltip 本地用量表格补全 Cache 列**：补充了之前遗漏的 `CacheR`（缓存读取）和 `CacheW`（缓存写入）两列，与 Dashboard 的详细用量表格保持一致。

## [0.4.8] - 2026-05-13

### 修复

- **Reset Time 过期后自动推算**：当 API 不可用时，cache 中的 `windowResetAt`/`weeklyResetAt` 过期后不再显示 `?` 或空字符串，而是根据周期（5h/7d）自动推算下一个重置时间点。
- **新增绝对时间显示**：Tooltip 和 Dashboard 中的重置时间格式统一改为 `下次重置时间 2026-05-17 02:25:00 (2d14h)`，同时显示绝对时间和剩余时间。
- **周期过期后用量归零**：`resolveWeeklyPct` / `resolveWindowPct` 在检测到 `resetAt` 过期后返回 0%，避免显示过期的旧用量。
- **本地用量统计范围修正**：`doShortTick` 和 Dashboard 聚合使用推算后的有效 `resetAt` 计算窗口起始时间，避免跨周期数据混入。

## [0.4.7] - 2026-05-13

### 修复

- **Tooltip 按钮点击失效**：`supportHtml = true` 时 markdown-it 将 `<div>` 内内容视为 HTML 块，不再解析 Markdown 链接语法 `[label](command:xxx)`。改用 HTML `<a href="command:xxx">` 标签，按钮点击恢复正常。
- **Tooltip 布局调整**：
  - "上次更新" 从按钮下方移到按钮上方，并追加版本号（如 `· v0.4.7`）。
  - 暂停按钮文字简化为 "Pause" / "Resume"（去除 "auto-refresh"）。
- **状态栏精简**：
  - 移除版本号 `itemVersion`，状态栏只保留 `itemWeekly` 和 `itemWindow`。
  - 暂停时 `itemWeekly` 仅显示厂商主图标（如 `$(openai)`），不显示任何文字。

## [0.4.6] - 2026-05-13

### 变更

- **Tooltip 底部操作按钮栏**：参考 `codex-ratelimit-vscode` 风格，在 tooltip 底部居中添加一行操作按钮（emoji 图标 + 蓝色命令链接）：
  - 🔄 Refresh → `aiStatusHub.refresh`
  - 📊 Show Details → `aiStatusHub.showDashboard`
  - ⚙️ Settings → `aiStatusHub.openSettings`
  - ⏸ Pause / ▶ Resume → `aiStatusHub.togglePause`
- **状态栏版本号显示**：在原来暂停按钮的位置（priority 102）添加蓝色版本号 `vX.Y.Z`（`statusBarItem.prominentForeground`），点击打开 Dashboard。

## [0.4.5] - 2026-05-13

### 变更

- **状态栏暂停按钮移至 Tooltip**：移除状态栏上的独立暂停按钮 (`itemPause`)，改为在 Tooltip 最后一行（更新时间右侧）显示 `[Pause auto-refresh]` / `[Resume auto-refresh]` 命令链接，点击即可切换暂停状态。
- **暂停时状态栏显示休眠指示器**：暂停时 `itemWeekly` 不再隐藏，而是显示 `🌘 Codex: paused`，方便用户知道扩展仍在运行只是被暂停。

## [0.4.4] - 2026-05-13

### 修复

- **Tooltip 表格改用 `<pre>` ASCII 字符表**：VS Code tooltip 中 HTML/CSS border 和 Markdown 原生表格的边框渲染均不可靠（受主题和 `supportHtml` 交互影响）。改用 `<pre>` 标签包裹 ASCII 字符表格（`+─┼─+` 边框 + 等宽字体对齐），确保边框可见、列对齐稳定。

## [0.4.3] - 2026-05-13

### 修复

- **Tooltip 表格最终稳定化**：
  - 配额汇总和本地用量表从 HTML `<table>` 改为 **Markdown 原生表格**，确保 VS Code tooltip 内正确显示边框和列对齐。
  - 本地用量表从 7 列精简为 4 列（Period / Input / Output / Cost），避免 tooltip 宽度过窄导致列挤压变形。
  - 全部 tooltip 内容合并为单次 `appendMarkdown` 调用，避免多次追加导致 markdown-it 块级解析边界错误。
  - 修复模板字符串中 `\\n` 字面量被显示为文本 `\n` 的问题。

## [0.4.2] - 2026-05-13

### 新增

- **Tooltip 全面彩色图像化**：参考 `codex-ratelimit-vscode` 的实现：
  - 进度条改为 SVG base64 data URI 彩色图像（`createSvgBar()`），颜色跟随利用率变化（白→黄→绿→粉→红），使用用户在设置中自定义的阈值颜色。
  - 配额汇总表和本地用量表改为 Markdown 表格，带边框和右对齐数字列。
  - Tooltip 启用 `supportHtml = true` 和 `isTrusted = true`，整体布局从 ASCII 代码块升级为 Markdown + HTML 混合渲染。
- **厂商私有定价配置**：`config.getPricing()` 现在优先读取厂商私有配置路径（`pricing.{provider}.models.{model}`），再回退到全局路径（`pricing.models.{model}`）。为 Kimi 新增 `pricing.kimi.models.k2_6.*` 四项定价配置项；Kimi 和 Claude 的 pricing provider 改为从配置读取，支持用户自定义。
- **官方定价链接按厂商切换**：`config.pricingOfficialUrl` 现在根据当前厂商返回对应链接（Kimi → moonshot.cn、Claude → anthropic.com、GLM → bigmodel.cn、Cursor → cursor.com、Codex → openai.com）。`package.json` 中 `pricing.officialUrl` 默认值改为空字符串，留空时自动使用厂商默认链接；用户仍可手动覆盖。

### 修复

- **切换厂商时货币自动切换**：`currency` 设置默认改为 `auto`（原 `USD`）。`auto` 模式下根据当前厂商自动推断货币：Codex/Claude/Cursor → USD（$），Kimi/GLM → CNY（¥）。Dashboard 在厂商切换时重建 HTML，货币符号同步更新。
- **修复 Kimi 默认模型名**：当本地 JSONL 中 usage entry 没有 model 字段时，原先 fallback 到全局 `defaultModelName`（`gpt-5`）。现在改为使用各厂商 pricing provider 的 `defaultModelName`（Kimi → `kimi-k2.6`）。
- **修复状态栏动画期间联网状态图标消失**：`triggerUpdateAnimation()` 现在从当前 state 计算 `staleIndicator`（💤）和 `sourceIndicator`（🌐/⛓️‍💥），并在月亮动画帧中保持显示，动画结束后再恢复常规渲染。

## [0.4.1] - 2026-05-13

### 新增

- **Claude Provider 完整实现**：
  - **鉴权**：读取 `~/.claude/.credentials.json` 的 OAuth accessToken，支持过期检查。
  - **API**：Anthropic `v1/messages` 探测请求，从 response headers 解析 rate limit（`anthropic-ratelimit-unified-5h-utilization`、`7d-utilization` 等）。
  - **本地扫描**：递归扫描 `~/.claude/projects/<hash>/*.jsonl`，解析 `type === 'assistant'` 的 usage，按 `requestId` 去重。
  - **定价**：USD（$），三模型支持（Opus $5/$25、Sonnet $3/$15、Haiku $1/$5 per M tokens），含 cache read/create 定价。
  - **UI**：图标 `$(claude)`，状态栏显示 "Claude Code Usage"。
- **Dashboard 模型用量卡片**：各聚合窗口（today / 5h / 7d / 30d / month / allTime）新增模型用量明细卡片，按 cost 降序排列，展示各模型的 tokens 和费用。
- **package.json 定价配置**：新增 `pricing.models.claudeOpus` / `claudeSonnet` / `claudeHaiku` 四项定价配置项，可在 VS Code 设置中自定义。

### 修复

- **配额百分比映射一致性**：Codex / Claude API 只返回 used_percent（无绝对限额）。统一将 `weeklyLimit` / `windowLimit` 设为 100，`weeklyUsed` / `windowUsed` 设为实际百分比值，确保 Tooltip 和 Dashboard 配额表格始终有数据可显示。
- **API 失败时本地数据回退**：当 Claude（或其他厂商）API 连接失败且本地 JSONL 不含 `rate_limits` 时，Scheduler 现在会主动扫描本地 session 文件并 dispatch `LOCAL_ESTIMATE`，确保状态栏至少显示本地用量数据（tokens、cost、entries），而不是一直显示加载动画。

## [0.4.0] - 2026-05-13

### 新增（重大功能）

- **多厂商切换架构（参考 tokscale 抽象方法）**：扩展从单一 Codex 监控改造为支持多厂商切换的通用编码助手用量监控。
  - **Provider Registry**：新增 `src/providers/registry.ts`，支持 Codex、Kimi、Claude、GLM、Cursor 五家厂商。Codex 和 Kimi 为完整实现，其余为占位接口（后续可逐步填充）。
  - **Dashboard 厂商切换下拉框**：顶部工具栏新增 `<select>` 下拉框，可实时切换当前监控的厂商，无需重启 VS Code。
  - **配置项 `aiStatusHub.provider`**：支持 `auto`/`codex`/`kimi`/`claude`/`glm`/`cursor`。`auto` 模式自动检测本地 session 目录（`~/.codex/sessions/`、`~/.kimi/sessions/`、`~/.claude/`）。
  - **各厂商数据完全隔离**：每个厂商有独立的缓存文件（`ai-status-hub-cache-v1-{providerId}.json`），切换时 Store 状态重置，Scheduler 重建。
  - **Kimi Provider 完整移植**：从参考工程 ai-status-hub 移植：
    - **鉴权**：OAuth device code flow + API Key + CLI credentials 文件 fallback
    - **API**：`api.kimi.com/coding/v1/usages` JSON body 解析
    - **本地扫描**：`~/.kimi/sessions/<session>/<conv>/wire.jsonl`，解析 `message.type === 'StatusUpdate'` 的 token_usage
    - **定价**：CNY（¥），k2.6 单模型（input ¥6.50/M，output ¥27.00/M）
  - **状态栏动态图标**：根据当前 provider 切换图标（Codex `$(openai)`、Kimi `🌘`、Claude `✴️`、GLM `🧠`、Cursor `💠`）。
  - **i18n 通用化**：`tooltip.title` 和 `dashboard.title` 从 "Codex Code Usage" 改为 "Code Assistant Usage"，适配多厂商场景。

### 架构改造

- `src/extension.ts`：重构 provider 激活逻辑，支持运行时切换和 Scheduler 重建。
- `src/store.ts`：新增 `activeProvider` 字段和 `SET_PROVIDER` action。
- `src/services/cacheService.ts`：缓存文件按 provider 隔离。
- `src/providers/base/types.ts`：`IAuthProvider` 新增可选 `initSecrets` 方法。

## [0.3.17] - 2026-05-13

### 新增

- **在 Settings UI 中恢复 `language` 配置项**：此前 `language` 的 setter 虽然保留在 `src/config.ts` 中，但已从 `package.json` 的 `contributes.configuration` 中移除，导致 Dashboard 语言切换按钮无法持久化到用户配置（fallback 到 store 内存）。现已将 `aiStatusHub.language` 重新加入 `package.json`，支持 `auto`/`en`/`zh-CN` 三档，与 VS Code 设置同步。

### Bug 修复

- **修复 Dashboard 设置按钮打开空设置面板**：`openSettings` 命令传入了错误的扩展 ID `@ext:ai-status-hub`（缺少 publisher 前缀）。VS Code 的 `@ext:` 过滤需要完整 ID（`publisher.name`），导致搜索不到任何配置项。已修正为 `@ext:kayuii.ai-status-hub`。

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
  2. **本地 rate_limits 不再污染缓存**：API 失败 fallback 到本地 `rate_limits` 时，之前会调用 `processQuotaData` 将过时的本地值（如 2%/46%）写入 `~/.codex/ai-status-hub-cache-v1.json`，导致每次启动都加载错误数据。现已增加 `persistToCache` 参数，本地 fallback 时**只显示、不持久化**。
  3. **修复 `lastFetchAt` 被错误设为 `weeklyResetAt`**：`CACHE_LOADED` 之前将 `lastFetchAt` 设为 `quota.weeklyResetAt`（重置时间），导致 tooltip 显示错误，stale 检测混乱。现已改为使用缓存的 `fetchedAt` 字段。

## [0.3.12] - 2026-05-13

### Bug 修复

- **修复百分比严重偏离官网（P0）**：官网 5h 89%/7d 62%，扩展却显示 5h 2%/7d 46%。根因有两处：
  1. `archived_sessions` 中的过期 `rate_limits`（如 2%）覆盖了最新值。现已限制扫描范围，仅读取 `~/.codex/sessions/`，排除 `archived_sessions`。
  2. 多设备/headless 使用时本地 session 日志不完整，`calibration` 估算值远低于真实 API 值。现已增加漂移阈值保护：当 calibration 估算与现有 API quota 相差 >5% 时，保留 API 值，避免状态栏显示严重偏低的百分比。

## [0.3.11] - 2026-05-13

### Bug 修复

- **移除 JSONL 增量解析**：恢复全量解析，彻底消除文件前缀变化导致增量解析出错的潜在风险。ai-status-hub 全程只读 jsonl，不会写入或删除 session 文件。
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

- **完整迁移**：从 `ai-status-hub` 迁移至 `ai-status-hub`，全面支持 OpenAI Codex CLI 的用量监控与状态追踪。
- **Provider 抽象层**：引入统一的 Provider 架构（`IProvider`），将认证、API 配额、本地用量解析、定价策略与 UI 表现完全解耦，为未来多 Provider 扩展奠定基础。

### 功能

- **Codex 认证**：自动读取 `~/.codex/auth.json`，解析 JWT `id_token` 获取账户信息，使用 `access_token` 作为 Bearer Token。
- **API 配额监控**：通过向 Codex API 发送探测请求，从响应头中提取 `x-codex-primary-*`（5 小时窗口）与 `x-codex-secondary-*`（7 天窗口）的速率限制使用率与重置时间。
- **本地 JSONL 用量解析**：扫描 `~/.codex/sessions/**/*.jsonl` 与 `archived_sessions`，基于 `last_token_usage` 增量（delta）逻辑精确计算每轮对话的 token 消耗，支持模型追踪与缓存 token 钳位。
- **成本估算**：内置 USD 定价（默认 `gpt-5` 模型），支持通过 `aiStatusHub.currency` 配置币种符号（默认 `$`）。
- **状态栏 UI**：使用 `$(openai)` Codex 图标，更新动画替换为 `['🎆','🎇','✨️']`，所有文案统一为 Codex 品牌。

### 技术细节

- **Delta 解析逻辑**：直接适配 tokscale Rust 实现，处理 `last_token_usage` 为增量、总用量 stale regression 防护、缓存 token 上限钳制。
- **文件 I/O 隔离**：仅 `LocalUsageService` 与 `CacheService` 执行磁盘访问。
- **国际化**：所有用户可见字符串通过 `makeT()` 管理，新增 Codex 专用词条。
- **测试**：99 项测试全部通过，覆盖认证、API、缓存、计算、历史、调度与状态栏。
