# AI Status Hub v2 仪表盘设计文档

## 0.6.20 缩短费用标签（2026-11-09）

按用户要求，GLM 表头及金额标签使用简短的 Cost / 费用，移除占空间的 API-equivalent cost (estimated) / API 等价费用（估算）长标签；窗口金额前缀复用通用费用标签。API 等价估算与套餐积分的解释保留在说明区域，计价逻辑不变。

## 0.6.19 GLM API 等价金额（2026-11-09）

GLM 的详细用量、模型明细、费用表头与窗口费用标签改为“API 等价费用（估算）”，并解释按模型 API 费率估算、不是套餐实扣、与积分额度不成比例。其他模型保留既有标签。数据仍来自 LocalUsageService 对同一份日志逐请求重新计价，未知历史费率/工具额外费用等限制见 Provider 定价文档。

## 0.6.18 对账口径（2026-11-09）

详细用量各时间页增加“总 Token（含缓存）”，使用 HistoryService 聚合的 totalTokens，不在 WebView 内重复计算。输入栏明确为“不含缓存”，总量为互斥的未缓存输入、输出、缓存读、缓存写之和。详细用量及状态栏 tooltip 注明来自本机/拷回日志，与网站今日对账应选择“今日”；5h 配额窗口为独立时间范围。真实 GLM 副本重扫得到今日 4,256,270 Token，不能将账号网站的 4.32M 直接解释为相同窗口或完整本地记录。

## 0.6.17 GLM 查询诊断（2026-11-09）

weeklyQuotaAvailable=false 时周进度显示红色 `⚠ —`，独立保留 7d 本地费用；5h 额度、绝对用量模式正常展示。quotaError 携带 GLM 查询的脱敏失败信息，通过 textContent 填入红色警告，配额刷新恢复后清除。成功读取 5h 但未提供周额度时，不显示虚假的周使用百分比。

## 0.6.16 未登录与缺失配额展示（2026-11-09）

数据新增 `KimiUsageData.quotaAvailable`，复用 calc.hasQuotaData，独立于本地 Token/请求数/费用/历史图表。缺少配额或校准依据时，5h/7d 百分比显示红色 `⚠ —`，清除进度填充、重置时间与估算徽标，显示红色缺失配额提示；窗口费用和本地统计继续保留。配额恢复后恢复百分比、颜色与时间。无配额时隐藏 Claude Fable 行。费用注明为本地估算，不代表账单。登录按钮继续发送当前 Dashboard Provider 的 signIn 命令。

> 版本：v2.0.0-draft  
> 日期：2026-05-10  
> 基准：Claude Status Ex v0.5.4 仪表盘  
> 状态：待评审  

---

## 1. 设计基准说明

本文档以 `claude-status` 扩展的仪表盘为设计基准，提取其核心功能、布局风格和交互模式，适配到 Kimi 场景：

- **当前**：Kimi 只有 `k2.6` 一个模型，所有用量都归入该模型
- **未来**：Kimi 可能开放多个模型（如轻量版、专业版等），架构必须预留扩展点
- **货币**：Claude 使用 USD（$），Kimi 使用 RMB（¥）
- **数据源**：Claude 从 `~/.claude/projects/**/assistant.jsonl` 读取；Kimi 从 `~/.kimi/sessions/**/wire.jsonl` 读取

---

## 2. 整体布局（从上到下）

```
┌─────────────────────────────────────────────────────────────────────┐
│  Kimi Code 用量                    [🏠️] [↻ 刷新] [🔣] [⚙]           │  ← Header
├─────────────────────────────────────────────────────────────────────┤
│  CURRENT USAGE                                                      │  ← Current Usage Card
│  ┌───────────────────────────────────────────────────────────────┐   │
│  │ 5h 窗口  ￥12.34 — 重置于 1h23m              [▰▰▰▰▰▰▱▱▱▱] 62.1% │   │
│  ├───────────────────────────────────────────────────────────────┤   │
│  │ 7d 窗口  ￥45.67 — 重置于 2d14h              [▰▰▰▰▰▰▰▰▱▱] 80.3% │   │
│  └───────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  费用变化曲线                                    [▲ 收起]           │  ← Cost Curve Card
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ 5h 曲线  [日期▼] [小时▼]    ┌─────────────────────────────┐ │   │
│  │                           │  折线图 + 散点标记            │ │   │
│  │                           └─────────────────────────────┘ │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │ 7d 曲线  [选择窗口▼]        ┌─────────────────────────────┐ │   │
│  │                           │  折线图 + 散点标记            │ │   │
│  │                           └─────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  定价与设置                                      [▲ 收起]           │  ← Pricing & Settings Card
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │  [Kimi.ai]  [API 已启用]  [缓存 TTL: 5m]                     │   │
│  │  ⚙ 编辑定价与设置                                             │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  明细（ClaudeCodeUsage）                         [▲ 收起]           │  ← Detailed Usage Card
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [5h 窗口] [7d 窗口] [30d 窗口] [今日] [本月] [所有]          │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  ¥123.45  消息: 42  Input: 12k  Output: 3k  CacheW: 1k ...   │   │  ← Summary Grid
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  模型使用量                                                   │   │
│  │  ┌───────────────────────────────────────────────────────┐   │   │
│  │  │ k2.6                              ¥100.00             │   │   │
│  │  │ Input: 10k ($3.00/M)  Output: 2k ($27.00/M) ...      │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  每日使用量（可点击展开小时明细）                              │   │
│  │  ┌────┬────────┬──────────┬─────────┬─────────┬──────┐     │   │
│  │  │日期│ 费用   │ Input    │ Output  │ CacheW  │ 消息 │     │   │
│  │  ├────┼────────┼──────────┼─────────┼─────────┼──────┤     │   │
│  │  │5.10│ ¥12.34 │ 1,234    │ 567     │ 89      │ 5    │     │   │
│  │  └────┴────────┴──────────┴─────────┴─────────┴──────┘     │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  使用历史 (90 天)                                [▲ 收起]           │  ← Usage History Card
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ [5h 窗口] [7d 窗口] [30d 窗口] [最近 30 天]                   │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  Token 用量热力图 (input + output)                            │   │
│  │  ┌───────────────────────────────────────────────────────┐   │   │
│  │  │  M   J   J   A   S   O   N   D   J   F   M   A   M   │   │   │
│  │  │  ■ ■ □ ■ ■ ■ □ □ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■   │   │   │
│  │  │  □ ■ ■ ■ □ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■   │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  │  少 ████████████████████████████████████████████████ 多      │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  费用热力图 (RMB)                                            │   │
│  │  ┌───────────────────────────────────────────────────────┐   │   │
│  │  │  ■ ■ □ ■ ■ ■ □ □ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■ ■   │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  按日 Token（近 30 天）                                       │   │
│  │  ┌───────────────────────────────────────────────────────┐   │   │
│  │  │  ████ ████ ████ ████ ████ ████ ████ ████            │   │   │
│  │  │  k2.6(紫) / 其他(蓝) / 总计(橙)                       │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  ├─────────────────────────────────────────────────────────────┤   │
│  │  按日费用 RMB（近 30 天）                                     │   │
│  │  ┌───────────────────────────────────────────────────────┐   │   │
│  │  │  ████ ████ ████ ████ ████ ████ ████ ████            │   │   │
│  │  └───────────────────────────────────────────────────────┘   │   │
│  └─────────────────────────────────────────────────────────────┘   │
├─────────────────────────────────────────────────────────────────────┤
│  最后更新：刚刚 · v0.3.2                                            │  ← Footer
└─────────────────────────────────────────────────────────────────────┘
```

---

## 3. 视觉风格规范

### 3.1 颜色系统

完全使用 VS Code 主题变量，确保在任意主题下可读：

| 元素 | CSS 变量 | 用途 |
|---|---|---|
| 页面背景 | `--vscode-editor-background` | body 背景 |
| 正文文字 | `--vscode-editor-foreground` | 主要文字 |
| 描述文字 | `--vscode-descriptionForeground` | 标签、hint |
| 卡片背景 | `--vscode-sideBar-background` | `.card` 背景 |
| 卡片边框 | `--vscode-panel-border` | `.card` 边框 |
| 按钮背景 | `--vscode-button-background` | button 默认 |
| 按钮文字 | `--vscode-button-foreground` | button 文字 |
| 按钮悬停 | `--vscode-button-hoverBackground` | button:hover |
| 输入框背景 | `--vscode-input-background` | input、.summary-item |
| 输入框边框 | `--vscode-input-border` | input 边框 |
| 进度条轨道 | `--vscode-scrollbarSlider-background` | `.progress-track` |
| 进度条填充 | `--vscode-progressBar-background` | `.progress-fill` |
| 警告色 | `--vscode-editorWarning-foreground` | utilization >= 75% |
| 错误色 | `--vscode-editorError-foreground` | limitStatus === 'denied' |
| 成功徽章 | `#0e4429` 背景 + `#39d353` 文字 | API enabled badge |
| 警告徽章 | `--vscode-inputValidation-warningBackground` | API disabled badge |
| 链接色 | `--vscode-textLink-foreground` | `.configure-link` |
| 列表悬停 | `--vscode-list-hoverBackground` | table row hover |
| 验证警告背景 | `--vscode-inputValidation-warningBackground` | `.alert.warning` |
| 验证警告边框 | `--vscode-inputValidation-warningBorder` | `.alert.warning` |
| 验证错误背景 | `--vscode-inputValidation-errorBackground` | `.alert.error` |
| 验证错误边框 | `--vscode-inputValidation-errorBorder` | `.alert.error` |

### 3.2 字体

```css
body {
  font-family: var(--vscode-editor-font-family, monospace);
  font-size: var(--vscode-font-size);
}
```

数字表格使用等宽字体（继承 `var(--vscode-editor-font-family)`），确保对齐。`

### 3.3 间距系统

| 元素 | 值 |
|---|---|
| 页面内边距 | `16px` |
| 卡片内边距 | `12px 16px` |
| 卡片间距 | `12px` |
| 卡片圆角 | `4px` |
| 按钮内边距 | `4px 12px` |
| 按钮圆角 | `2px` |
| Tab 圆角 | `999px`（pill 形状） |
| Summary item 圆角 | `8px` |
| Model item 圆角 | `6px` |
| 进度条高度 | `8px` |
| 进度条圆角 | `4px` |

### 3.4 响应式

- 双列布局（`.two-col`）：`grid-template-columns: 1fr 1fr`
- 小屏幕（`< 480px`）：折叠为单列 `grid-template-columns: 1fr`
- Summary grid：`repeat(auto-fit, minmax(140px, 1fr))`
- Model metrics：`repeat(auto-fit, minmax(108px, 1fr))`

---

## 4. 各区块详细设计

### 4.1 Header

**布局**：Flex 行，`justify-content: space-between`

**左侧**：`<h1>` 标题文字，字体 `1.2em`，weight `600`

**操作区**：模型选择区通过 `flex-basis: 100%` 独占一行；从 🏠️ 登录按钮开始的操作按钮组固定另起一行，gap `8px`，窄窗口内继续自动换行（0.6.13）。

| 按钮 | ID | 功能 |
|---|---|---|
| ↻ 刷新 | `btn-refresh` | 触发 `refresh` message |
| 🏠️ | `btn-signin` | 登录 / 重新连接当前 Provider |
| 🔣 | `btn-toggle` | 切换 cost/percent 模式 |
| ⚙ | `btn-settings` | 打开 VS Code 设置 |

**刷新状态**：点击后按钮变为旋转的 `⟳` 图标（CSS animation `spin 1s linear infinite`），disabled，刷新完成后恢复。

---

### 4.2 Current Usage Card

**标题**：`CURRENT USAGE`（大写，0.75em，letter-spacing 0.08em，灰色）

**内容**：1~3 条进度条（5h 必显示，7d 可选；Claude 固定追加 Fable 5 独立 7d 进度条）

每条进度条结构：
```
┌─────────────────────────────────────────────────────────────┐
│ 5h 窗口  $12.34 — 重置于 1h23m              [▰▰▰▰▰▰▱▱▱▱] 62%│
├─────────────────────────────────────────────────────────────┤
│████████████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░│
└─────────────────────────────────────────────────────────────┘
```

**百分比模式**（Kimi 默认）：
- 右侧显示百分比 `62.1%`
- 进度条下方小字显示 `resets in 1h23m`
- 利用率 >= 80% 时显示 `⚠` 警告标记
- limitStatus === 'denied' 时显示 `✗` 并红色进度条

**成本模式**（预留）：
- 右侧显示费用 `¥12.34`
- 下方小字显示 `cost: ¥12.34`

**进度条颜色逻辑**：
- `< 75%`：`--vscode-progressBar-background`（默认蓝/主题色）
- `>= 75%`：`--vscode-editorWarning-foreground`（黄色）
- `denied`：`--vscode-editorError-foreground`（红色）

**宽度动画**：`transition: width 0.3s ease`

**Claude Fable 5 独立额度**：
- `activeProvider === 'claude'` 且 quota 含 `fableWeeklyUsedPct` 时，在总 7d 进度条正下方显示 `Fable 5 · 7d window`
- 百分比优先来自 Claude OAuth usage 响应的 Fable `weekly_scoped` 项，header 路径的 `anthropic-ratelimit-unified-7d_oi-{utilization,reset}` 作为兼容回退
- Fable 行始终显示百分比；达到 75% / 90% 时复用 warning / error 配色
- 已知 Fable 窗口到达重置时间后立即显示 `0%`，并把重置时间推算到下一 7d 周期；后续 API 暂时未返回模型级字段时仍保留该行，直到新周期权威数据到达
- Claude Provider 固定显示该行；HTML 首屏即按 Provider 设置可见性，不依赖异步 update 消息解除 `display:none`。首次取得 scoped 数据前以 `0%` 占位，避免因鉴权、429、部分响应或 Webview 消息时序导致整行消失。其他 Provider 不显示该进度条

---

### 4.3 Cost Curve Card（可折叠）

**标题行**：左侧 `费用变化曲线`，右侧 `[▲ 收起]` toggle 按钮

**窗口来源**：Cost Curve 的 5h / 7d options 与 Dashboard 聚合、Detailed Usage、Token usage heatmap 共用 `state.windowAnchors` 中的 `window5hStartMs` / `window7dStartMs`。没有锚点时才使用当前时间回推周期作为临时 fallback。

**内容**：两个子区块，上下排列

#### 4.3.1 5h 曲线

**控制行**：`日期 [▼]  时间 [▼]`（两级下拉选择）

- **日期下拉**：按日期分组，选项格式 `5.10`、`5.11` 等
- **时间下拉**：按小时分组，选项格式 `00`、`01`、...、`23`
- 选择后通过 `postMessage` 请求数据
- 默认跟随当前窗口：刷新前选择的是上一份列表的最新窗口时，5h / 7d 列表更新后自动选中新的当前窗口，5h 日期和 Hour 同步更新，支持跨日及跳过多个周期。
- 手动选择历史日期、Hour 或 7d 窗口后保留历史选择；选回当前窗口即恢复自动跟随。选择已移出列表时回退到最新有效窗口。
- 每次渲染更新下拉 change 处理器，使用最新 options，避免事件闭包持有首次列表；日期切换同时同步所选窗口、Hour 和请求范围。
- 收起期间沿用最后一次渲染的当前窗口标识，展开时根据最新 options 恢复跟随。Claude API 用量耗尽/403 时仍使用窗口锚点生成 options，避免 7d 曲线请求空窗口。

**图表**：`<canvas id="costcurve-5h">`

- Chart.js `type: 'line'`
- 线条颜色：`#00c853`（绿色）
- 线条宽度：`2px`
- tension：`0.05`（轻微平滑）
- 点半径：`0`（不显示点）
- 散点标记：同颜色，radius `1`，hoverRadius `6`
- X 轴：`type: 'linear'`，时间格式 `HH:MM:SS`
- Y 轴：`callback: v => '¥' + v`
- tooltip：`title` 显示完整时间，`label` 显示 `¥xx.xxxx`

#### 4.3.2 7d 曲线

**控制行**：`选择窗口 [▼]`（单级下拉）

**图表**：`<canvas id="costcurve-7d">`

- 线条颜色：`#7c4dff`（紫色）
- tension：`0.35`（更平滑）
- X 轴时间格式：`M.D-HH:MM`
- 其他同 5h

**数据加载状态**：切换选择后，先清空图表显示 pending 状态（空线），150ms 后若数据未返回则显示 loading，数据返回后渲染。

**防止 stale response**：收到 `costCurve` message 时，检查 `startMs` 是否与当前选择匹配，不匹配则忽略。

---

### 4.4 Pricing & Settings Card（可折叠）

**标题行**：左侧 `定价与设置`，右侧 `[▲ 收起]`

**内容**：

```
┌─────────────────────────────────────────────────────────────┐
│  [Kimi.ai]  [API 已启用]  [缓存 TTL: 5m]                     │
│  ⚙ 编辑定价与设置                                             │
└─────────────────────────────────────────────────────────────┘
```

**徽章样式**：
- 提供商标签：圆角 pill，背景 `--vscode-badge-background`，文字 `--vscode-badge-foreground`
- API enabled：深绿背景 `#0e4429`，亮绿文字 `#39d353`
- API disabled：警告背景色

**编辑链接**：`⚙ 编辑定价与设置`，点击打开 VS Code 设置面板（`workbench.action.openSettings`）

---

### 4.5 Detailed Usage Card（可折叠）

**标题行**：左侧 `明细（ClaudeCodeUsage）`，右侧 `[▲ 收起]`

**Tab 栏**（pill 样式）：
```
[5h 窗口] [7d 窗口] [30d 窗口] [今日] [本月] [所有]
```

- 当前激活 tab：背景 `--vscode-button-secondaryBackground`，文字 `--vscode-button-secondaryForeground`
- 非激活 tab：透明背景，边框 `--vscode-panel-border`
- 点击切换 tab 时重新渲染内容（不请求新数据，数据已预加载）
- 5h / 7d tab 的统计范围来自同一组窗口锚点；API 不可用时不会单独按 Dashboard quota 或当前时间重新推算

**每个 tab 的内容结构**：

#### A. Summary Grid（概览卡片）

```
┌──────────┬──────────┬──────────┬──────────┬──────────┬──────────┐
│ 费用      │ 消息数    │ Input    │ Output   │ 缓存写入  │ 缓存读取  │
│ ¥123.45  │ 42       │ 12,345   │ 3,456    │ 1,234    │ 567      │
└──────────┴──────────┴──────────┴──────────┴──────────┴──────────┘
```

- 6 个卡片，grid 布局：`repeat(auto-fit, minmax(140px, 1fr))`
- 卡片样式：背景 `--vscode-input-background`，边框 `--vscode-input-border`，圆角 `8px`
- 标签：0.8em，灰色
- 数值：1.1em，bold，等宽字体

#### B. Model Breakdown（模型使用量）

```
┌─────────────────────────────────────────────────────────────┐
│ k2.6                                          ¥100.00       │
├─────────────────────────────────────────────────────────────┤
│ Input: 10k ($3.00/MTok)  Output: 2k ($27.00/MTok)           │
│ CacheW: 1k ($6.50/MTok)  CacheR: 500 ($1.10/MTok)           │
│ 消息: 42                                                    │
└─────────────────────────────────────────────────────────────┘
```

- 每个模型一个 `.model-item` 卡片
- 头部：模型名（左，bold）+ 总费用（右，bold）
- 指标：5 列 grid（Input / Output / CacheW / CacheR / 消息）
- 每个指标两行：数值 + 单价（灰色小字）
- **多模型扩展**：当 `modelBreakdown` 有多个 key 时，依次渲染多个 `.model-item`
- **排序**：Claude 系列固定按 Haiku → Sonnet → Opus 排列，其余模型按名称稳定排序
- **过滤**：`model === '<synthetic>'` 的内部汇总数据不进入 Detailed Usage 展示

#### C. Breakdown Table（明细表格）

**今日 tab**：显示按小时统计的表格

**其他 tab**：显示按日/月统计的表格

```
┌──────┬────────┬──────────┬─────────┬─────────┬─────────┬──────┐
│ 日期  │ 费用    │ Input    │ Output  │ CacheW  │ CacheR  │ 消息 │
├──────┼────────┼──────────┼─────────┼─────────┼─────────┼──────┤
│ 5.10 │ ¥12.34 │ 1,234    │ 567     │ 89      │ 12      │ 5    │
│ 5.11 │ ¥23.45 │ 2,345    │ 1,234   │ 123     │ 45      │ 8    │
└──────┴────────┴──────────┴─────────┴─────────┴─────────┴──────┘
```

- 表头：sticky，`top: 0`，背景 `--vscode-sideBar-background`
- 首列左对齐，其余右对齐
- 数字列使用等宽字体
- 行 hover：`--vscode-list-hoverBackground`
- **可点击展开**（日/月粒度）：
  - 日行点击 → 展开该日的小时明细表格
  - 月行点击 → 展开该月的日明细表格
  - 展开状态由 `data-ccu-day` / `data-ccu-month` attribute 标记
  - 未缓存数据时显示 `计算中…`，同时 `postMessage` 请求数据

---

### 4.6 Usage History Card（可折叠）

**标题行**：`使用历史 (90 天) [▲ 收起]`（天数动态显示）

**Tab 栏**：`[5h 窗口] [7d 窗口] [30d 窗口] [最近 30 天]`

- 切换 tab 时重新渲染热力图和图表
- 数据使用 `heatmap` message 中预计算的多种粒度
- 5h / 7d 周期从窗口锚点起算，与 Detailed Usage 和 Cost Curve 保持一致
- 热力图和模型柱状图不展示 `<synthetic>` 内部汇总数据；Claude 模型图例按 Haiku → Sonnet → Opus 排列

#### 4.6.1 Token 用量热力图

**标题**：`Token 用量热力图（input + output）`

**Hint**：`色温：蓝（低）→ 红（高）  日志时间已按本机时区归入日历日与时刻。`

**日历网格**：
- 每格 `12px × 12px`，圆角 `2px`，gap `2px`
- 布局：`grid-template-rows: repeat(7, 12px)`，`grid-auto-flow: column`
- 每 7 行为一周（周日到周六）
- 顶部月份标签：当某列包含新月份的前 7 天时显示月份缩写

**颜色映射**（冷→暖）：
```
低值: rgb(13, 71, 161)   // 深蓝
高值: rgb(191, 54, 12)   // 深红
```

线性插值公式：
```javascript
function heatmapColor(t) {
  t = Math.max(0, Math.min(1, t));
  const c0 = [13, 71, 161];
  const c1 = [191, 54, 12];
  const r = Math.round(c0[0] + (c1[0] - c0[0]) * t);
  const g = Math.round(c0[1] + (c1[1] - c0[1]) * t);
  const b = Math.round(c0[2] + (c1[2] - c0[2]) * t);
  return `rgb(${r},${g},${b})`;
}
```

**归一化**：`(value - minValue) / (maxValue - minValue)`

**零值处理**：当所有值都为 0 时，所有格子显示边框色（不填充红蓝）

**Tooltip**：鼠标悬停显示日期 + 具体数值 + 消息数

**图例**：
```
少 ████████████████████████████████████████████████ 多
```
（`48px` 宽的水平渐变条）

#### 4.6.2 费用热力图

同 Token 热力图，但数据为 `cost`，标题为 `费用热力图（RMB）`

#### 4.6.3 按日 Token 柱状图

**标题**：`按日 Token（近 30 天，横轴 月.日；并列 k2.6 / 总计）`

**Chart.js 配置**：
- `type: 'bar'`
- 数据集（kimi 初期只显示 2 个，预留多模型扩展）：
  - `k2.6`：颜色 `#7c4dff`（紫色）
  - `总计`：颜色 `#ff9800`（橙色）
- 未来多模型时增加：
  - 轻量版：颜色 `#00a8e8`（蓝色）
  - 其他模型：颜色 `#00c853`（绿色）
- X 轴标签：`M.D` 格式（如 `5.10`）
- Y 轴：从 0 开始
- tooltip：显示完整日期 `YYYY-MM-DD`
- 高度：根据容器宽度按比例计算（`canvas.height = width * chartHeightRatio`，默认 `ratio = 0.4`）

#### 4.6.4 按日费用柱状图

同 Token 柱状图，但数据为 `cost`，Y 轴 label 前缀 `¥`

---

### 4.7 Footer

```
最后更新：刚刚 · v0.3.2
```

- 左侧：`最后更新：` + 时间（`< 60s` 显示 `刚刚`，否则显示 `Xm` / `Xh` / `Xd` 前）
- 数据新鲜度标签：
  - `api` → 不显示额外标签
  - `stale` → `（过期）`
  - `cache` → `（实时）`
- 右侧：扩展版本号 `· vX.Y.Z`

---

## 5. 数据接口设计

### 5.1 WebView → Extension 消息

| type | 参数 | 触发时机 |
|---|---|---|
| `ready` | 无 | WebView 加载完成 |
| `refresh` | 无 | 点击刷新按钮 |
| `toggleMode` | 无 | 点击 🔣 按钮 |
| `openSettings` | 无 | 点击 ⚙ 或编辑定价链接 |
| `setBudget` | `amount: number \| null` | 保存/清除预算 |
| `getCostCurveOptions` | 无 | Cost Curve 展开且 options 未加载 |
| `getCostCurve` | `window: '5h' \| '7d'`, `startMs`, `endMs` | 选择时间窗口后 |
| `getHourlyData` | `date: string` (YYYY-MM-DD) | 点击日明细行 |
| `getDailyData` | `month: string` (YYYY-MM-01) | 点击月明细行 |

### 5.2 Extension → WebView 消息

| type | 数据 | 用途 |
|---|---|---|
| `update` | 完整 `DashboardMessage` | 全量刷新所有区块 |
| `setDisplayMode` | `mode: 'cost' \| 'percent'` | 切换显示模式 |
| `costCurveOptions` | `CostCurveOptions` | 返回可用时间窗口列表 |
| `costCurve` | `window, startMs, endMs, points: CostCurvePoint[]` | 返回曲线数据 |
| `hourlyDataResponse` | `date, data: HourlyBreakdownRow[]` | 返回某日小时明细 |
| `dailyDataResponse` | `month, data: DailyBreakdownRow[]` | 返回某月日明细 |

### 5.3 DashboardMessage 数据结构

```typescript
interface DashboardMessage {
  // 1. 当前用量（API / 缓存）
  usage: KimiUsageData;

  // 2. 本地聚合明细（JSONL 扫描）
  dashboard: DashboardAggregates | null;

  // 3. 热力图数据
  heatmap: HeatmapData | null;

  // 4. 成本曲线选项
  costCurveOptions: CostCurveOptions | null;

  // 5. 定价配置
  pricing: TokenPricing;
  modelPricing: Record<string, TokenPricing>; // 模型级别定价，预留多模型

  // 6. 设置
  settings: DashboardSettings;
}

interface KimiUsageData {
  // API 数据
  utilization5h: number;      // 0~1
  utilization7d: number;      // 0~1
  utilizationFable7d?: number;// Claude Fable 独立 7d，用量 0~1
  resetIn5h: number;          // 秒
  resetIn7d: number;          // 秒
  resetInFable7dText?: string;
  limitStatus: 'allowed' | 'allowed_warning' | 'denied';
  has7dLimit: boolean;
  hasFable7dLimit: boolean;
  providerType: string;

  // 本地 JSONL 聚合
  cost5h: number;
  costDay: number;
  cost7d: number;
  tokensIn5h: number;
  tokensOut5h: number;
  tokensCacheRead5h: number;
  tokensCacheCreate5h: number;
  tokensInDay: number;
  tokensOutDay: number;
  tokensCacheReadDay: number;
  tokensCacheCreateDay: number;
  tokensIn7d: number;
  tokensOut7d: number;
  tokensCacheRead7d: number;
  tokensCacheCreate7d: number;

  // 元数据
  lastUpdated: Date;
  cacheAge: number;           // 秒
  dataSource: 'api' | 'cache' | 'stale' | 'no-credentials' | 'no-data' | 'local-only';
}

interface DashboardUsageData {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalCost: number;
  messageCount: number;
  modelBreakdown: Record<string, {
    inputTokens: number;
    outputTokens: number;
    cacheCreationTokens: number;
    cacheReadTokens: number;
    cost: number;
    count: number;
  }>;
}

interface DashboardAggregates {
  today: DashboardUsageData | null;
  thisMonth: DashboardUsageData | null;
  allTime: DashboardUsageData | null;
  window5h: DashboardUsageData | null;
  window7d: DashboardUsageData | null;
  window30d: DashboardUsageData | null;
  hourlyForToday: HourlyBreakdownRow[];
  dailyForThisMonth: DailyBreakdownRow[];
  monthlyForAllTime: DailyBreakdownRow[]; // date 为 YYYY-MM-01
  allTimeStart: string | null;
  allTimeEnd: string | null;
}

interface DailyBreakdownRow {
  date: string; // YYYY-MM-DD
  data: DashboardUsageData;
}

interface HourlyBreakdownRow {
  hour: string; // "00:00".."23:00"
  data: DashboardUsageData;
}

interface HeatmapData {
  daily: DailyUsage[];
  dailyByModel: DailyModelBreakdown[];
  cycles5hByModel: DailyModelBreakdown[];
  cycles7dByModel: DailyModelBreakdown[];
  cycles30dByModel: DailyModelBreakdown[];
  generatedAt: Date;
}

interface DailyUsage {
  date: string;      // YYYY-MM-DD local time
  cost: number;      // RMB
  sessionCount: number;
  tokensTotal: number;
}

interface DailyModelBreakdown {
  date: string;
  tokensTotal: number;
  costTotal: number;
  // 预留多模型扩展
  tokensK26?: number;
  costK26?: number;
  tokensLite?: number;
  costLite?: number;
}

interface CostCurveOptions {
  options5h: { label: string; startMs: number; endMs: number }[];
  options7d: { label: string; startMs: number; endMs: number }[];
  current5hStartMs: number;
  current7dStartMs: number;
}

interface CostCurvePoint {
  tMs: number;
  cumulativeRmb: number | null;
  sample?: boolean;
}

interface DashboardSettings {
  provider: string;
  apiEnabled: boolean;
  cacheTtlSeconds: number;
  weeklyBudget: number | null;
  chartHeightRatio: number;
}

interface TokenPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheCreatePerMillion: number;
}
```

---

## 6. 多模型扩展设计

当前 Kimi 只有 `k2.6`，但架构必须预留多模型支持。

### 6.1 数据层

```typescript
// modelBreakdown 的 key 为模型名
modelBreakdown: {
  'k2.6': { inputTokens: 10000, outputTokens: 2000, cost: 100.0, ... },
  'k2.6-lite': { ... }, // 未来新增
}
```

### 6.2 定价层

```typescript
modelPricing: {
  'k2.6': { inputPerMillion: 6.50, outputPerMillion: 27.00, ... },
  'k2.6-lite': { inputPerMillion: 1.50, outputPerMillion: 6.00, ... },
}
```

### 6.3 图表层

柱状图数据集动态生成：
```javascript
const modelColors = {
  'k2.6': '#7c4dff',
  'k2.6-lite': '#00a8e8',
  'other': '#00c853',
};
const datasets = Object.keys(modelBreakdown).map(model => ({
  label: model,
  data: byModel.map(d => d[`tokens${modelKey}`] || 0),
  backgroundColor: modelColors[model] || modelColors.other,
}));
// 始终添加 Total 数据集
datasets.push({ label: '总计', data: byModel.map(d => d.tokensTotal), backgroundColor: '#ff9800' });
```

### 6.4 UI 层

Model Breakdown 区块根据 `modelBreakdown` 的 key 数量动态渲染多个 `.model-item`。

---

## 7. 与 Claude 仪表盘的差异对照

| 功能 | Claude | Kimi v2 |
|---|---|---|
| **Project 成本分析** | ✅ 有（按 `~/.claude/projects` 目录聚合） | ❌ 移除（Kimi 无项目概念） |
| **探针请求统计** | ✅ 有（probeStats，API 余量探测） | ❌ 移除（Kimi 无此机制） |
| **预测卡片** | ❌ 已移除 | ❌ 不实现 |
| **多模型** | ✅ Opus/Sonnet/Haiku | 🔄 当前仅 k2.6，架构预留 |
| **百分比模式** | ✅ Claude.ai 专属 | 🔄 可选，默认成本模式 |
| **7d 进度条** | ✅ 可选显示 | ✅ 保留 |
| **Cost Curve** | ✅ 5h + 7d | ✅ 保留 |
| **Detailed Usage** | ✅ 6 tabs | ✅ 保留 |
| **Usage History** | ✅ 热力图 + 柱状图 | ✅ 保留 |
| **预算告警** | ✅ Daily + Weekly | ✅ 保留 |
| **货币单位** | USD ($) | RMB (¥) |
| **数据源** | `~/.claude/projects/**/assistant.jsonl` | `~/.kimi/sessions/**/wire.jsonl` |

---

## 8. 实现要点

### 8.1 避免闪烁

- 热力图静态结构使用 `el.__heatmapStatic` 缓存，数据更新时只更新 DOM 内容，不重建 HTML
- Chart.js 图表实例复用（`hourlyChartTokens` / `hourlyChartCost`），数据更新时 `update('none')`
- Cost Curve 图表同样复用实例
- 同一 5h/7d 时间窗口刷新时保留已有曲线，直到新数据到达；150ms pending 只在目标窗口范围与当前图表范围不同时清空旧曲线，不能因响应较慢清空同一窗口。
- canvas 高度仅在创建 Chart.js 实例前初始化；已有实例的数据更新不再写入 `canvas.height`（即使赋值相同也会清空位图，且可能覆盖高 DPI 分辨率），后续响应式尺寸由 Chart.js 管理；高度比例配置改变时更新 `options.aspectRatio` 并调用 `resize()`，比例不变时不主动 resize。此规则同时适用于费用曲线及 Token/费用柱状图。

### 8.2 懒加载

- 热力图数据不在 `update` message 中强制包含，WebView `ready` 后单独请求
- Cost Curve 数据在卡片展开时才请求
- Drilldown 数据（小时/日明细）在点击时才请求

### 8.3 防止 stale response

- Cost Curve 选择改变后立即发送请求；150ms 后若仍未收到目标窗口响应，再隐藏其他窗口的旧曲线。同窗口刷新期间保留曲线。
- 收到响应时检查 `startMs` 是否与当前选择匹配
- `getCostCurveOptions` 使用与 Dashboard 聚合同一套 5h/7d reset 推算，确保 Claude API 失败回退本地数据时，7d 曲线窗口与热力图窗口一致
- 不匹配则忽略（用户已切换选择）

### 8.4 XSS 防护

- 所有动态插入的字符串必须经过 `esc()` 转义：
```javascript
function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
```

### 8.5 CSP

```html
<meta http-equiv="Content-Security-Policy" content="
  default-src 'none';
  script-src 'nonce-{nonce}' https://cdn.jsdelivr.net;
  style-src 'unsafe-inline';
  img-src data:;
  connect-src 'none';
">
```

---

## 9. 文件结构

```
src/
├── presenters/
│   └── dashboard.ts          # DashboardPanel 类 + HTML 模板
├── webview/
│   ├── heatmap.ts            # 热力图数据聚合（复用或重构）
│   └── dashboardUsage.ts     # 本地 JSONL 聚合（复用或重构）
└── types.ts                  # DashboardMessage 等类型定义
```

---

---

## 10. 内存占用表格（v0.5.1+）

### 10.1 概述

Current Usage 卡片底部提供可折叠的内存占用表格，展示 `AppState` 各模块的估算内存占用。

### 10.2 模块列表

| 模块名 | 数据来源 | 说明 |
|---|---|---|
| `Store.usageEntries` | `state.usageEntries` | 保留期内的原始消息条目 |
| `Store.localEstimate` | `state.localEstimate` | 本地估算状态（P/C/k + 聚合费用） |
| `Store.quota` | `state.quota` | API 配额数据 |
| `Store.estHistory` | `state.estHistory` | 估算器历史（api + short tick，v0.5.5 新增） |
| `Store.storeOverhead` | 固定 | Store 监听器、UI 状态、Provider 引用 |

### 10.3 展开详情

点击表格行可在该行下方展开详情区域：
- `Store.usageEntries`：显示最近 N 条（`memoryDetailMaxRows` 配置）完整字段（timestamp/inputOther/output/inputCacheRead/inputCacheCreation/cost/messageId/model），标题显示 `Recent usage entries (X/Y)`
- `Store.localEstimate` / `Store.quota`：列出所有 key-value 对，过滤掉 object 类型值
- `Store.estHistory`：显示最近 N 条完整字段（timestamp/source/apiWeeklyPct/apiWindowPct/estimatedWeeklyPct/estimatedWindowPct/localCost7d/localCost5h/weeklyP/weeklyC/weeklyK/windowP/windowC/windowK），标题显示 `Estimator History (X/Y)`
- `Store.storeOverhead`：显示固定说明文本

### 10.4 CSV 导出

展开某行详情时，内存按钮旁出现 💾 按钮，点击可将该模块的**完整数据**（不限于展示的 N 条）导出为 CSV：
- `Store.usageEntries` → `usage-entries.csv`
- `Store.localEstimate` → `local-estimate.csv`
- `Store.quota` → `quota.csv`
- `Store.estHistory` → `est-history.csv`

CSV 使用 UTF-8 编码（带 BOM），字符串字段自动转义引号。

---

*文档结束。Phase 3 实现时以此文档为准，无需参考 claude-status 源码。*

## 多模型选择与状态栏联动（0.6.0，2026-10-25）

仪表盘 Header 移除 Provider 下拉框，平铺注册表中的 Codex、Kimi、Claude、GLM、Cursor。这里的“模型”指现有 Provider 入口，不表示同一家服务的每个 API 型号。GLM、Cursor 保持原有占位 Provider 能力。

- 每个入口由独立 checkbox 和模型名称按钮组成，checkbox 只修改状态栏显示集合，点击名称只切换该模型仪表盘。按钮支持键盘焦点，当前模型有高亮与 `aria-pressed`，checkbox 有双语可访问名称。
- `aiStatusHub.statusBar.providers` 保存勾选集合；自 0.6.4 起未设置、显式 `[]` 或没有有效 Provider 时均默认勾选 Kimi，避免状态栏入口消失。读取时检查 VS Code configuration inspect 的用户/工作区值，避免隐式数组默认值被误判为用户已取消所有勾选。
- WebView 使用 `setStatusBarProvider`（providerId、checked）与 `setProvider` 消息，宿主验证 Provider 和字段类型。复选框更新串行执行，避免快速连续勾选覆盖上一个更新；配置事件同步其他窗口和已打开 WebView 的 checkbox。
- `DashboardPanel` 保持单面板。切换时解除旧 Store 订阅并绑定目标 Store，重新生成页面，防止后台模型的刷新覆盖当前仪表盘。点击名称不会改变已保存的勾选集合。
- 后台仅刷新已选模型及当前查看模型；取消勾选不会中断当前正在查看的仪表盘。自 0.6.4 起取消最后一个勾选时自动恢复 Kimi，始终保留一个状态栏入口。

状态栏每个已选 Provider 仅创建一个 `StatusBarItem`，例如 `$(openai) Codex:4.12% | 5️⃣ 5.32%`；前者是周使用率，后者是 5 小时使用率。保留绝对值显示、数据来源/过期/认证提示和更新动画；动画中同样保留两个窗口数值。左键始终打开所属 Provider 的仪表盘，暂停时也遵循该行为；恢复暂停可通过 tooltip 操作。

整项字体颜色仅由周剩余额度决定，沿用已有使用率颜色设置：周剩余额度 >80% 为 lt20 色，(60%,80%] 为 lt40 色，(40%,60%] 为 lt60 色，(20%,40%] 为 lt80 色，≤20% 为 gte80 色；5 小时使用率不影响整项颜色。格式与阈值选择统一放在 `calc.ts` 的 `formatProviderStatus()`、`remainingQuotaColor()`。

悬停显示原有 5h/7d 详情；tooltip 中刷新、详情、登录命令携带所属 Provider 参数。货币优先服从用户 currency 配置，否则使用该 Provider 的货币，与当前查看的仪表盘无关。

验证见 `test/dashboard.test.ts`、`test/statusBar.test.ts`、`test/multiProvider.test.ts` 和 `test/calc.test.ts`：全部入口渲染、勾选与切换分离、连续勾选/全部取消、旧订阅解除、内嵌 JavaScript 语法、独立 Store/服务、单 cell、详情命令参数、两窗口格式、周剩余额度边界颜色。

### 复选框保存失败兼容修复（0.6.1，2026-10-25）

实际 VS Code 日志曾返回 `aiStatusHub.statusBar.providers is not a registered configuration`。扩展宿主可能运行新版代码，而窗口的设置注册信息尚未刷新；此时 checkbox change 消息已发出，但配置写入失败，旧实现重新发送原选择覆盖刚勾选的状态，表现为不能单独勾选或多选。

现在 ConfigService 在配置写入失败时使用 ExtensionContext.globalState 保存选择；重启后仍可读取降级选择；自 0.6.4 起旧空数组会回退为 Kimi。配置写入成功时清理降级存储，继续使用正常配置。两种写入路径均失败时返回 false，不伪装保存成功。

WebView 保存成功后显式执行 `aiStatusHub.syncStatusBars`，通过扩展串行队列协调已选 Provider 的 Presenter 和 Scheduler；不依赖配置变更事件，因此降级保存也会立即反映到状态栏。名称按钮仍仅切换仪表盘，checkbox 不触发仪表盘切换。内存仅增加最多五个 Provider ID，远低于 1KB，不增加用量条目。

回归测试 `test/multiProvider.test.ts` 模拟实际未注册配置错误，覆盖连续勾选两个模型、状态栏实例启动、切换仪表盘不影响勾选、全部取消、降级存储恢复、正常写入后清理降级数据及双重保存失败。

### Codex 每周单窗口与成本刷新（2026-10-25）

Current Usage 的五小时行由 `usage.has5hLimit` 控制：false 时初始 HTML 与后续 update 均隐藏该行，只显示每周额度。存在真实五小时额度的套餐继续显示。历史分析中的五小时成本分组是本地统计区间，与套餐限额无关。Scheduler 短周期更新 Store.usageEntries 后，COST 卡片、热力图和曲线使用最新已计价明细。

### 周额度账号的 COST 分析边界（0.6.3）

没有五小时限额时，Dashboard 的本地五小时成本分析采用最近五小时，即 now-5h 到 now，不使用不存在的配额重置锚点。即使旧缓存仍保留未来五小时重置点，也不会排除最近历史记录。

### 空选择默认 Kimi（0.6.4，2026-10-26）

首次启动、历史配置或 globalState 为 []、以及清理无效模型后没有有效选择时，checkbox 和状态栏统一采用 Kimi。用户取消最后一个勾选时，保存归一化后的 [kimi] 并同步界面；已有非空有效多选保持原样，不因切换仪表盘而新增 Kimi。

### 登录与重新连接（0.6.5，2026-10-26）

Header 的登录 / 重新连接按钮显示 🏠️，cost/percent 切换按钮显示 🔣（0.6.12）。图标通过中英双语字典获取，保留原文字作为 title 和 aria-label。WebView 发送 signIn，宿主使用当前 Dashboard Store 的 activeProvider 调用 aiStatusHub.signIn，避免认证到其他模型。Kimi 优先复用已有有效共享登录；否则启动浏览器授权。状态栏在缺失凭据时也提供明确登录链接。

登录开始、复用、验证码、浏览器打开失败、授权异常/失败/超时和成功均有反馈。成功立即刷新用量；浏览器授权等待期间仍可切换模型与勾选状态栏入口。保持状态栏主点击打开所属仪表盘的行为。

### 未登录模型的历史显示（0.6.14，2026-11-09）

切换或勾选未登录 Provider 时，Scheduler 先把本地日志聚合发布到对应 Store，再等待认证及官方 API。Dashboard 沿用 Store 更新链路显示本地费用、Token 和历史，不以远端配额完成为前提；无本地记录时沿用现有空数据展示。首次本地扫描仍需实际读取日志，不保证零延迟显示。

状态栏选择和 Dashboard 模型切换不等待认证请求。取消勾选且该 Provider 已非当前 Dashboard 时，调度停止并清除加载状态，迟到的认证和扫描结果不再回填；当前 Dashboard 的 Provider 仍按既有规则保持调度。其他勾选 Provider 的状态栏保持独立。

## 0.6.23 火山统计

供应商列表增加“火山”，可单独打开 Dashboard 和勾选状态栏。总 Token、模型分组、费用曲线使用火山独占的 Claude entries，金额默认人民币。费用说明通过 `volcengine.costExplanation` 明确 API 估算、未包含缓存存储和套餐积分，K2.8/未知模型未配置单价时仅计 Token；并提示裸 GLM/Kimi 模型需指定归属。无配额时保留已有本地统计展示，不伪造套餐百分比。

## 0.6.27 Coding Plan 套餐额度

火山已有模型 API Key 时再次点击登录，选择“连接 Coding Plan 套餐”，配置账户 AK/SK；验证成功后沿既有 signIn 刷新调度。Dashboard 展示官方 5 小时/每周百分比，并增加可选“订阅月”进度行及服务端重置时间；切换无月额度的供应商时隐藏该行。套餐错误通过 quotaError 显示，即使保留旧快照也提示查询失败。

percentOnly 为 true 时，绝对值模式仍显示百分比，不显示归一化的 /100 为请求数。月重置时间只使用服务端值，不按固定 30 天推算；无值显示破折号。状态栏 tooltip 同步三窗口，隐藏虚构的绝对额度汇总，保留原本本地 Token/API 等价费用统计。

## 0.6.30 Kimi 月度额度

Kimi 复用订阅月进度行并标记为“会员月度共享额度”，新增“Kimi Code 月度额度”独立行；状态栏 tooltip 同步两池百分比和实际重置时间。月字段各自独立、可选，0% 仍显示，接口未返回则隐藏。切换供应商或新快照缺少月字段时不会残留旧池。新套餐无周限制时隐藏周行；仅月额度快照的状态栏显示月百分比。加油包的月消费上限不作为套餐月度额度展示。

## 0.6.31 Kimi 月度缺失状态可见

0.6.30 在未获取 monthlyUsedPct 时会隐藏整行，用户看不到新增入口。现在 Kimi 的会员月度共享额度区域在初始 HTML 和刷新后始终可见：缺少值显示破折号与“尚未获取月度额度”，附官方订阅页入口；收到合法值（含 0）后显示实际百分比/重置时间并隐藏缺失提示链接。Code 月池仍仅在实际返回时显示。不将未知值显示为 0%，不从本地费用推算。

打开/切换已有数据的仪表盘立即请求刷新，不仅显示旧缓存等待周期轮询；新运行实例已有立即启动 tick，在尚未发起请求或正在加载时不重复强制刷新，避免延迟首轮请求或破坏认证挂起行为。

## 0.6.32：Current Usage 零费用显示

五小时与周窗口的本地估算费用不再按大于零条件隐藏：零值显示 COST ¥0.00（币种跟随对应供应商设置），正值保留两位小数。费用仍按各供应商当前周期聚合，不将周期外历史费用或官方配额折算为本地费用。Dashboard 消息新增 cost5hText / cost7dText，调用 calc.ts 的 fmtCurrency 生成，WebView 只组合现有双语费用标签并显示文本。

## 0.6.33：GLM 五小时费用与历史一致

GLM 的 Dashboard 本地五小时统计、热力图与成本曲线当前范围统一从 now−5h 开始，有无状态锚点均相同；服务端 resetAt 仍用于官方配额提示。周统计继续跟随官方订阅周周期。修正日志渠道归属后，13 点后切回 GLM 官方的点号 Flash 回复重新计入 GLM，自火山移除。费用保持 API 按量等价估算，与官方积分百分比独立。

## 0.6.34：Kimi 会员额度入口

月度字段缺失时的官方会员额度链接改为 https://www.kimi.com/settings/subscription?tab=quota，与用户确认可访问的额度页面一致。保留月度占位及已有数据显示行为。

## 0.6.35：DeepSeek 官方账户余额

DeepSeek Dashboard 的 Current Usage 增加账户余额行，显示官方返回币种的总余额、赠送余额、充值余额，查询缺失时显示双语缺失提示；隐藏不存在的五小时/周配额进度条。切换供应商/刷新缺失数据会清理旧余额文本。本地 Token、请求、费用和历史图表仍可查看，余额不是本地费用的倒推结果。余额查询错误沿用安全的供应商错误提示。

Dashboard 价格展示从当前供应商 PricingProvider 读取默认模型价格，复用其峰谷/币种逻辑，避免绕过 DeepSeek 的定价规则。KimiUsageData 增加 isBalanceProvider / balanceText；显示格式统一由 calc.ts 处理。

## 0.6.36：修复 DeepSeek 7d windows 全零

Dashboard 在 DeepSeek 或明确无周配额的响应下，对本地七天汇总、热力图与成本曲线统一使用 now−7d。有旧状态/磁盘锚点、缺少锚点以及 DeepSeek 离线无余额时均执行该规则，避免当前刷新时刻被错误当作起点、排除所有历史请求。本地五小时及七天是查看范围，不是 DeepSeek 官方提供的限额窗口。

Current Usage 中 Balance 是 API 返回的可用账户余额；Granted 为赠送余额，Top-up 为充值余额部分，均不是本地累计费用。模型请求 Token 保持日志实际报告值，不按用户问题文字长度缩减。

## 0.6.38：连接网页会员月度额度

Kimi 月度共享池缺失时保留原入口，并显示“连接网页会员额度”按钮；点击调用 aiStatusHub.kimiConnectMembership，成功后刷新 Kimi。也可从命令面板主动重连。密码框只接收网页 access_token，使用前提示同账号、敏感性和获取位置，用户不需向聊天发送令牌。页面没有 iframe 或自动抓取浏览器存储。

网页数据总使用率映射共享月度池；Code 使用率标为“占会员月池比例”，与 Coding API 独立 Code 月额度标签区分。到期字段显示“额度到期”，Dashboard 与 Tooltip 一致，不承诺这是下次周期重置。缺失→获得月数据会隐藏连接按钮；失效后重新出现，仍保留原五小时/周使用量。

## 0.6.39：Kimi 月度双色进度条

有可用共享月池组成时，月度总进度条按蓝色 Kimi、橙色 Code 顺序显示，使用 VS Code charts 主题色并有默认色。下方显示对应色块图例；每个分段和图例通过 title/ariaLabel 提供比例详情，可键盘聚焦；零宽分段退出焦点顺序，详情仍可在图例查看。总百分比、额度到期说明继续保留，重复的 Code 份额独立行隐藏。

缺少组成数据、数值矛盾或 Code 为独立月限额时保留原单色总条/独立 Code 条，不伪造 Kimi 份额。数据缺失及切换供应商时清除分段宽度和详情，隐藏图例。网页连接指引改为六步，第二密码框可选填写刷新令牌以自动续期。

## 0.6.40：月度图例直接显示比例

Kimi/Code 色块后紧邻标签增加各自占完整月额度的百分比，例如 Kimi 32.64%、Code 50.53%，两项之和为总用量。独立文本 span 更新，不覆盖色块结构；悬停仍显示占月额度、占已用额度的详情。缺失/切换时清理图例文本。月度未获取提示缩短为 Monthly usage unavailable. Refresh or reconnect.（6 个英文单词）。

## 0.6.43：DeepSeek 官方账号统计

Current Usage 在原 API 余额下新增账号资金使用比例进度条，显示官网累计消费、网页可用余额、累计充值（含退款订单）及退款/拒付订单原额，明确公式和官网可能有约 5 分钟延迟。充值未获取显示未获取，消费和余额仍可显示。重连按钮在 DeepSeek 页可用，消息 connectDeepseekWeb 调用 aiStatusHub.deepseekConnectWeb，成功后刷新 DeepSeek。

网页数据缺失或切换 Provider 时隐藏进度条并清空文本/宽度，不遗留别的账号或 Provider 数据。网页统计与 Detailed Usage 的本地估算分开；数据不会用 API 剩余充值余额冒充累计充值。状态栏追加该比例，Tooltip 同步金额和口径。

## 0.6.44：紧凑金额行与说明气泡

DeepSeek 的 API 余额行改为“消费 ¥8.39 · 余额 ¥1.61 · 初始 ¥10.0”，校正按钮紧随金额摘要，不再单独占用大块说明行。账号进度条保留比例，公式、基础费用与校正规则通过 track/fill 的 title 气泡呈现，清除原常驻 meta/detail/web-error 段落；错误在必要的登录/校正弹窗显示，不隐藏模型 API 错误。切换 Provider 后清空进度条标题和宽度。

Dashboard 构造时用实时余额和当前金额设置生成视图，不依赖旧网页缓存；Edit Setting 修改金额后刷新余额。跨模型共同整理：Current Usage 的费用估算口径、Detailed Usage 的本地日志范围、热力图色温/时区说明移到帮助图标气泡，保留必要的短标签、数值和错误。帮助图标可聚焦，说明通过 title/ariaLabel 提供；长操作步骤仍留在模态弹窗。

## 0.6.48：模型标识、紧凑热力图与稳定宽度

Current Usage、Detailed Usage 和热力图帮助标记统一使用当前 Provider 的 ui.mainIcon，经 calc.formatProviderLogo 转为可信内联标识。GLM/火山/DeepSeek/Kimi/Cursor 沿用状态栏 Emoji；Codex/Claude 使用内联 Codicons SVG，无字体或远程图片依赖。外层保留 title、键盘 tabindex 和已有 aria-label，装饰标识隐藏于辅助技术；切换 Provider 重建 HTML 时同步更新。

热力图日格与列宽从 12px 改为 7.2px，间距从 2px 改为 1.2px，横纵几何尺寸为原来的 60%，Token 与费用图同步缩小，标题/说明字体保留。原日期、Token/费用悬停提示及点击行为不变。

createOrShow 复用已打开的 Dashboard 时 reveal 当前 panel.viewColumn；仅首次创建用 Beside，避免每次切换模型重新要求旁侧分栏。页面根固定 100% 可用宽度，保留纵向滚动条占位，卡片最小宽度为 0、最大宽度 100%，Canvas 限制为容器宽度，长文本允许折行。保持用户现有分栏，仍可随用户手动调整窗口尺寸自适应。

## 0.6.49：图标金额与始终并排的自适应热力图

DeepSeek 金额行采用三个独立可聚焦 span，显示花朵＋花费、钱袋＋余额、房屋＋总额，各自 title/aria-label 按界面语言显示含义。金额及本地化标签由 calc 生成，WebView 仅通过 textContent/title 更新，不插入账单 HTML。无余额/切换 Provider 时隐藏或清理旧金额。校正按钮只显示 🎯，保留本地化 Calibrate / 校正 title 和 aria-label，仍发送原 connectDeepseekWeb 消息。

取消 0.6.48 的固定 60% 尺寸及换行布局，两张日历使用两列 CSS Grid 始终并排。calculateHeatmapLayout 根据实际周列数和父容器宽度，优先使用原 12px 格子 / 2px 格间距；双图间距由 28px 收窄至 4px，随后才同比缩小日格/格间距。首次数据渲染、ResizeObserver 观察到内容区变化或窗口 resize 时，将纯函数结果写入共享 CSS 变量；拉宽后自动恢复原始尺寸。Token 和费用图共享同一列数与缩放，不缩小标题/说明文字，不改数据聚合或悬停提示。

## 0.6.50：费用曲线标题显示周期累计金额

5h/7d 曲线标题增加独立节点 costcurve-title-5h / costcurve-title-7d，收到所选周期曲线后显示本地化标题＋括号内累计费用，例如 5h curve (¥1.71)。金额来自最后一个有效 cumulativeRmb 采样，跳过未来时间段 null，不将累计点相加；使用当前 Provider 货币符号及两位小数。金额标题独立于 Chart.js 是否加载，切换周期时立即清理旧金额，同周期刷新保留已有值；已有响应周期匹配检查继续阻止过时响应覆盖新选择。

## 0.6.52：月份单行与宽屏热力图间距

热力图月份行改为与日历同列宽/间距的 Grid，每个月标签跨到下个月开始列，最后标签跨至日历末列；white-space:nowrap、overflow-wrap:normal 避免继承页面长文本折行规则后逐字换行。标签保留 title，超窄月份区域可截断但不增加日期行高度。

取消两图间距的 28px 上限。宽度足够时，两张日历保留原始大小，剩余横向空间分配给图间空白；收窄后间距减到 4px 才同比缩放。标题英文改为 Total token heatmap，中文为 总 Token 热力图。

## 0.6.53：空历史后的热力图恢复

updateHeatmap 收到空历史时，清除静态模板缓存与周列数、重置天数为 0，并销毁/释放已从 DOM 移除的两个日图表实例。之后再次收到数据必须重建热力图及 Canvas；清理第三方图表异常被捕获，避免阻止恢复。重复空历史不会重复销毁旧实例。
