# AI Status Hub

> A VS Code status hub for tracking AI coding assistant usage across **Codex**, **Claude**, **Kimi**, **GLM**, and **Cursor**.

[![Version](https://img.shields.io/badge/version-0.5.12-blue)](https://github.com/chinue/ai-status-hub)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

**English** | [中文](README.zh-CN.md)

---

## What is AI Status Hub?

**AI Status Hub** is a VS Code extension that shows your AI coding assistant quota and local usage directly in the status bar, with a dashboard for quota windows, token usage, cost estimates, and recent history.

The project started from the Kimi-only usage tracking work in `kimi-status-pro`, then evolved into a multi-provider extension. Instead of only watching Kimi Code usage, AI Status Hub now provides one shared status bar and dashboard for multiple coding assistants.

---

## Supported Providers

| Provider | Status |
|---|---|
| Codex | Supported |
| Claude | Supported |
| Kimi | Supported |
| GLM | Supported |
| Cursor | Supported |
| Auto detect | Supported via local session directories |

---

## Features

### Status Bar

```
34.5% | 67.2% | Pause
```

| Entry | Action | Description |
|---|---|---|
| Weekly | Click to open Dashboard | Shows the 7-day quota window |
| Window | Click to refresh | Shows the short quota window, usually 5 hours |
| Pause | Click to pause or resume | Syncs pause state across VS Code windows |

- Offline and stale indicators for unreliable API data.
- Provider-aware display names, pricing, currency, and local parsers.
- Tooltip summary with quota, reset time, local usage, token totals, and costs.

### Dashboard

- Current usage for short and weekly quota windows.
- Local usage estimates from provider session files.
- Cost curve and heatmap views.
- Model-level token and cost breakdown.
- Memory detail tables for local estimator/debug visibility.
- Language switcher for English and Simplified Chinese.

### Architecture

- Provider abstraction for auth, API access, local parsing, pricing, and UI labels.
- Single scheduler for long API refreshes and short local estimation ticks.
- Store + reducer state model so UI reads from one source of truth.
- Provider-isolated cache and API history files.
- Async local file parsing with no unnecessary blocking disk I/O.

---

## Installation

### From Source

```bash
git clone https://github.com/chinue/ai-status-hub.git
cd ai-status-hub
npm install
npm run build
```

Press `F5` in VS Code to launch the Extension Host.

---

## Configuration

| Setting | Default | Description |
|---|---|---|
| `aiStatusHub.provider` | `auto` | Provider to monitor: `auto`, `codex`, `kimi`, `claude`, `glm`, or `cursor` |
| `aiStatusHub.language` | `auto` | Display language: `auto`, `en`, or `zh-CN` |
| `aiStatusHub.displayMode` | `percent` | Status bar mode: `percent` or `absolute` |
| `aiStatusHub.refreshIntervalSeconds` | `300` | API refresh interval |
| `aiStatusHub.shortRefreshIntervalSeconds` | `5` | Local estimation interval |
| `aiStatusHub.currency` | `auto` | Currency for cost display |
| `aiStatusHub.weeklyBudget` | `0` | Weekly budget warning threshold; `0` disables it |

---

## Commands

| Command | ID |
|---|---|
| Refresh | `aiStatusHub.refresh` |
| Sign In | `aiStatusHub.signIn` |
| Sign Out | `aiStatusHub.signOut` |
| Set API Key | `aiStatusHub.setApiKey` |
| Show Dashboard | `aiStatusHub.showDashboard` |
| Toggle Pause | `aiStatusHub.togglePause` |

---

## Development

```bash
npm install
npm run build
npm test
npx vsce package
```

Project-level Kimi skills are kept in `.kimi/skills` for collaboration and release workflow guidance.

---

## License

MIT
