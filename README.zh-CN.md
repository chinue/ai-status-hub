# AI Status Hub

> 一个用于统计和展示 AI 编程助手用量的 VS Code 状态中心，支持 **Codex**、**Claude**、**Kimi**、**GLM** 和 **Cursor**。

[![Version](https://img.shields.io/badge/version-0.5.12-blue)](https://github.com/chinue/ai-status-hub)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

[English](README.md) | **中文**

---

## AI Status Hub 是什么？

**AI Status Hub** 是一款 VS Code 扩展，可以直接在状态栏显示 AI 编程助手的配额、窗口用量、本地估算和成本信息，并通过 Dashboard 展示更完整的用量历史、Token 统计和模型成本拆分。

这个项目基于 `kimi-status-pro` 的 Kimi-only 用量统计能力演进而来。原始版本只关注 Kimi Code 的使用情况；当前版本已经扩展为多 Provider 架构，可以同时面向 Kimi、Claude、Codex 等多个模型和工具链做信息统计与用量展示。

---

## 支持的 Provider

| Provider | 状态 |
|---|---|
| Codex | 已支持 |
| Claude | 已支持 |
| Kimi | 已支持 |
| GLM | 已支持 |
| Cursor | 已支持 |
| 自动检测 | 可根据本地 session 目录自动选择 |

---

## 功能特性

### 状态栏

```
34.5% | 67.2% | Pause
```

| 条目 | 操作 | 说明 |
|---|---|---|
| Weekly | 点击打开 Dashboard | 展示 7 天配额窗口 |
| Window | 点击立即刷新 | 展示短周期配额窗口，通常为 5 小时 |
| Pause | 点击暂停或恢复 | 跨 VS Code 窗口同步暂停状态 |

- 支持离线和数据陈旧状态提示。
- 根据不同 Provider 显示对应名称、定价、币种和本地解析逻辑。
- Tooltip 展示配额、重置时间、本地用量、Token 汇总和成本估算。

### Dashboard

- 展示短周期和周周期配额窗口。
- 从各 Provider 的本地 session 文件估算用量。
- 展示成本曲线和热力图。
- 按模型拆分 Token 与成本。
- 提供内存明细表，方便观察本地估算器状态。
- 支持英文和简体中文切换。

### 架构亮点

- Provider 抽象覆盖认证、API、本地解析、定价和 UI 文案。
- 单一 Scheduler 负责长周期 API 刷新和短周期本地估算。
- Store + reducer 作为单一状态源，UI 只读状态。
- 不同 Provider 的缓存和 API 历史文件相互隔离。
- 异步读取本地文件，避免不必要的阻塞式磁盘 I/O。

---

## 安装

### 从源码安装

```bash
git clone https://github.com/chinue/ai-status-hub.git
cd ai-status-hub
npm install
npm run build
```

然后在 VS Code 中按 `F5` 启动扩展宿主。

---

## 配置项

| 配置 | 默认值 | 说明 |
|---|---|---|
| `aiStatusHub.provider` | `auto` | 要监控的 Provider：`auto`、`codex`、`kimi`、`claude`、`glm` 或 `cursor` |
| `aiStatusHub.language` | `auto` | 显示语言：`auto`、`en` 或 `zh-CN` |
| `aiStatusHub.displayMode` | `percent` | 状态栏模式：`percent` 或 `absolute` |
| `aiStatusHub.refreshIntervalSeconds` | `300` | API 刷新间隔 |
| `aiStatusHub.shortRefreshIntervalSeconds` | `5` | 本地估算刷新间隔 |
| `aiStatusHub.currency` | `auto` | 成本显示币种 |
| `aiStatusHub.weeklyBudget` | `0` | 周预算告警阈值，`0` 表示关闭 |

---

## 命令

| 命令 | ID |
|---|---|
| Refresh | `aiStatusHub.refresh` |
| Sign In | `aiStatusHub.signIn` |
| Sign Out | `aiStatusHub.signOut` |
| Set API Key | `aiStatusHub.setApiKey` |
| Show Dashboard | `aiStatusHub.showDashboard` |
| Toggle Pause | `aiStatusHub.togglePause` |

---

## 开发

```bash
npm install
npm run build
npm test
npx vsce package
```

项目级 Kimi skills 已保存在 `.kimi/skills`，用于协作规则和发布流程说明。

---

## License

MIT
