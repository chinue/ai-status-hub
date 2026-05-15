# AI Status Hub v2 仪表盘设计文档

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
│  Kimi Code 用量                    [↻ 刷新] [$ / %] [⚙]           │  ← Header
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

**右侧**：三个按钮组，gap `8px`

| 按钮 | ID | 功能 |
|---|---|---|
| ↻ 刷新 | `btn-refresh` | 触发 `refresh` message |
| $ / % | `btn-toggle` | 切换 cost/percent 模式 |
| ⚙ | `btn-settings` | 打开 VS Code 设置 |

**刷新状态**：点击后按钮变为旋转的 `⟳` 图标（CSS animation `spin 1s linear infinite`），disabled，刷新完成后恢复。

---

### 4.2 Current Usage Card

**标题**：`CURRENT USAGE`（大写，0.75em，letter-spacing 0.08em，灰色）

**内容**：1~2 条进度条（5h 必显示，7d 可选）

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
- options 刷新后若当前选择不在新 options 中，自动回退到第一个有效窗口；Claude API 用量耗尽/403 时仍使用窗口锚点生成 options，避免 7d 曲线请求空窗口

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
| `toggleMode` | 无 | 点击 $/% 按钮 |
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
  resetIn5h: number;          // 秒
  resetIn7d: number;          // 秒
  limitStatus: 'allowed' | 'allowed_warning' | 'denied';
  has7dLimit: boolean;
  providerType: 'kimi-ai' | 'api-key';

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

### 8.2 懒加载

- 热力图数据不在 `update` message 中强制包含，WebView `ready` 后单独请求
- Cost Curve 数据在卡片展开时才请求
- Drilldown 数据（小时/日明细）在点击时才请求

### 8.3 防止 stale response

- Cost Curve 选择改变后，150ms debounce 后发送请求
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
