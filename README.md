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

## 火山 / Volcengine (Claude logs)

Select `volcengine` in the dashboard/provider setting to view local Claude usage in CNY. Local estimates work without login. Personal Coding Plan quotas can be connected with separate AK/SK credentials; billed amounts are not queried. The user-confirmed GLM 5.3 cutoff defaults to `2026-11-16T13:00:00+08:00`: ambiguous bare GLM 5.3 records before it belong to GLM, and those at or after it belong to 火山. Audited official replies named `glm-5.3-flash` remain GLM even after switching back later; Ark replies named `glm-5-3-flash` continue to use the cutoff. Their shared requestedModel is not channel evidence. Configure `aiStatusHub.claudeLog.glmVolcengineCutover`, or clear it to disable. Explicit sessions/namespaces and exact model overrides take priority. Other bare GLM names keep their existing ownership. Claude Kimi names follow the audited channel mapping below. Use `aiStatusHub.claudeLog.modelProviders` for exact bare-model assignments and `aiStatusHub.claudeLog.sessionProviders` for historical session exceptions (session IDs take priority). Logs without an endpoint cannot reliably distinguish identical GLM names; switching channels within one session requires additional evidence.

See the [Chinese setup example](README.zh-CN.md#火山claude-插件日志). Verified Ark rates cover GLM Flash, Kimi K3.1 Pro and DeepSeek Flash Economy, including Beijing weekday peak/off-peak pricing per record. K2.8 Preview counts tokens only until its private `pricing.volcengine.models.k2_8Preview.*` rates are supplied; no public Ark API rate was verified. Estimates exclude cache storage, tools, plan credits and promotions. Provider-private pricing separates identical model names; `pricing.customModels` overrides all providers.

### Kimi channel separation (0.6.25)

In Claude logs, bare `kimi-k2-8-preview` / `kimi-k2.8-preview` and `kimi-k3.1-pro` / `kimi-k3-1-pro` belong to 火山. Official `k3.1-pro` and `kimi-for-coding` belong to Kimi. No Kimi timestamp cutoff is needed. Explicit sessions, ownership overrides and official namespaces take priority. Native Kimi sessions remain official even when normalization produces the same model spelling as an Ark alias. Each provider totals its own entries using its own pricing; K2.8 remains unpriced until configured.

### Ark API Key entry (0.6.26)

Click Sign in with 火山 selected to open a masked API Key input directly. The trimmed key is stored in VS Code SecretStorage and restored on restart; cancel or blank input preserves the previous key. Sign out removes only the Ark credential. This flow saves the key and refreshes local statistics; it does not validate the key or query plan quotas. Local token/cost estimates remain available without login.

### Coding Plan quota queries (0.6.27)

The model API Key is separate from account AccessKey ID / Secret Access Key quota credentials. With the model key saved, click 火山 Sign in, choose Connect Coding Plan quota, then enter AK and SK in the masked inputs. The extension verifies the read-only quota query before atomically saving the pair in SecretStorage. Get account keys at https://console.volcengine.com/iam/keymanage with permission to read Ark plan usage. Never paste them into chat or use the model key as AK.

Personal Coding Plan 5-hour, weekly and subscription-month percentages/reset times are supported. No absolute request allowance is invented from the percentages. This does not invoke a model. Cancellation or failed verification preserves old credentials; network/permission errors keep local usage available. Automated tests use response fixtures; a live account query still needs credentials entered in VS Code.

### TLS certificate checks (0.6.28)

Ark quota requests explicitly require certificate verification, including when NODE_TLS_REJECT_UNAUTHORIZED=0 is inherited. Remove that variable from the launching shell and fully quit/restart VS Code. If an organization inspection proxy requires an extra CA, verify its issuer with the administrator, configure NODE_EXTRA_CA_CERTS to its PEM file before startup, and restart VS Code. Do not disable verification or automatically trust unknown certificates. A network timeout does not establish a certificate problem.

### Kimi monthly usage (0.6.30)

Refresh the Kimi dashboard to see the membership monthly pool and Kimi Code monthly pool when returned by the official usage endpoint. The status-bar tooltip also shows each pool's percentage and reported reset time. Existing login is reused. Missing pools are hidden rather than shown as zero. Legacy weekly/5-hour counts remain supported; new plans without a weekly cap hide that row. Monthly pools are independent and must not be added together or inferred from local spending, weekly quotas or booster-wallet budgets.

### Kimi monthly numbers missing (0.6.31)

After updating, fully close all VS Code windows and reopen, then refresh the Kimi dashboard. The membership monthly section remains visible: returned values show real percentages; missing values show a dash, an explanation and an official subscription link. Opening a dashboard with existing data also triggers refresh.

The AI Status Hub output channel reports the running extension version and a Kimi quota fields line with boolean availability flags only. No key, usage values or response bodies are logged. A legacy cache alone does not prove what the current live API returns; unavailable monthly values are never invented from local usage.

## Official DeepSeek (0.6.35)

Select deepseek in the Dashboard/provider setting and enable its independent 🐋 status bar. Sign in with an official API Key from https://platform.deepseek.com/api_keys. A read-only balance request validates the key before storing it in the provider's private SecretStorage; DEEPSEEK_API_KEY is also supported. Sign out removes only the stored DeepSeek key.

The Dashboard and status bar show the actual account balance and its granted/top-up components in the returned currency, without invented 5-hour or weekly quotas. Local Claude token/request/cost history works without login. Current Flash aliases and v4 Pro have separate official CNY/USD cache and peak/off-peak prices. Chinese 2026 holidays are built in; add other holiday dates to aiStatusHub.deepseek.offPeakDates (UTC+8, YYYY-MM-DD). Custom base/Peak rates live under pricing.deepseek.models.* and use the configured currency. Unknown historical models retain tokens with zero estimated cost until prices are configured. Estimates exclude storage duration, tools and other charges.

Ark Economy aliases remain exclusively Volcengine. Explicit ark/ and deepseek/ namespaces take priority. Shared bare names such as v4-pro/v4-flash default to official ownership; where a channel cannot be established from the log, configure claudeLog.sessionProviders or modelProviders. Current credentials never retroactively identify old traffic.

Sources: [official pricing](https://api-docs.deepseek.com/quick_start/pricing/), [balance API](https://api-docs.deepseek.com/api/get-user-balance/).

### Large-log memory protection (0.6.37)

Native Claude, Kimi and Codex JSONL paths now use bounded streaming reads instead of loading entire transcripts into the extension host. Original logs remain intact. Records larger than 8 MiB are skipped with a count warning in the AI Status Hub output; usage inside a skipped record cannot be counted. Concurrent scanning of the local large-log dataset passed in a separate memory-constrained process. This does not rule out memory problems in other extensions sharing the host.
