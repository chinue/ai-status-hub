# ChangeLog

## [0.6.43] - 2026-11-18

### 新增

- **DeepSeek 官网账号统计**：以独立网页登录凭据查询官方用量概览与账单，只读获取累计消费、当前可用余额和同币种充值订单汇总；Dashboard 与状态栏显示按用户选择的“累计消费÷（累计消费＋当前可用余额）”计算的资金使用比例。
- **独立网页连接入口**：Current Usage 按钮和命令面板提供 F12/Network/get_user_summary/Authorization 值的分步指引，password 框输入、验证后保存到独立 SecretStorage；不读取浏览器 Cookie、不记录令牌或原始账单。切换 API Key 清除旧网页登录，退出 DeepSeek 清除自己保存的网页凭据。

### 口径与边界

- 累计充值统计已支付订单原额，包含后续退款/拒付订单，不含赠金；单列退款/拒付订单原额，不冒充部分退款明细。币种隔离、订单去重与状态检查；缺失数据不当零，网页失败不破坏 API 余额和本地统计。
- 网页数据可能延迟约 5 分钟，按现有调度周期更新；与本地费用估算分开。网页登录暂不自动续期；账号身份一致由用户确认。接口/字段依据官方公开前端，实际账号需安装并连接后验证。

### 验证

- 新增十项回归，核心功能先失败后实现；覆盖解析、比例、币种、重复/无效订单、只读路由/TLS/超时、凭据隔离与脱敏、密码流程、实际 WebView、状态栏、命令刷新及退出。
- 类型检查、全部 442 项测试、生产编译及 VSIX 打包通过。

## [0.6.42] - 2026-11-17

### 修复

- **DeepSeek 自动价格读取补充防护**：0.6.41 仅修正价格 schema，读取层仍可能接受宿主注册中的隐式零默认值。现在通过 WorkspaceConfiguration.inspect 区分显式用户/工作区/文件夹及语言覆盖与默认值，动态定价只采纳显式有效数值；保留明确的 0、null 自动回退和自定义价格。
- **异常与非法覆盖回退**：配置检查异常、缺失、非数值、负数及非有限值不再替代自动费率。火山等固定费率 Provider 继续使用原注册默认值。

### 验证

- 新增两项回归，先模拟宿主 get 价格全零、inspect 仅含默认零并复现，再验证修复；覆盖显式层级优先级、零值、null 和错误输入。费用链路回归同时使用该失败模式验证每日费用、曲线及热力图。
- 类型检查、全部 432 项测试、生产编译及 VSIX 打包通过。现场确认 0.6.41 已运行且 Pricing 全零；真实宿主配置快照未取得，隔离实例因 Crashpad 启动失败，实际窗口需安装后复核。

## [0.6.41] - 2026-11-17

### 修复

- **DeepSeek Token 有数据但费用全零**：16 个可选价格覆盖配置只声明 number 且没有默认值，VS Code 自动补 0，意外覆盖 Provider 自动费率。改为 number|null、显式 default:null；ConfigService 跳过空值并回退至全局或内置费率，保留用户明确设置的 0。
- **恢复全部费用视图的数据来源**：本地会话按正确费率重算后，费用曲线、每日费用及费用热力图恢复有效值；不修改日志、模型渠道归属或官方余额。升级后需重载窗口以加载新配置定义，再刷新用量。

### 验证

- 新增两项回归，先按 VS Code 配置注册规则复现零价格/零费用，再修复通过；覆盖自动费率、峰谷、USD、零覆盖、空值回退，以及 LocalUsageService 到 HistoryService 每日费用/曲线/热力图链路。
- 类型检查、全部 430 项测试、生产编译及 VSIX 打包通过。

## [0.6.40] - 2026-11-17

### 修复

- **Kimi 网页自动续期主机错误**：此前将 AuthService 刷新请求发往 www.kimi.com，匿名实测返回 404；现改为官方网页配置使用的 auth.kimi.com。无效样例令牌在正确地址返回 401/REASON_INVALID_AUTH_TOKEN，确认路由到达认证服务。沿用已有 SecretStorage 凭据，续期失败仅记录固定消息或 HTTP 状态。

### 改进

- **月度图例显示用量**：色块旁直接显示 Kimi、Code 各自占月额度的百分比，保留悬停详细比例；格式化在 calc.ts，独立文本节点避免覆盖色块。
- **简短缺失提示**：英文改为 Monthly usage unavailable. Refresh or reconnect.，共 6 个单词，同步中文和设计文档。

### 验证

- 修正续期域名与图例数值回归断言，先失败后通过；类型检查、全部 428 项测试、生产编译和 VSIX 打包通过。匿名请求只验证路由，不代表真实账户已续期成功；刷新令牌若已失效仍需重连。

## [0.6.39] - 2026-11-17

### 新增

- **Kimi 月度双色进度条**：共享月池按蓝色 Kimi、橙色 Code 显示，下方配同色图例；悬停分段或图例可查看占月额度及占已用额度的比例。Kimi 为总量减 Code，剩余空白为未用额度；字段缺失、矛盾或独立 Code 月限额保留原显示。
- **可选网页登录自动续期**：新增第二个密码框接收 refresh_token 的 Value，与 access_token 整体保存到独立 SecretStorage。月度查询 401 时最多续期一次并重试；支持令牌轮换、并发去重、旧访问令牌兼容及退出/重连期间保护。续期失败保留凭据及 Coding 配额，刷新令牌失效仍需重连。

### 改进

- **详细登录指引**：模态框按六步说明 F12、Application、Local Storage、网站域名及 Key 对应完整 Value，说明可选刷新凭据、有效期不固定和凭据敏感性。同步中英文文案及设计文档。

### 验证

- 核心续期与分段测试先失败后通过；类型检查、全部 428 项测试、生产编译和 VSIX 打包通过。使用合成响应验证，未使用真实账户令牌，实际账号自动续期需连接后验证；网页内部接口可能变化。

## [0.6.38] - 2026-11-17

### 新增

- **Kimi 网页会员月度总使用量**：Coding API 未返回月总量时，补充查询订阅页实际使用的 GetSubscriptionStats RPC，解析会员总比例与 Kimi Code 占会员池比例；两者不相加，不把 Code 份额冒充独立配额。
- **独立网页授权入口**：先尝试现有授权；不兼容时可在 Dashboard 点击“连接网页会员额度”或使用专用命令，输入同账号网页 access_token。先验证后保存到独立 SecretStorage，不发送到 Coding API；退出 Kimi 清除网页令牌。取消、验证或存储失败保留旧令牌。
- **来源口径与时间**：状态栏和 Dashboard 区分网页会员池份额，expire_time 显示“额度到期”，不猜测下次重置时间；网页失败保留原五小时/周统计。

### 验证

- 官方公开前端及内嵌 protobuf 描述符确认接口/字段；匿名实测 401，未读取用户已登录浏览器或真实账户响应。网页与 Coding 令牌是否同账号由用户确认，网页令牌过期需重新连接；内部网页接口后续可能变化。
- 新增十项解析、授权隔离、网络/TLS/超时、存储脱敏、WebView 交互、命令刷新/退出回归；核心功能先失败后通过。类型检查、全部 422 项测试、生产编译及 VSIX 打包通过。

## [0.6.37] - 2026-11-17

### 修复

- **大日志扫描内存峰值**（LocalUsageService、Claude/Kimi/Codex 解析器）：原实现整文件读取并拆分，在多个供应商并行扫描大日志时可能耗尽扩展宿主内存。统一改为 64 KiB 流式读取，只保留精简用量记录；Codex 内容指纹也增量计算，配额扫描不再积累无用的输出条目。
- **超长记录防护**：单条 JSONL 记录上限 8 MiB，超长记录跳过并记录数量警告，正常后继记录继续统计。若该记录含用量，该条不会计入；不修改原始日志。读取失败保留旧缓存并关闭流。
- **打包排除临时文件**：.vscodeignore 增加 .tmp/ 和 tmp/，压力测试工具不会进入安装包。

### 验证

- 新增六项流式读取回归，先复现再修复：UTF-8 跨块/CRLF/EOF、超长记录、异常和缓存、三种原生格式、Codex 累计差分、同元数据重写及配额提取。
- 类型检查、全部 412 项测试、生产编译及 VSIX 打包通过。现场七个扫描器在独立受限 old-space 进程中完成扫描，采样 heap 峰值约 39 MiB，进程峰值约 155 MiB；不代表整个 VS Code 的内存。
- 崩溃 minidump 确认为 OUT_OF_MEMORY（0xe0000008）。本次修复消除本扩展的明确内存风险，但不能据此排除其他扩展共同影响；需安装新版本后观察真实宿主稳定性。

## [0.6.36] - 2026-11-17

### 修复

- **DeepSeek 本地七天统计全零**（Scheduler、Dashboard）：余额接口没有周限额和重置时间，原逻辑却将刷新时刻当作七天起点，排除了历史请求。无周限额时改用最近七天；短 tick、旧磁盘锚点、Dashboard 聚合/热力图/成本曲线一并修复。DeepSeek 无余额或离线时也使用滚动本地范围。
- 保留其他供应商的官方周周期；仅有余额的 DeepSeek 不生成官方周配额。Balance、Granted、Top-up 仍分别代表账户总余额、赠送余额和充值余额，不是本地累计费用。

### 验证

- 集成回归先复现 0 次请求，再验证一天/六天前记录计入、八天前记录排除，覆盖余额响应、短 tick、离线与旧状态/磁盘锚点修复。
- 类型检查、全部 406 项测试、生产编译和 VSIX 打包通过；现场重算七天历史恢复非零，Token 及费用保持日志实际值，未混入火山 Economy。

## [0.6.35] - 2026-11-16

### 新增

- **DeepSeek 官方供应商 🐋**：独立 Dashboard、状态栏、Claude 本地日志、费用和账户余额；与火山 Economy 模型及供应商缓存分开。
- **安全登录和余额**：API Key 密码输入，官方只读 GET /user/balance 验证成功后保存独立 SecretStorage；支持环境变量回退、私有退出、15 秒超时、显式 TLS 校验和禁止重定向。显示真实 CNY/USD 总余额、赠送及充值余额，不虚构五小时/周限额。
- **官方价格**：Flash 当前及兼容别名、V4 Pro 的 CNY/USD 缓存与峰谷费率；2026 年中国节假日、额外空闲日期和供应商独立价格覆盖。未知历史模型仅计 Token，待配置价格；不含存储时长及工具额外收费。

### 修复

- Dashboard 默认模型价格改从当前供应商定价器读取，保留峰谷和币种规则；余额查询首次失败显示错误而非永久加载。

### 验证

- 新增 14 项 DeepSeek 回归，涵盖注册、日志分流/去重、余额结构及币种、TLS/HTTP/超时、凭据验证/异常/隔离、价格边界/假期/覆盖及真实 WebView 展示和清除。核心功能先失败后通过。
- 类型检查、全部 405 项测试、生产编译及 VSIX 打包通过。测试使用合成数据，未访问用户真实 DeepSeek 账户；真实余额需用户在 VS Code 输入 Key 后验证。同名跨渠道日志仍需显式归属设置。

## [0.6.34] - 2026-11-16

### 修复

- **GLM 退出登录凭据隔离**（`src/providers/glm/auth.ts`）：实现供应商私有 signOut，只删除 GLM 的 SecretStorage 密钥，避免通用分支误删 Kimi 凭据；删除失败或存储未初始化时保留登录状态，显示中英双语固定错误。
- **Kimi 会员额度入口**（`src/presenters/dashboard.ts`）：更新为用户确认可访问的 settings/subscription?tab=quota 页面。
- 同步设计文档，修正 README 中火山套餐已支持查询的说明及 GLM 官方归属示例。

### 验证

- 提交前复核当前全部供应商、窗口费用、月度配额及凭据相关改动；新增 GLM 私有退出成功/存储异常回归，并更新 Kimi 入口断言，先失败后通过。
- 类型检查、全部 391 项测试、生产编译、VSIX 打包通过。
- Kimi 月度数据仍取决于官方接口是否返回月字段；火山 COST 为 API 等价估算，不是 Coding Plan 套餐扣量金额。

## [0.6.33] - 2026-11-16

### 修复

- **GLM 官方请求误计入火山**（`src/calc.ts`）：按已核对的 Claude 回复名保留官方 `glm-5.3-flash`，13 点后切回官方不再受旧时间规则影响；火山 `glm-5-3-flash` 仍按历史分界处理，显式会话、命名空间和模型覆盖优先。两渠道的 requestedModel 相同，不据此归属。
- **GLM 五小时边界错误**（LocalUsageService、Scheduler、Dashboard）：本地费用、Token、请求数及历史范围按滚动五小时统计，替代官方下次重置时间减五小时；保留官方重置提示及下单日起七天的周边界。
- 同步双语配置说明、README 和设计文档，保持费用与官方积分独立。

### 验证

- 四项渠道与窗口回归先失败后通过；类型检查、全部 389 项测试、生产编译及 VSIX 打包通过。
- 使用本机原日志重算时，GLM 当前五小时和周窗口均有 40 次请求、API 等价估算费用约 ¥6.75；这批官方记录不再计入火山。数值会随新请求及窗口移动变化。

## [0.6.32] - 2026-11-16

### 修复

- **Current Usage 零费用消失**（`src/presenters/dashboard.ts`、`src/types.ts`）：五小时与周窗口费用为 0 时也显示 COST 和 0.00 金额，避免 GLM、Kimi 空窗口被误认为未统计；正费用正常显示，沿用各供应商币种与现有双语标签。
- 复用 calc.ts 的 fmtCurrency 在消息构建时生成费用文本，保持官方配额、本地费用和供应商渠道隔离，不把历史周期数据移入当前窗口。

### 验证

- 新增真实 Store → Dashboard → WebView 回归，覆盖 GLM、Kimi、火山的零/正费用及刷新回零；先失败后通过。类型检查、全部 385 项测试、生产编译及 VSIX 打包通过。

## [0.6.31] - 2026-11-16

### 修复

- **Kimi 月度区域消失**（`src/presenters/dashboard.ts`）：旧缓存或响应无月字段时保留共享月额度区域，显示破折号、“尚未获取月度额度”及官方订阅页入口；获得实际月数据后恢复百分比和重置时间，不伪造 0%。
- **仪表盘旧数据等待轮询**（`src/extension.ts`）：打开/切换已有数据的 Dashboard 立即刷新对应供应商；新实例和正在加载的请求沿用原先首轮 tick，避免延迟或重复刷新。
- **安全诊断**：启动日志显示运行版本，Kimi 查询仅记录窗口字段可用性的布尔值，不记录密钥、用量数值或响应原文；同步双语文案及文档。

### 验证

- 新增月度 DOM 缺失→可用更新、打开/切换刷新回归，先失败后通过；类型检查、全部 384 项测试、生产编译及 VSIX 打包通过。
- 现场确认 0.6.30 已安装且 bundle 匹配，多个窗口持续更新共享缓存，读到的旧缓存没有月字段。工具侧没有当前 SecretStorage 登录，未取得账户实时响应，不宣称真实月度数值已查询成功。

## [0.6.30] - 2026-11-16

### 新增

- **Kimi 月度额度**（`src/providers/kimi/api.ts`、`src/calc.ts`）：解析官方 usages.limit_month_total 与 limit_month_code，分别显示会员共享月池和 Kimi Code 月池的已用百分比及服务端重置时间；沿用现有登录，不增加凭据。
- **月度显示**（Dashboard、状态栏）：Dashboard 与 tooltip 分别展示两个可选月池；新套餐无周限额时隐藏周行，只有月数据时状态栏显示月百分比。未返回字段不伪造成 0%，加油包月预算不混为套餐用量。

### 修复

- 兼容旧 usage / limits 数据：按窗口时长识别 5 小时，保留旧绝对计数优先级并支持 remaining 推算 used，避免乱序取错窗口。
- Kimi 查询显式校验证书、禁止重定向，HTTP/结构/网络错误使用双语通用提示并保护凭据，不以成功零值覆盖旧快照。

### 验证

- 八项月度回归，新增解析/显示先失败后通过；类型检查、全部 382 项测试、生产编译及 VSIX 打包通过。使用官方源码同结构夹具，未读取用户密钥或宣称真实账户现场验收成功；同步设计、索引、双语 README，保持 UTF-8/CRLF。

## [0.6.29] - 2026-11-16

### 调整

- **精简火山费用说明**（`src/i18n.ts`）：英文改为“API estimate; excludes unpriced models.”（5 个单词），中文同步为“API 估算，不含未定价模型。”，Dashboard 与状态栏共用。

### 验证

- 类型检查、全部 374 项测试、生产编译及 VSIX 打包通过；同步编码规范，保持 UTF-8/CRLF。

## [0.6.28] - 2026-11-16

### 安全修复

- **火山配额查询强制校验证书**（`src/providers/volcengine/api.ts`）：显式使用 rejectUnauthorized=true 的 HTTPS Agent，避免继承 NODE_TLS_REJECT_UNAUTHORIZED=0 绕过验证；保留默认主机名/CA 校验和可信额外 CA 支持，结束时销毁 Agent。
- **证书错误提示**（`src/i18n.ts`）：双语提示检查证书链、域名、时间及可信组织代理 CA，不输出底层异常、不将证书错误当作密钥错误；不自动信任未知证书。
- 更新文档中的环境变量排查、完全重启 VS Code 和 NODE_EXTRA_CA_CERTS 使用方式。

### 验证

- 两个 TLS 回归先失败后通过，包含真实本地自签名 HTTPS 握手：环境变量为 0 时仍拒绝连接，测试服务器收到的 HTTP 请求数为 0。证书/私钥仅为公开测试夹具，不随 VSIX 打包。
- 类型检查、全部 374 项测试、生产编译及打包通过。官方域名不带密钥的额外连通检查返回网络超时，未将其误判为证书错误或真实账户验收通过；用户级/系统级变量未设置，未修改注册表或安装 CA。

## [0.6.27] - 2026-11-16

### 新增

- **个人 Coding Plan 套餐额度查询**（`src/providers/volcengine/api.ts`、`signing.ts`）：使用账户 AccessKey ID / Secret Access Key 对官方 GetCodingPlanUsage 发起 V4 签名只读请求，支持 5 小时、每周、订阅月已用百分比和服务端重置时间。模型 API Key 不再被误当作控制面查询凭据。
- **独立查询凭据配置**（`src/providers/volcengine/auth.ts`）：已有模型密钥时点击登录可选择连接 Coding Plan，密码式输入 AK/SK，先验证后原子保存至 SecretStorage；失败/取消不覆盖旧凭据。原模型密钥保留，退出只清理火山私有凭据。
- **套餐显示**（`src/types.ts`、Dashboard、状态栏）：增加可选月额度，percentOnly 模式不虚构请求次数；套餐查询错误可见，月重置时间不按固定 30 天推算，本地日志费用继续独立计算。

### 调整

- GLM 图标按最新要求改为 ⚡，火山保留 🌋；同步中英文提示、README 和设计文档。

### 验证

- 新查询、配置流程和图标回归先失败后通过；类型检查、全部 372 项测试、生产编译及 VSIX 打包通过。覆盖签名向量、三窗口解析、推理密钥隔离、异常和超时、凭据验证与取消、百分比/月额度显示。
- 当前使用响应夹具验证，未获取用户账户 AK/SK，尚未完成真实账户验收。首次在插件中配置会进行只读验证，不发起模型推理。

## [0.6.26] - 2026-11-16

### 修复

- **火山登录未弹出密钥输入框**（`src/providers/volcengine/auth.ts`、`index.ts`）：点击登录直接打开密码式 API Key 输入框，去除首尾空白后保存在 VS Code SecretStorage 的火山专用键；取消或空白保留旧密钥，重启可恢复。
- **火山私有退出**（`src/extension.ts`、`src/providers/base/types.ts`）：增加可选供应商退出接口，仅删除火山密钥；删除失败保留登录状态，不影响其他供应商凭据。
- 中英文成功提示明确仅保存密钥和刷新本地统计，当前不验证密钥、不查询套餐配额；同步设计文档、索引及 README。

### 验证

- 七项登录回归先失败后通过，覆盖安全输入、取消/空值、异常保护、凭据恢复、退出隔离及实际命令调用；类型检查、全部 361 项测试、生产编译和 VSIX 打包通过。

## [0.6.25] - 2026-11-16

### 修复

- **火山与官方 Kimi 费用混算**（`src/calc.ts`）：根据用户实际 Claude 日志，火山的 kimi-k2-8-preview / kimi-k2.8-preview、kimi-k3.1-pro / kimi-k3-1-pro 自动归火山；官方 k3.1-pro 和 kimi-for-coding 归 Kimi。保留命名空间和显式覆盖，官方原生 Kimi 不因规范化同名被移入火山，GLM 的 13:00 分界不变。
- **型号别名计价一致性**：定价键解析去除首尾空白及 [1m] 标记，使已配置的火山 K2.8 自定义费率正确应用。K2.8 未配置单价仍仅统计 Token，不伪造费用。
- 同步中英文费用说明、README 和设计文档。

### 验证

- 新增渠道与累计金额测试先失败后通过；覆盖重复 assistant 块去重、官方原生日志与独立费率，类型检查、全部 354 项测试、生产编译及 VSIX 打包通过。
- 对本机 13:00 后日志只读验证：火山四个型号各一条请求、官方两个型号各一条请求，均进入各自供应商，Claude 未吸收这些请求。

## [0.6.24] - 2026-11-16

### 新增

- **GLM 5.3 渠道切换时间**（`src/calc.ts`、`src/config.ts`、`src/providers/claude/localParser.ts`）：按用户确认的 `2026-11-16T13:00:00+08:00`，将此前裸名 GLM 5.3 系列记录归 GLM 官方，从该时刻起归火山。兼容 `glm-5.3-flash` / `glm-5-3-flash`，同一会话逐条分流；显式会话与命名空间优先，可通过配置修改或清空分界。
- 保留 0.6.23 的火山独立统计与定价、GLM `Ζ` / 火山 `🌋` 图标和旧统计清理；同步双语说明和设计文档。

### 验证

- 时间切换测试先失败后通过；类型检查、全部 351 项测试、生产编译和 VSIX 打包通过。覆盖精确边界、同会话切换、配置清空后缓存重算；本机日志只读检查确认分界前后均有记录。

## [0.6.23] - 2026-11-16

### 新增

- **火山供应商**（`src/providers/volcengine/`）：在 Dashboard 和状态栏独立统计 Claude 日志中的 Token 与人民币 API 等价费用；内置 GLM Flash、Kimi K3.1 Pro、DeepSeek v4.1 Flash Economy 单价，按每条记录的北京时间选择 DeepSeek 工作日峰谷费率。
- **同名模型分流**（`src/providers/claude/localParser.ts`、`src/calc.ts`）：支持 Claude 日志会话 ID 和完整模型名的供应商覆盖，保证同名 GLM 记录在火山/智谱之间独占归属；配置变化后自动重新解析缓存。原有裸 GLM/Kimi 归属保留，不能自动识别缺少渠道信息的历史请求。
- **费用范围说明**：K2.8 Preview 未验证到公开 API 单价，保留 Token 统计并提供独立自定义单价设置；中英 UI 和 README 明确费用缺项、缓存存储/套餐积分等限制及同名分流配置方法。

### 修复与调整

- **归属迁移后的旧统计**（`src/services/scheduler.ts`）：迁移后空扫描清除旧用量与费用，同时保留官方配额，避免界面残留重复统计。
- **供应商图标**：GLM 改为 `Ζ`（希腊大写 Zeta），火山使用 `🌋`。

### 验证

- 先新增火山测试并确认缺失实现失败；补充 Kimi 原定价键回归并确认修复前失败。类型检查、全部 350 项测试、生产编译及 VSIX 打包通过；同步设计文档、索引与中英文 README，保持 UTF-8/CRLF。

## [0.6.22] - 2026-11-09

### 修复

- **GLM 型号误套 Flash 低价**（`src/calc.ts`）：Flash / FlashX 必须是 GLM-5.3 版本后的完整型号后缀；命名空间含 flash 或未识别的 superflash/flashxy 后缀不再误触发低价，保留旗舰参考价。
- **日期测试跨午夜不稳定**（`test/clineSessions.test.ts`）：仅模拟 Date 到固定本地中午，避免运行时刻改变今日和 5h 测试的边界假设；真实文件 IO 不变。

### 验证

- 新增三个计价回归，修复前均失败；类型检查、全部 341 项测试、生产编译及 VSIX 打包通过。审查 Cline 会话解析、缓存分类、定价设置及显示标签，同步设计/测试文档，UTF-8、CRLF、DESIGN 引用检查通过。

## [0.6.21] - 2026-11-09

### 调整

- **精简 GLM 费用说明**（`src/i18n.ts`）：英文改为“API estimate only; Coding Plan uses weighted credits.”（8 个单词），中文同步改为“仅 API 估算；套餐按加权积分计量。”；同步 i18n 设计规范。

### 验证

- 类型检查、全部 338 项测试、生产编译和 VSIX 打包通过，保持 CRLF。

## [0.6.20] - 2026-11-09

### 调整

- **缩短费用标签**（`src/i18n.ts`、`src/presenters/dashboard.ts`）：将 GLM 的 API-equivalent cost (estimated) / API 等价费用（估算）长标签改为 Cost / 费用，窗口金额使用通用费用前缀，节省表头和金额显示空间；估算说明和计价逻辑不变。同步设计文档。

### 验证

- 类型检查、全部 338 项测试、生产编译和 VSIX 打包通过，保持 CRLF。

## [0.6.19] - 2026-11-09

### 修复

- **GLM 总费用使用占位费率导致低估**（`src/providers/glm/pricing.ts`、`index.ts`、`src/config.ts`、`src/calc.ts`）：按官方国内站标准 API 价区分 GLM-5.3、5.2、Flash、FlashX，替换固定 1/2/0.5 的输入/输出/缓存价。新增模型别名映射和 16 项私有费率设置，支持零费率及 customModels 覆盖，默认参考模型改为 GLM-5.3；未知型号暂使用该参考价，不声称是历史账单。
- **费用与套餐积分语义不清**（`src/presenters/dashboard.ts`、`statusBar.ts`、`src/i18n.ts`）：GLM 金额标注为“API 等价费用（估算）”，解释它不是 Coding Plan 实扣金额，套餐配额按加权积分计算，与人民币费用不成比例。

### 验证

- 类型检查、全部 338 项测试、生产编译及 VSIX 打包通过；新增 8 项模型定价与实际用量回归，同步文档并保持 CRLF。
- 同一份用户副本实际重扫：GLM-5.3 48 请求约 9.55924 元、Flash 一请求约 0.02547432 元，今日合计 API 等价估算 9.58471432 元；旧费率为 2.230329 元。缓存读取约占总 Token 的 95.6%，按独立缓存费率计价；不包含额外工具费、缓存存储时长费或特殊折扣，不代表用户账单扣款。

## [0.6.18] - 2026-11-09

### 修复

- **拷回的新版 Cline 用量未被统计**（`src/services/localUsageService.ts`、`src/calc.ts`）：新增 `.cline/data/sessions` 和 `.cline/sessions` 扫描，解析 `*.messages.json` 内逐请求 metrics，兼容模型字段与 SDK 嵌套格式。按原始消息时间聚合和保留，不使用文件拷贝时间；同一会话副本去重，不重复累计会话摘要。
- **缓存输入计数口径**：新版 Cline inputTokens 已包含缓存，拆分成互斥的未缓存输入、输出、缓存读和缓存写，避免重复计数；明确按消息模型归属 Kimi / GLM，隔离坏文件、未完成消息及非法记录。

### 新增

- **总 Token 与来源说明**（`src/services/historyService.ts`、`src/types.ts`、`src/presenters/dashboard.ts`、`src/presenters/statusBar.ts`、`src/i18n.ts`）：明细各时间页显示“总 Token（含缓存）”，输入项明确不含缓存；中英双语说明本机/拷回日志的统计范围，以及网站今日与配额窗口的区别。

### 验证

- 类型检查、全部 330 项测试、生产编译及 VSIX 打包通过；新增 8 项 Cline 会话回归，同步设计文档和索引，保持 CRLF。
- 实际只读重扫用户副本：Cline 48 请求、4,224,954 Token；合并 Claude 日志后今日共 49 请求、4,256,270 Token。相比用户提供的网站今日 4.32M，仍差约 6.4 万 Token，现有副本无法确认这部分来源；未修改用户日志或按网站总数补造记录。

## [0.6.17] - 2026-11-09

### 修复

- **GLM 保存密钥后仍无法查询配额**（`src/providers/glm/api.ts`、`auth.ts`、`index.ts`）：替换占位接口，接入智谱国内站个人 Coding Plan 只读查询；兼容 CREDIT_LIMIT 和 TOKENS_LIMIT 及 5h/周窗口。登录时先校验再保存，失败不覆盖旧密钥；显式输入的密钥优先于旧环境变量。查询不创建模型请求。
- **GLM 查询失败提示**（`src/i18n.ts`、`src/presenters/statusBar.ts`、`dashboard.ts`）：区分密钥失败、套餐缺失、HTTP 失败与网络异常；没有本地记录时也显示错误，避免持续转圈。有本地数据时继续显示统计与估算费用。
- **缺失周配额**（`src/calc.ts`、`src/types.ts`、`src/providers/base/types.ts`）：仅 5h 套餐不再显示虚假的周 0%；Dashboard 保留 7d 本地费用并标记周配额缺失，5h 绝对用量模式正常显示。

### 验证

- 类型检查、全部 322 项测试、生产编译及 VSIX 打包通过；新增 13 项回归，覆盖只读请求、解析、鉴权、限流、异常、超时、密钥优先级和界面诊断。同步设计、协议、i18n 规范及测试文档，保持 CRLF。
- 用户确认使用 bigmodel.cn；接口测试使用模拟响应，未持有或读取用户真实密钥，尚未完成真实账号与 VS Code 窗口验证。

## [0.6.16] - 2026-11-09

### 修复

- **GLM 登录入口**（`src/providers/glm/auth.ts`）：补齐模态指引、可手动访问的官方登录链接、浏览器打开按钮及 API Key 安全输入/保存；取消或保存失败不标记登录成功。远端配额接口尚未接入，明确提示本地统计仍可使用。
- **未登录保留本地统计**（`src/calc.ts`、`src/presenters/statusBar.ts`、`src/presenters/dashboard.ts`）：有本地数据时不再被登录分支遮挡；Token、请求数、费用及历史统计继续显示。缺失配额用红色警告标注，不显示虚假的 0%，恢复后回到正常配额展示。费用明确为本地估算。

### 新增

- **Kimi / GLM 的 Cline 用量**（`src/services/localUsageService.ts`）：在原有原生/Claude 日志之外扫描 Cline 独立目录及常见编辑器存储，按请求模型或任务模型时间线归属，保留输入、输出和缓存统计，支持去重、保留期与异常隔离；无法确认模型的记录跳过。

### 验证

- 类型检查、全部 309 项测试、生产编译及 VSIX 打包通过；新增 8 项离线展示、实际 WebView 渲染、GLM 登录及 Cline 扫描回归。核对本机 6 份 Cline 日志结构；尚未在真实 VS Code 窗口验证登录交互。同步设计文档及索引，保持 CRLF。

## [0.6.15] - 2026-11-09

### 修复

- **重装后状态栏仍不显示**（`src/presenters/statusBar.ts`）：各模型使用独立、稳定的状态栏 id，避免共用扩展级隐藏标识导致所有入口一起消失。新标识恢复默认可见性，之后独立保留各模型的显示偏好，不修改 VS Code 数据库。

### 验证

- 类型检查、全部 301 项测试、生产编译及 VSIX 打包通过；新增两项状态栏标识与隐藏隔离回归，修复前均失败。同步设计与测试文档，保持 CRLF。

## [0.6.14] - 2026-11-09

### 修复

- **未登录模型先显示本地记录**（`src/services/scheduler.ts`）：长刷新先发布本地日志统计，再等待认证和官方配额；官方结果到达后按正确窗口重新聚合。本地首次扫描失败仍继续请求官方数据。
- **失败重试与停止保护**：记录长刷新尝试时间，避免异常触发零延迟重试；异常、超时和停止均清除等待状态。停止后丢弃长短刷新中的迟到结果，防止取消勾选后继续回填状态。

### 验证

- 类型检查、全部 299 项测试、生产编译及 VSIX 打包通过；新增 8 项回归，覆盖认证/API 等待时本地历史显示、异常重试、超时、停止与多模型切换。同步设计及测试文档，保持 CRLF。
- 本机日志记录 2026-11-09 11:16:11 扩展宿主意外退出，但未提供直接崩溃堆栈；本次修复已确认的加载和调度缺陷，实际宿主退出是否消除仍需安装后复测。

## [0.6.13] - 2026-11-06

### 修复

- **仪表盘按钮换行**（`src/presenters/dashboard.ts`）：模型选择区独占一行，从 🏠️ 登录按钮开始的操作按钮另起一行。同步仪表盘设计文档。

### 验证

- 类型检查、全部 291 项测试、生产编译及 VSIX 打包通过；源文件保持 CRLF。

## [0.6.12] - 2026-11-06

### 变更

- **仪表盘按钮图标**（`src/presenters/dashboard.ts`、`src/i18n.ts`）：登录 / 重新连接按钮显示 🏠️，费用 / 百分比切换按钮显示 🔣；保留原文字作为悬停提示和无障碍标签，中英双语一致，点击行为不变。同步仪表盘设计文档。

### 验证

- 类型检查、全部 291 项测试、生产编译及 VSIX 打包通过；源文件保持 CRLF。

## [0.6.11] - 2026-11-05

### 修复

- **COST CURVE 自动切换当前窗口**（`src/presenters/dashboard.ts`）：查看当前窗口时，新 5h / 7d 窗口随 options 刷新自动选中，跨日同步日期和 Hour。手动选择历史窗口时保持选择，选回当前窗口后恢复跟随；历史选择失效时回退到最新窗口。
- **下拉事件引用旧列表**：每次渲染更新 change 处理器，日期切换同时同步窗口选择，避免新窗口无法请求或下一次刷新恢复旧选择。

### 验证

- 类型检查、全部 291 项测试、生产编译及 VSIX 打包通过；新增 6 项 WebView 窗口选择回归，其中 4 项在修复前失败。同步仪表盘与测试设计文档，源文件保持 CRLF；实际 VS Code 长时间跨窗效果待安装验证。

## [0.6.10] - 2026-11-05

### 修复

- **Claude Code 中使用 Kimi/GLM 的用量归属**（`src/calc.ts`、`src/providers/claude/localParser.ts`、`src/providers/kimi/localParser.ts`、`src/providers/glm/index.ts`）：按日志显式模型名称分流，Kimi 合并原生和 Claude 会话，GLM 接入 Claude 本地日志，避免计入 Claude。支持命名空间、大小写及子代理目录，保留 Token 四分类，按请求标识去重，联动缓存失效与数据保留天数。
- **统计范围说明**：无法识别隐藏为 Claude 名称的代理模型；GLM 费用沿用现有估算费率，官方额度 API 尚未实现。

### 验证

- 类型检查、全部 285 项测试、生产编译与 VSIX 打包通过；新增 6 项跨模型日志回归，覆盖归属、子代理、去重、保留天数、异常日志、缓存和 Kimi 合并计价。同步本地估算、Provider、测试设计及文档索引；源文件保持 CRLF。

## [0.6.9] - 2026-11-02

### 修复

- **仪表盘刷新时曲线消失后重绘**（`src/presenters/dashboard.ts`）：同一 5h/7d 窗口刷新期间保留已有曲线，150ms pending 仅在切换到其他窗口时清空旧数据；费用曲线和 Token/费用柱状图只在创建实例前初始化 canvas 高度，避免数据刷新时清空画布或覆盖高 DPI 分辨率；高度比例配置变化时通过 Chart.js 的 aspectRatio/resize 更新，保留配置即时生效行为。

### 验证

- 类型检查、全部 279 项测试、生产编译及 VSIX 打包通过；新增 8 项 WebView 图表回归测试，覆盖同窗口延迟响应、实例复用、高 DPI 画布、跨窗口清空、及时响应取消清空及高度比例配置更新。同步仪表盘和测试设计文档；实际 VS Code 视觉效果待验证。

## [0.6.8] - 2026-10-28

### 修复

- **手动刷新并发覆盖**（`src/services/scheduler.ts`）：长短 tick 串行执行，请求中的重复手动刷新合并为一个待执行刷新，并在上一任务结束后失效 API 缓存。超时后等待底层任务真正结束，防止迟到响应覆盖新状态；完成或停止时清理 watchdog。
- **旧缓存缺少过期提示**（`src/store.ts`、`src/calc.ts`）：从缓存原 fetchedAt 恢复成功时间，支持时间戳 0；缺失时间的缓存按过期处理。
- **短周期 Token 数据滞后**（`src/services/scheduler.ts`）：补齐今日及本周期输出、缓存读取和缓存创建 Token，状态栏悬停详情与仪表盘同步更新。

### 验证

- 类型检查、全部 271 项测试、生产编译及 VSIX 打包通过；新增刷新合并、长短 tick 排队、超时后不重入、失败恢复、停止与定时器清理、缓存时间边界回归，并强化短周期字段替换测试。同步调度器、Store、本地估算及测试设计文档。

## [0.6.7] - 2026-10-28

### 修复

- **Kimi 交互时状态栏仍显示 💤**（`src/calc.ts`、`src/presenters/statusBar.ts`）：原先固定两分钟即标记 API 数据过期，短于默认五分钟轮询周期。改为按当前刷新间隔加两分钟宽限判定，普通显示与动画使用相同规则。💤 表示配额快照过期，本地交互不会修改 API 成功时间。

### 验证

- 类型检查、全部 264 项测试、生产编译与 VSIX 打包通过；新增默认轮询周期、自定义周期和超时边界回归测试，同步状态栏、本地估算与测试设计文档。

## [0.6.6] - 2026-10-26

### 修复

- **Codex 提前重置后仍显示旧用量**（`src/providers/codex/api.ts`、`src/calc.ts`、`src/services/cacheService.ts`）：用量改用只读 GET `/wham/usage`，替代无法稳定返回限额头的模型请求。支持每周单窗口与双窗口，区分合法 0 和无效响应；账号 ID 读取移入 CacheService，错误提示中英双语。
- **旧估算和缓存覆盖新额度**（`src/services/scheduler.ts`）：官方用量下降或重置时间改变后舍弃旧平滑值并重新校准；官方归零且无有效系数时，短周期保持 0。Codex 已有权威数据时，断网不能再用旧会话限额或旧磁盘缓存覆盖它。
- **保留历史费用**：提前重置只同步额度与校准，不删除实际 Token、COST 或历史明细。

### 验证

- 类型检查、全部 261 项测试、生产编译与 VSIX 打包通过；覆盖 90→0、短周期保持清零、旧会话/旧缓存拒绝覆盖、窗口改变及异常响应。
- 实际只读查询返回 HTTP 200 并识别到当前账号的周窗口；未调用任何充值、额度重置或模型生成操作。同步 Provider、Scheduler、CacheService、本地估算、i18n 和测试设计文档。

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
