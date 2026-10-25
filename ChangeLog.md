# ChangeLog

## [0.6.5] - 2026-10-26

### 修复

- **Kimi Code 登录复用**（`src/providers/kimi/auth.ts`、`src/services/cacheService.ts`）：新增读取新版 `~/.kimi-code/credentials/kimi-code.json`，兼容旧版 `~/.kimi`、KIMI_CODE_HOME 和 KIMI_SHARE_DIR；共享有效登录优先于私有旧缓存，兼容秒/毫秒有效期并跟随官方客户端 token 更新。只读官方凭据，不复制共享 refresh token 或改写官方登录文件。
- **登录入口与反馈**（`src/presenters/dashboard.ts`、`src/presenters/statusBar.ts`、`src/i18n.ts`）：增加仪表盘“登录 / 重新连接”按钮，缺失凭据的 tooltip 提供所属模型的登录链接；连接、复用、验证码、浏览器失败、轮询异常、超时与成功均有中英文反馈。
- **登录后立即刷新**（`src/extension.ts`）：成功后立即刷新所属模型用量；浏览器授权在 Provider 选择队列外等待，不阻塞模型切换和 checkbox；网络刷新失败保留插件私有登录，避免临时网络问题清空凭据。

### 验证

- 新增凭据目录、token 更新、坏字段/过期回退、浏览器授权成功/失败及 UI 登录命令回归测试；类型检查、全部 255 项测试、生产编译和 VSIX 打包通过。授权网络测试使用模拟请求，未执行真实账号浏览器授权。
- 同步 Provider、配置/状态栏、Dashboard、编码规范、测试设计与文档索引。

## [0.6.4] - 2026-10-26

### 修复

- **无勾选模型时状态栏入口消失**（`src/config.ts`、`src/calc.ts`、`package.json`）：首次启动、空配置、旧 globalState 空数组或无有效 Provider 时默认勾选 Kimi；取消最后一个勾选项时自动恢复 Kimi。保留已有有效多选，不依赖当前仪表盘模型。
- **选择读取与保存一致**：通过纯函数 `normalizeStatusBarProviders()` 过滤未知 ID、去重并处理空选择；配置与降级存储均保存归一化结果。设置默认值及中英文说明同步更新。

### 验证

- 类型检查、全部 244 项测试、生产编译和 VSIX 打包通过；覆盖首次启动创建 Kimi 状态栏入口、空选择回退、多选保留及降级持久化。同步配置、Dashboard、本地估算与测试设计文档。

## [0.6.3] - 2026-10-25

### 修复

- **Codex 悬停详情隐藏五小时数据**（`src/presenters/statusBar.ts`）：无五小时限额时，隐藏五小时额度、重置时间及本地用量行，保留今日和每周用量；中英文行为一致。
- **周额度账号的本地 COST 统计边界**（`src/calc.ts`、`src/services/scheduler.ts`、`src/presenters/dashboard.ts`）：五小时成本分析使用最近五小时，修复虚构未来重置点导致已有历史记录被排除、COST 仍显示零值的问题，并兼容旧缓存锚点。

### 验证

- 新增 4 项回归测试；类型检查、全部 242 项测试、生产编译及 VSIX 打包通过。同步本地估算、Scheduler、状态栏、Dashboard 与测试设计文档。

## [0.6.2] - 2026-10-25

### 修复

- **Codex Pro 每周单窗口**（`src/calc.ts`、`src/providers/codex/api.ts`、`src/services/scheduler.ts`）：按窗口时长映射限额，修复 primary=10080 被误认为五小时、每周使用率错误显示为零的问题；兼容 Plus 双窗口及无时长旧记录。
- **隐藏不存在的五小时额度**（`src/presenters/dashboard.ts`、`src/presenters/statusBar.ts`）：每周单窗口账号的仪表盘 Current Usage、状态栏及额度 tooltip 只显示每周额度。
- **COST 实时刷新**（`src/services/scheduler.ts`）：短周期扫描同步更新已计价明细，修复新用量已扫描但统计卡片、曲线及明细仍停留在初始零值或旧数据的问题。COST 为本地 Token 用量按模型单价估算，不代表套餐账单。

### 验证

- 新增 8 项回归测试；类型检查、全部 238 项测试、生产编译和 VSIX 打包通过；同步设计文档。

## [0.6.1] - 2026-10-25

### 修复

- **模型 checkbox 不能勾选/多选**（`src/config.ts`、`src/presenters/dashboard.ts`、`src/extension.ts`）：实际 VS Code 日志显示 `statusBar.providers` 配置尚未注册，导致保存失败后选择被重置。增加 globalState 持久化降级路径，支持多选、全部取消及重启恢复；正常配置写入恢复后清理降级数据。
- **降级保存后状态栏未更新**：checkbox 保存成功后显式执行内部 `syncStatusBars` 命令，按既有串行队列更新选中模型，避免依赖不存在的配置变更事件；点击名称继续只负责切换仪表盘。

### 验证

- 新增实际未注册配置错误、状态栏实例更新、选择保留/全部取消、降级持久化恢复、正常写入后迁移清理及双重保存失败的回归测试；类型检查及全部 230 项测试通过，生产编译、VSIX 打包成功。
- 同步仪表盘与配置设计文档。

## [0.6.0] - 2026-10-25

### 新增

- **多模型状态栏选择**（`src/presenters/dashboard.ts`、`src/config.ts`、`package.json`）：仪表盘第一行平铺 Codex、Kimi、Claude、GLM、Cursor，每个名称前提供独立 checkbox；勾选控制状态栏显示，点击名称切换对应仪表盘。勾选结果保存到 `statusBar.providers`，支持多选、全部隐藏和跨窗口同步。
- **独立后台监控**（`src/extension.ts`）：每个 Provider 使用独立 Store、缓存、本地用量、历史与 Scheduler；已选模型及当前查看模型持续更新，后台模型刷新不会覆盖当前仪表盘。退出时按 Provider 持久化历史与窗口锚点。

### 修改

- **每个模型一个状态栏 cell**（`src/presenters/statusBar.ts`、`src/calc.ts`）：合并周使用率与 5h 使用率，例如 `$(openai) Codex:4.12% | 5️⃣ 5.32%`。整项颜色由周剩余额度决定；保留详情 tooltip、绝对值模式、来源提示和更新动画。
- **点击与详情操作绑定模型**：左键打开所属模型仪表盘，tooltip 的刷新、登录、详情操作携带对应 Provider 参数。切换仪表盘解除旧 Store 订阅；连续 checkbox 更新串行保存，防止勾选丢失。
- **配置隔离**（`src/config.ts`、`src/providers/*/pricing.ts`）：后台计价显式使用所属 Provider 私有配置，自动货币跟随该 Provider，保留用户自定义货币覆盖；区分未设置选择和显式空数组。

### 文档与验证

- 同步仪表盘、运行实例、Provider、本地估算及双语编码规范；记录多实例内存估算与 GLM/Cursor 现有占位能力。
- 新增单 cell、配色边界、双窗口文本、多 Provider 数据隔离、快速多选/全部取消、旧订阅解除和 WebView JavaScript 语法回归测试；类型检查及全部 227 项测试通过，生产编译和 VSIX 打包成功。

## [0.5.35] - 2026-10-25

### 新增

- **Claude 新模型定价**：Fable/Mythos 5.1、Sonnet 5/5.5、Haiku 5.5 独立计价，保留旧模型费率；Mythos 5 复用 Fable 5 的同价配置。
- **Codex 新模型定价**：GPT-6.1 Sol（$2/$10，缓存命中 $0.10）与 GPT-5.6 Sol（$4/$20，缓存命中 $0.40），避免落入旧模型价格；GPT-6 Sol 仍使用 $0.20 缓存命中价。
- **Kimi 新模型定价**：K3.1 Pro（¥13/¥68）、Highspeed（¥26/¥136），K2.7 Code（¥6.5/¥27）、Highspeed（¥13/¥54），分别配置缓存费率；兼容 Kimi Code 模型前缀别名。

### 修复

- **模型版本匹配**（`src/calc.ts`、`src/providers/kimi/pricing.ts`）：优先匹配具体版本并防止数字前缀误匹配，Kimi Provider 与配置共享映射；保留自定义价格和 Provider 配置优先级。
- **定价来源**（`src/config.ts`、`package.json`）：官方核验日期更新为 2026-10-25，Codex/Kimi 链接指向 API 定价；新增设置说明同时包含中英文。同步锁文件版本。

### 文档与验证

- 同步 Provider、本地估算、配置设计和索引，记录官方来源及标准费率适用范围：Haiku 5.5 默认使用输入 ≤100K 档，长上下文、缓存时长及处理档位暂不自动选价；API 等价成本不代表订阅实付费用。
- 新增 24 项定价回归测试，覆盖实际注册配置默认值、费用合计、版本边界、别名和零值/自定义覆盖；类型检查及全部 218 项测试通过，生产编译与 VSIX 打包成功。

## [0.5.34] - 2026-09-24

### 新增

- **Claude Opus 5.5 定价**（`src/providers/claude/pricing.ts`、`package.json`）：$4 / $20 每百万 token，cache read $0.20、cache write $5.00；`claude-opus-5-5` 独立计价，不再按 Opus 5 的 $5 / $25 计算。
- **GPT-6 定价（Codex）**（`package.json`）：gpt-6-astra $10 / $50（cache $1 / $12.5）、gpt-6-sol $2 / $10（cache $0.2 / $2.5）、gpt-6-luna $0.1 / $0.5（cache $0.01 / $0.125）；裸 `gpt-6` 按 Astra 计价。暂未区分 >272K 长上下文档位。
- 官方定价日期更新为 2026-09-24。

### 重构

- **模型名→定价配置键映射抽取为纯函数** `pricingModelKey()`（`src/calc.ts`），`ConfigService.getPricing()` 与 Claude Provider 共用。

### 测试

- **`pricingModelKey` 映射覆盖**（`test/calc.test.ts`）：Opus 5.5 与 Opus 5/4.8 区分、GPT-6 三档及默认档、Kimi 与其他模型兼容。

## [0.5.33] - 2026-09-07

### 修复

- **Claude 下 Fable 5 进度条再次消失**（`src/presenters/dashboard.ts`）：Fable 行现在由 Claude Provider 身份决定并固定显示，HTML 首屏也直接可见；scoped 权威数据暂不可用时显示 `0%`，不再因字段缺失、鉴权、限流或 Webview 消息时序隐藏整行。
- **Fable 部分 usage 响应被整体丢弃**（`src/providers/claude/api.ts`）：当 OAuth usage 只有 `weekly_scoped`、缺少 session/weekly_all 时，将 Fable 部分结果与 Messages headers 的总额度合并。
- **Fable scoped 字段兼容与限流修复**（`src/providers/claude/api.ts`）：模型标识兼容 model display name/id 和 limit label/name，百分比兼容 `percent`/`utilization`；OAuth usage User-Agent 改为 `claude-code/<version>` 形式；`Retry-After: 0` 改用默认 5 分钟退避。

### 测试

- **Fable 可见性与响应变体回归覆盖**（`test/claudeApi.test.ts`、`test/dashboard.test.ts`）：覆盖 Claude 无 scoped 数据时固定显示、Fable-only 响应合并、字段变体、User-Agent 和零值 Retry-After。

## [0.5.32] - 2026-09-07

### 修复

- **Fable 5 重置后未清零且进度条消失**（`src/calc.ts`、`src/presenters/dashboard.ts`、`src/services/scheduler.ts`）：已知 Fable 窗口到达重置时间后立即显示 `0%`；后续 API 暂时省略模型级字段时保留进度条并将重置时间推进到下一 7d 周期，新权威数据返回后正常覆盖。
- **重置时刻边界未推进周期**（`src/calc.ts`）：`resetAt` 恰好等于当前时间时现在会严格推进一个完整周期，不再停留在已经到达的重置点。

### 测试

- **Fable 重置状态回归覆盖**（`test/calc.test.ts`、`test/dashboard.test.ts`、`test/scheduler.test.ts`）：覆盖重置后百分比清零、进度条持续显示、API 字段缺失时保留额度，以及精确重置时刻的下一周期计算。

## [0.5.31] - 2026-09-07

### 修复

- **Claude Fable 5 空值误判**（`src/providers/claude/api.ts`）：`null`、空字符串等占位百分比不再被转换成 `0%`，共享窗口会继续使用 `limits[]` fallback，Fable 占位额度不会生成虚假进度条。
- **Claude 手动刷新仍返回旧数据**（`src/services/scheduler.ts`、`src/providers/base/types.ts`）：`force()` 现在会使 Provider 成功响应缓存失效，下一次 long tick 重新获取 usage；服务端限流退避仍然有效。
- **Claude usage 429 重复请求**（`src/providers/claude/api.ts`）：解析 `Retry-After` 秒数或 HTTP 日期，缺失时默认退避 5 分钟，退避期间直接走 Messages fallback。
- **Claude API Key 鉴权路径错误**（`src/providers/claude/auth.ts`、`src/providers/claude/api.ts`）：显式传递凭据类型；API Key 跳过 OAuth-only usage endpoint，并使用 `x-api-key` 请求 Messages API，OAuth 继续使用 Bearer 与 beta header。

### 测试

- **Claude 刷新、限流和凭据回归覆盖**（`test/claudeApi.test.ts`、`test/scheduler.test.ts`）：覆盖空值 fallback、Fable 空额度、显式缓存失效、429 退避、API Key header 分流和手动刷新缓存失效。

## [0.5.30] - 2026-09-06

### 修复

- **Claude Fable 5 进度条不显示**（`src/providers/claude/api.ts`、`src/services/scheduler.ts`）：改为优先读取 `GET /api/oauth/usage` 的 Fable `weekly_scoped` 配额，并加入 5 分钟缓存；OAuth usage 不可用时保留 Messages header 回退，并沿用尚未重置的最后有效 Fable 窗口。
- **VSIX 误包含本地用量 CSV**（`.vscodeignore`）：排除整个 `bin/**`，防止导出的 usage、quota 和 estimator CSV 被打进发布包。

### 测试

- **Claude API 与 Dashboard 回归覆盖**（`test/claudeApi.test.ts`、`test/dashboard.test.ts`）：覆盖 OAuth usage 解析、缓存、fallback，以及 Fable 进度条的 Provider 条件和排列位置。

## [0.5.29] - 2026-09-06

### 新增

- **Claude Fable 5 独立 7d 用量进度条**（`src/providers/claude/api.ts`、`src/presenters/dashboard.ts`）：解析 `anthropic-ratelimit-unified-7d_oi-utilization/reset`，并在 Current Usage 的总 7d 进度条下显示 Fable 5 百分比与重置时间；仅 Claude 且 API 返回该模型级额度时显示。
- **Fable 配额解析回归测试**（`test/claudeApi.test.ts`）：覆盖正常解析、字段缺失和百分比边界钳制。

## [0.5.28] - 2026-07-17

### 新增

- **Kimi k3.0 支持（按模型区分用量与定价）**：
  - **新 session 路径**：k3.0（Kimi Code）session 已迁移至 `~/.kimi-code/sessions/wd_<项目>_<hash>/<session-id>/agents/main/wire.jsonl`。`KimiLocalParser` 改为递归扫描 `~/.kimi-code/sessions` 与旧路径 `~/.kimi/sessions` 两个位置，旧 k2.6 数据继续只读兼容，互不重复计数。
  - **新用量格式**：解析 k3.0 的 `usage.record` 事件（`usage.{inputOther,output,inputCacheRead,inputCacheCreation}`，毫秒时间戳 `time`，仅统计 `usageScope: 'turn'`），旧 `StatusUpdate` 格式保持兼容。
  - **模型区分**：`model` 字段（如 `kimi-code/k3`）经 `normalizeKimiModel()` 归一化为 `kimi-k3`，Dashboard 的"模型使用量"与按模型图表自动分开展示 k3 / k2.6；无 model 字段的旧格式条目回退 `kimi-k2.6`，历史成本不受影响。
  - **k3 官方定价**（Kimi 开放平台 2026-07-16 公示）：input ¥20 / output ¥100 / cacheRead ¥2 / cacheWrite ¥20 每百万 token；k2.6 价格不变。`KimiPricingProvider` 按模型族分派定价（与 Claude 同构），新增设置项 `aiStatusHub.pricing.kimi.models.k3.*` 可自定义。

## [0.5.27] - 2026-06-11

### 修复

- **Claude/Kimi 模型单价读取失效（成本计算偏低约 60%）**：`config.getPricing()` 生成的设置 key 为全小写（`claudeopus` 等），与 package.json 注册的驼峰 key（`claudeOpus`/`claudeSonnet`/`claudeHaiku`）及 Kimi 的 `k2_6` 不一致。VS Code 配置读取大小写敏感，导致注册默认值和用户自定义值都读不到，全部回退到通用兜底价（input $2 / output $10 / cacheWrite $2）。例如 `claude-opus-4-8` 实际应按 $5/$25/$6.25 计费。现已统一为与注册名一致的 key，计算公式本身无误。

### 新增

- **Claude Fable 5 定价**：新增 `aiStatusHub.pricing.models.claudeFable.*` 设置与内置默认价（input $10 / output $50 / cacheRead $1 / cacheWrite $12.5 每百万 token），模型名含 `fable` 时自动匹配。
- **用户自定义模型价格**：新增 `aiStatusHub.pricing.customModels` 设置（设置页原生"添加项"按钮 + 键/值输入框）。键为模型名关键词（子串匹配，不区分大小写），值为 `input,output,cacheRead,cacheWrite`（USD/百万 token，兼容中文逗号），如 `10,50,1,12.5`。优先级高于内置模型价格，可用于覆盖任意模型单价。解析逻辑为 `calc.parseCustomPricing()` 纯函数，非法输入安全忽略。

### 改进

- **Official Pricing 链接更新**：Claude provider 的官方定价页改为 `https://platform.claude.com/docs/en/about-claude/pricing`（原 anthropic.com/pricing），`pricing.officialDate` 默认值更新为 `2026-06-11`。

## [0.5.26] - 2026-06-11

### 改进

- **Claude token 良性过期不再红色报警（优雅降级显示）**：长时间不使用 Claude Code 时 OAuth token 会过期（token 只在使用 Claude Code 时刷新），此前状态栏会被红色 `auth expired` 全占显示并隐藏所有用量信息——即使本地估算/缓存数据完全可用。现在：
  - 鉴权错误经 `calc.resolveAuthDisplayMode()` 三态判定：有缓存 quota 或本地估算数据时进入 **degraded** 模式——状态栏照常显示用量百分比，附加 🔐 指示器，无红色背景，5h 窗口项保持可见；tooltip 顶部显示警告条"令牌已过期，使用一次 Claude Code 后会自动恢复，或点击重新登录"（含登录链接），下方照常显示用量表格。
  - 完全无数据时（**blocked**）才保留红色 `auth expired/failed` 全占显示，且该分支现在也会更新 tooltip（修复旧 tooltip 残留问题）并附登录链接。
  - `missing`（从未登录）行为不变。
  - 状态栏指示器（💤 stale / 🌐 api / ⛓️‍💥 local / 🔐 auth degraded）统一收编到 `calc.buildIndicatorSuffix()` 纯函数，消除 statusBar.ts 中两处重复内联计算，动画期间指示器同步生效。
  - 新增 i18n key：`tooltip.authDegraded`、`tooltip.signInAction`（中英双语）。

## [0.5.25] - 2026-05-18

### 修复

- **Claude 空闲后状态栏变红、数据无法更新**：
  - `ClaudeAuthProvider` 检测到 OAuth token 过期时，**不再直接阻止 API 调用**，而是仍然返回 token 让 API 去验证。这样当 Claude Code VS Code 扩展在后台静默刷新 token 后，ai-status-hub 下一次 tick 就能自动恢复，无需用户手动触发。
  - `Scheduler` 在 API 返回 401 (`authFailed`) 时，现在会调用 `authService.invalidate()` 清除缓存的 token，确保下次 `resolveToken()` 重新读取凭证文件，与 Claude Code 的自动刷新机制配合。

## [0.5.24] - 2026-05-18

### 修复

- **Claude 状态栏显示 "sign in" 但 Claude Code 已登录**：`ClaudeAuthProvider` 现在支持多种凭证来源：
  1. 优先读取 `ANTHROPIC_API_KEY` 环境变量（与 Claude Code CLI 行为一致）
  2. 支持 `CLAUDE_CONFIG_DIR` 环境变量覆盖凭证路径
  3. 回退到默认路径 `~/.claude/.credentials.json`
- **OAuth token 过期与缺失状态混淆**：新增 `IAuthProvider.getAuthStatus()` 可选方法，`ClaudeAuthProvider` 现在能区分 token `expired`（凭证文件存在但 token 过期）和 `missing`（凭证文件不存在），状态栏会显示更准确的 `auth expired` 而非 `sign in`。
- **增强 Claude 认证诊断日志**：日志现在记录完整的凭证路径和失败分类（`ENOENT` / 空 token / 已过期）。

## [0.5.23] - 2026-05-18

### 修复

- **Claude/Kimi 网络异常时 scheduler 彻底停止**：Claude 和 Kimi 的 `fetch` 调用**没有超时控制**，网络半开连接或代理异常时请求会无限 hang 住，导致 `scheduler.tick()` 永远不会完成，timer 无法重新调度。现在两个 provider 均增加了 `AbortController` + **30 秒超时**，超时后返回 `networkError`，UI 会正确显示断网状态。
- **scheduler tick 无兜底保护**：即使 fetch 有了超时，作为调度器核心循环，`tick()` 现在使用 `Promise.race` 增加了**整 tick 60 秒兜底超时**，确保任何不可预知的 async 操作 hang 住时，`schedule()` 仍然会被调用，scheduler 不会彻底死亡。

## [0.5.22] - 2026-05-18

### 修复

- **长周期刷新 401 后 UI 无反馈且时间持续增加**：`API_ERROR` reducer 现在会更新 `lastFetchAt`（记录尝试时间），Dashboard 刷新按钮的计时器会在每次请求后归零重新计数，不再无限累加。
- **API 401 后错误信息被缓存覆盖**：`CACHE_LOADED` reducer 不再无条件清除 `error`，避免 API 认证失败后恢复缓存数据时隐藏错误提示。
- **认证过期状态无 UI 提示**：`authStatus === 'expired'`（由 401 触发）现在会被状态栏和 tooltip 正确识别，显示 `auth expired` 红色警告，并提供重新登录入口。
- **手动刷新"没反应"感知问题**：`scheduler.force()` 增加执行日志，便于在 Output 面板确认强制刷新已触发。

## [0.5.21] - 2026-05-18

### 修复

- **Claude 切换后仍显示 local-only 断网图标**：`ClaudeApiProvider` 现在优先使用 VS Code 内置的**原生 `fetch`**（Node.js 18+），回退到 `node-fetch`。原生 `fetch` 与 `claude-status` 参考工程一致，可避免 `node-fetch` 在特定网络/代理环境下的请求失败问题。
- **Claude 重置时间浮点精度丢失**：`parseResetInSeconds()` 中 `nowSec` 改为 `Math.floor(Date.now() / 1000)` 整数秒，并对绝对秒级时间戳的差值使用 `Math.round()`，防止当 reset 时间戳刚好略小于浮点 `nowSec` 时被错误截断为 0。
- **Anthropic 退役模型导致 Claude 404**：`claude-3-haiku-20240307` 已于 2026-04-20 被 Anthropic 正式退役，API 调用返回 `not_found_error`。probe 请求模型更换为当前可用的 **`claude-haiku-4-5-20251001`**。
- **未安装 Claude Code 时无法切换 provider**：当 `authStatus === 'missing'` 时，状态栏点击命令从 `aiStatusHub.signIn` 改为 `aiStatusHub.showDashboard`，确保用户总能打开 Dashboard 切换回其他 provider。
- **Claude 登录流程在未安装时卡住**：`ClaudeAuthProvider.startLoginFlow()` 现在会先检测系统是否安装了 `claude` 命令（`which claude` / `where claude`）。未安装时直接提示用户并提供 **Open Dashboard** 按钮，避免打开终端执行不存在的命令并轮询 120 秒。
- **增强 API 失败诊断日志**：`scheduler.ts` 的 `doLongTick()` 现在会在 token 缺失、API 异常、API 返回错误时分别输出日志，便于通过 Output 面板定位问题。

## [0.5.20] - 2026-05-17

### 修复

- **Claude 额度恢复后仍显示断线**：`API_SUCCESS` reducer 现在会在 `authStatus` 为 `'failed'` 或 `'expired'` 时主动恢复为 `'authenticated'`，避免额度耗尽导致的 403 错误永久锁定认证状态。
- **Tooltip 认证失败提示与状态栏不一致**：`StatusBarPresenter.buildTooltip()` 现在和 `render()` 保持一致，仅在 `state.error && state.authStatus === 'failed'` 时才显示 auth failed，避免 API 恢复后 tooltip 仍显示旧错误。
- **Claude `windowResetAt` 解析健壮性**：新增 `parseResetInSeconds()`，支持 Unix epoch（秒/毫秒）、ISO 8601 字符串和相对秒数四种格式，防止因 header 格式差异导致 `windowResetAt` 被错误设为当前时间、进而使窗口百分比始终归零。

## [0.5.19] - 2026-05-17

### 修复

- **Claude 点击 login 无反应**：`ClaudeAuthProvider` 新增 `startLoginFlow()`，点击状态栏 "sign in" 后会自动打开 VS Code 集成终端并执行 `claude login`，同时轮询检测登录凭证（最多 120 秒），完成后自动刷新状态栏与 Dashboard。
- **Claude Dashboard provider 标签错误**：`buildKimiUsageData` 中 `providerType` 不再硬编码为 `'openai'`，改为使用当前 `activeProvider`，Pricing & Settings 区域会正确显示 `claude`。
- **Claude 今日 Token 明细始终为 0**：`tokensOutDay` / `tokensCacheReadDay` / `tokensCacheCreateDay` 改为从 `localEstimate` 的 `tokensOutToday` / `tokensCacheReadToday` / `tokensCacheCreateToday` 读取，不再固定为 0。
- **Claude 过期 token 缓存未清除**：`resolveToken()` 检测到 token 过期时现在会同步清空 `cachedToken`，避免后续调用错误返回已过期凭证。

## [0.5.18] - 2026-05-16

### 修复

- **Dashboard Memory Usage 显示 stale 数据**：`LocalUsageService.aggregateFromProvider()` 返回的 `usageEntries` 未按时间戳排序，导致 Dashboard 的 `slice(-maxRows)` 取到的末尾片段可能不是最新数据。现已在聚合完成后统一按时间升序排列，Dashboard 和 CSV 导出均会正确显示最新记录。

## [0.5.17] - 2026-05-16

### 改进

- **Memory Usage 详情按时间倒序排列**：Dashboard 中 `Store.estHistory` 展开后的表格与 CSV 导出统一按**从新到旧**排列；`Store.usageEntries` CSV 导出也同步改为倒序，与表格显示保持一致。

## [0.5.16] - 2026-05-16

### 修复

- **Kimi 鉴权失败时状态栏卡住**：当 `resolveToken()` 返回 undefined（OAuth refresh 失败后凭证被清除或网络不通），`scheduler` 会 dispatch `AUTH_STATUS: 'missing'`，状态栏立即显示 `$(key) sign in` 登录提示，点击可跳转网页鉴权，不再一直转圈。
- **UI 标签优化**：状态栏 tooltip 和 Dashboard 的 5h/7d 重置时间前统一添加 "Reset time:" / "重置时间：" 前缀，提升可读性。

## [0.5.15] - 2026-05-15

### 修复

- **统一 5h / 7d 官方窗口起点**：新增 provider 隔离的窗口锚点，Dashboard、Detailed Usage、Token usage heatmap、Cost Curve 和本地估算统一使用同一组 `window5hStartMs` / `window7dStartMs`。
- **修复 Claude API 用量耗尽后的 7d 曲线空白**：API 失败时按「内存锚点 → 磁盘锚点 → 当前时间回推周期」恢复窗口，Claude JSONL 没有官方窗口起点时仍能用本地数据展示 7d 曲线。

### 改进

- **窗口锚点持久化**：`CacheService` 新增 `readWindowAnchors` / `writeWindowAnchors`，使用 `ai-status-hub-window-anchors-v1` schema 保存 5h/7d reset 与 start 元信息，并在插件退出时写盘。
- **发版测试覆盖**：新增 CacheService、Store、Scheduler、HistoryService 测试，覆盖锚点读写、登出清空、API 成功、磁盘恢复、fallback 与 Claude 无本地 rate_limits 场景。

## [0.5.14] - 2026-05-15

### 修复

- **修复 Claude API 失败时 7d Cost Curve 为空**：`getCostCurveOptions` 现在复用 Dashboard 的 5h/7d reset 推算，且 WebView 在 options 刷新后会将无效选择回退到第一个有效窗口，避免 quota 用尽/缓存恢复期间 7d 曲线请求落到空窗口。
- **隐藏 `<synthetic>` 内部数据**：Detailed Usage、Token usage heatmap、模型柱状图和 cost curve 聚合统一过滤 `<synthetic>` usage entry。

### 改进

- **Claude 模型展示顺序固定**：模型明细和热力图图例按 Haiku → Sonnet → Opus 排列，其余模型按名称稳定排序。

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
