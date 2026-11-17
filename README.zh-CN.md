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

## 火山（Claude 插件日志）

Dashboard 的供应商列表增加“火山”。选择火山或设置 `aiStatusHub.provider` 为 `volcengine`，勾选火山可显示独立状态栏。本地 Claude 日志中的 Token 和人民币 API 等价费用无需登录即可统计；使用单独的 AK/SK 凭据可连接个人 Coding Plan 配额查询，不查询实际账单。

已按用户确认的历史设置默认切换时间：**2026-11-16 13:00（UTC+8）**。此时间规则仅处理仍有歧义的裸名 GLM 5.3：此前归 GLM，此刻起归火山。已核对日志中，官方回复 `glm-5.3-flash` 保持归 GLM（包括 13 点后切回官方的请求）；火山回复 `glm-5-3-flash` 继续按切换时间分流。同一会话逐条处理，不使用两者相同的 requestedModel 判断渠道。可修改 `aiStatusHub.claudeLog.glmVolcengineCutover`（含时区的 ISO 8601 时间），留空禁用时间规则；显式会话、命名空间和模型覆盖优先。

Claude 通常不保存请求域名；同名 `glm-5.3-flash` 无法自动判断是火山还是智谱。未应用上述时间规则时，裸 GLM 归智谱。已核实的 Kimi 名称自动区分渠道（见下表）；下列 settings.json 仅供手动覆盖归属：

```json
{
  "aiStatusHub.provider": "volcengine",
  "aiStatusHub.claudeLog.modelProviders": {
    "deepseek-v4.1-flash-economy": "volcengine",
    "kimi-k2.8-preview": "volcengine",
    "kimi-k3.1-pro": "volcengine",
    "glm-5.3-flash": "glm",
    "glm-5-3-flash": "volcengine"
  },
  "aiStatusHub.claudeLog.sessionProviders": {
    "替换为智谱官方会话的-sessionId": "glm"
  }
}
```

会话 ID 取自 `.claude/projects/**/*.jsonl` 中的 `sessionId`，会话设置优先于模型设置。也可不设置 GLM 模型覆盖，仅将确认来自火山的会话 ID 指定为 `volcengine`。修改设置后下一次扫描会重新分流，无需更改日志；每条 Claude 请求只计入一个供应商。一个会话中途切换渠道时，需提供切换时间等依据；仍有歧义的 GLM 5.3 按用户提供的 13:00 分界处理，已核对的官方 `glm-5.3-flash` 不受该时间规则影响。

已内置 GLM Flash、Kimi K3.1 Pro、DeepSeek Flash Economy 的[火山官方 API 价格](https://docs.volcengine.com/docs/ark/model-pricing?lang=zh&redirect=1)，核对于 2026-11-16。DeepSeek 按记录的北京时间工作日高峰/空闲计价。K2.8 Preview 暂未查到公开 API 单价：默认只计 Token，费用估算不含该模型；可填写 `aiStatusHub.pricing.volcengine.models.k2_8Preview.inputPerMillion`、`outputPerMillion`、`cacheReadPerMillion`、`cacheCreatePerMillion`（元/百万 Token）。费用不含存储时长、工具调用、套餐积分或活动优惠。区分同名模型的费率请使用 `pricing.volcengine.models.*` 与 `pricing.glm.models.*`；`pricing.customModels` 是跨供应商共用覆盖。

### 火山与 Kimi 官方自动分开（0.6.25）

已按你的 Claude 实际记录自动分流，无需另外设置 Kimi 时间分界：

| message.model | 统计位置 |
|---|---|
| deepseek-v4-1-flash-economy | 火山 |
| kimi-k2-8-preview / kimi-k2.8-preview | 火山 |
| kimi-k3.1-pro / kimi-k3-1-pro | 火山 |
| k3.1-pro / k3-1-pro | Kimi 官方 |
| kimi-for-coding | Kimi 官方 |

火山汇总其自己的 Claude 请求，Kimi 汇总官方 Claude 请求和官方原生使用量，分别使用各自费率；重复 assistant 块只计一次。官方命名空间和显式会话/模型覆盖仍优先，若此前配置过反向归属，请移除相应覆盖。GLM 的 13:00 分界继续保留。K2.8 未配置单价时，火山费用仍不含该模型，Token 正常计入。kimi-for-coding 使用既有旧日志参考费率，不代表套餐实际扣款。

### 火山 API Key 输入（0.6.26）

选择火山后点击“登录”，会直接弹出 API Key 密码输入框。确认后密钥保存到 VS Code SecretStorage，下次启动可恢复；取消或空白不修改已有密钥。退出登录只删除火山自己的密钥。

当前仅保存密钥并刷新本地统计，不校验密钥有效性、不查询套餐配额；本地 Token 和费用估算无需登录也可使用。

### 查询 Coding Plan 套餐用量（0.6.27）

模型 API Key 和套餐查询凭据不同。已保存模型 API Key 后，再点击火山“登录” → “连接 Coding Plan 套餐”，依次输入账户 AccessKey ID、Secret Access Key；插件先验证，只在成功后安全保存，后续自动刷新。

账户凭据在[火山 IAM 密钥管理](https://console.volcengine.com/iam/keymanage)获取，需允许方舟套餐用量只读查询。无需将密钥发到聊天，也不要将模型 API Key 填作 AccessKey ID。取消或失败保留旧查询凭据。查询走官方控制面，不进行模型推理、不产生测试推理费用。

当前支持个人 Coding Plan 的 5 小时、每周及订阅月已用百分比/重置时间。接口没有提供绝对请求总量，绝对值模式也保持百分比；套餐额度与本地 Token/API 等价费用分开展示。网络或权限错误会显示具体类别并保留本地统计。尚未用真实账户 AK/SK 完成现场验证，安装后首次配置会自动验证连接。

### TLS 证书校验（0.6.28）

火山套餐请求已强制启用证书和域名校验，即使启动环境设置 NODE_TLS_REJECT_UNAUTHORIZED=0，也不绕过校验。若你的 PowerShell 会话存在该变量，先执行：

```powershell
Remove-Item Env:NODE_TLS_REJECT_UNAUTHORIZED -ErrorAction SilentlyContinue
```

之后完全退出所有 VS Code 窗口，从没有该变量的新终端重新启动；仅 Reload Window 可能仍继承原父进程环境。当前检查到用户级/系统级均未设置该变量，无需修改注册表。

若组织网络确实使用 HTTPS 检查代理，向管理员获取并核实 CA 的来源后，通过 NODE_EXTRA_CA_CERTS 指向其 PEM 文件，再完整重启 VS Code。该变量只在 Node 启动时读取。不能通过下载陌生 CA、关闭证书校验或跳过主机名验证来解决；普通网络超时也不等于缺少 CA。

### Kimi 月度用量（0.6.30）

在 Kimi Dashboard 中刷新用量，可显示“会员月度共享额度”和“Kimi Code 月度额度”，状态栏悬停提示也显示各自的已用百分比与重置时间。继续使用现有 Kimi 登录，无需添加其他密钥。

两个月池按官方接口分别返回的值显示，不能相加；共享池可能包含 Kimi 的其他会员功能消费。旧套餐的每周/5 小时额度仍支持，新套餐未返回周限制时隐藏周行。接口未提供的月池不显示，不会从本地 Token/费用或周额度推算，也不把加油包月预算当成套餐额度。

### Kimi 看不到月度数字时（0.6.31）

安装新版后，完全退出所有 VS Code 窗口再重新打开，避免旧窗口继续运行旧代码；在 Kimi Dashboard 中刷新。月度共享额度区域会保留：有数据则显示真实百分比，没有数据则显示“尚未获取月度额度”和官方查看入口，不会伪造为 0%。

如仍没有数值，打开 VS Code“输出”→“AI Status Hub”，查看启动版本及 Kimi quota fields 行。month_total / month_code 表示接口是否提供有效月字段，均为布尔值，不含密钥或响应正文。当前不能仅凭旧缓存认定服务器一定没有月度数据；接口未提供时，可通过“查看会员额度”进入官方订阅页核对。

## DeepSeek 官方（0.6.35）

在 Dashboard 选择 DeepSeek，或设置 aiStatusHub.provider 为 deepseek；状态栏可单独勾选 🐋 DeepSeek。点击登录后输入从 https://platform.deepseek.com/api_keys 获取的官方 API Key，插件使用只读余额接口验证后保存到独立 SecretStorage；也可使用 DEEPSEEK_API_KEY 环境变量。退出仅删除本扩展保存的 DeepSeek Key，不修改其他渠道或环境变量。

支持显示官方账户总余额、赠送与充值余额；余额按 API 返回的实际币种显示，不冒充五小时/周限额。本地 Claude 日志的 Token、请求与费用无需登录即可查看。内置 deepseek-flash、deepseek-v4-flash、deepseek-v4.1-flash 系列和 deepseek-v4-pro 的当前官方缓存/峰谷费率；auto 默认 CNY，也支持官方 USD 单价。2026 中国节假日按空闲价格，其他年份可补充 aiStatusHub.deepseek.offPeakDates（UTC+8 日期字符串数组）。费用为 API Token 估算，不含存储、工具和其他收费项；未知历史模型仅计 Token，需配置价格后才计费。

火山 deepseek-v4.1-flash-economy / deepseek-v4-1-flash-economy 继续归火山。显式 ark/ 命名空间归火山，deepseek/ 归官方。v4-pro/v4-flash 等裸名可能跨渠道相同，缺少端点证据时默认官方；若通过火山调用这些同名模型，请用 aiStatusHub.claudeLog.sessionProviders 或 modelProviders 明确归属，避免混计。原始 Claude 日志不改写。

价格和接口依据：[官方定价](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)、[余额接口](https://api-docs.deepseek.com/api/get-user-balance/)。实际账户余额需配置 Key 后查询。

### 大日志内存防护（0.6.37）

Claude、Kimi、Codex 原生 JSONL 日志改为有界流式读取，避免多个供应商同时将大文件全文载入扩展宿主。原始日志不会被修改。单条超过 8 MiB 的记录会跳过并在 AI Status Hub 输出中记录数量；若该记录包含使用量，统计可能缺少该条。修复已通过本机大日志并行扫描验证，其他扩展引起的宿主内存问题仍需单独排查。

### Kimi 网页“总使用量”（0.6.38）

已连接 Kimi Code 后，先刷新仪表盘。若 Coding API 不返回月度字段，插件会尝试订阅页使用的官方会员接口读取“总使用量”。如果现有授权不能访问，在月度区域点击“连接网页会员额度”（或运行 AI Status Hub: Connect Kimi Web Membership 命令）。

1. 在 https://www.kimi.com/settings/subscription 登录与 Kimi Code 相同的账号。
2. 浏览器按 F12，打开 Application（应用）→ Local Storage（本地存储）→ https://www.kimi.com，复制 access_token 的值。
3. 仅粘贴到扩展的密码输入框，不要发到聊天或写进 settings.json。插件验证成功后保存到独立 SecretStorage。它是敏感账号令牌，过期后需重新连接；Kimi 退出登录会删除本扩展保存的网页令牌。

总使用率与 Kimi Code 占比直接使用网页接口返回值，不相加；Code 标为占会员月池比例。到期时间不自动推算成下次重置。网页接口失败时原有五小时/周额度继续可用。此路径依赖官网内部会员接口，后续可能变化；实际账号数据需连接后核验，未通过本地测试伪造月度值。

### Kimi 月度用量与自动续期（0.6.39）

月度总条按蓝色 Kimi、橙色 Code 分段，下方有同色图例；悬停显示占月额度和占已用额度的比例。Kimi＝总量－Code，剩余空白为未用额度。只有确认属于同一月池且字段完整时才分段，独立 Code 月额度保留单独显示。

连接时按 F12 打开 DevTools，进入 Application > Storage > Local Storage > https://www.kimi.com，复制 Key 为 access_token 那一行的完整 Value 到第一个密码框。若需自动续期，再复制 Key 为 refresh_token 那一行的完整 Value 到第二个密码框；留空可跳过，Esc 取消。不要发送凭据到聊天。令牌保存在 VS Code SecretStorage，认证过期时最多续期并重试一次；刷新令牌失效仍需重新登录网页。尚未核实固定有效期。

### Kimi 图例用量与续期修复（0.6.40）

月度色块旁直接显示各自占月额度的百分比，例如 Kimi 32.64%、Code 50.53%。缺失提示同步简化。自动续期请求改用 auth.kimi.com，修复此前 www.kimi.com 返回 404 的错误。更新后先刷新用量，继续使用已保存的凭据；刷新令牌失效时再重新连接。已验证匿名请求可到达认证接口，真实账号续期仍需安装后验证。

### DeepSeek 费用为零修复（0.6.41）

DeepSeek 可选价格覆盖改为 null 默认值，表示使用自动费率。此前 VS Code 为没有显式默认值的数字配置补 0，意外覆盖内置价格，导致 Token 有数据而费用曲线、每日费用和费用热力图均为零。保留用户明确填写的零费率。安装后执行 Developer: Reload Window（开发人员：重新加载窗口），刷新即可从本地日志重算费用。

### DeepSeek 价格读取补充修复（0.6.42）

价格读取通过 VS Code inspect API 区分显式用户/工作区设置和宿主注册默认值，DeepSeek 自动定价忽略隐式零值，用户明确填写的 0 仍保留。安装后重新加载窗口并刷新，先检查 Pricing 中的费率，再查看费用图表。已通过模拟宿主默认零值的回归，实际受影响窗口仍需安装后确认。
