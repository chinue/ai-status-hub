# KimiStatusPro 设计文档索引

> **用途**：代码变更后，通过 `grep -r "DESIGN:" src/` 快速定位相关设计文档。
>
> **维护规则**：
> 1. 新增功能时，在代码入口处添加 `// DESIGN: <doc>#<anchor>` 注释
> 2. 若索引中无对应条目，根据功能与阶段的相关程度补充到相应文档
> 3. 定期用 `grep` 检查代码中 DESIGN 注释与索引的一致性

---

## 按代码文件索引

| 代码文件 | 设计文档 | 说明 |
|---|---|---|
| `src/extension.ts` | `v2-phase2-implementation.md#extensionts` | 扩展激活、命令注册、状态恢复 |
| `src/store.ts` | `v2-phase2-implementation.md#storets` | Redux-like 状态管理、reducer 逻辑 |
| `src/config.ts` | `v2-phase2-implementation.md#configts` | 配置读取、默认值、变更监听 |
| `src/calc.ts` | `v2-local-estimation-design.md` | 本地估算算法、格式化函数 |
| `src/types.ts` | `v2-phase2-implementation.md#typests` | 全局类型定义 |
| `src/i18n.ts` | `CODING_STANDARDS.md#5-i18n-强制规范` | 翻译字典、语言切换 |
| `src/utils.ts` | `v2-phase2-implementation.md` | 通用工具（日志、SecretStorage） |
| `src/presenters/statusBar.ts` | `v2-phase2-implementation.md#presentersstatusbarts` | 状态栏渲染、tooltip、暂停交互 |
| `src/presenters/dashboard.ts` | `v2-dashboard-design.md` | Dashboard WebView、数据可视化 |
| `src/services/apiService.ts` | `v2-provider-abstraction.md` | API 请求、配额数据解析 |
| `src/services/authService.ts` | `v2-phase2-implementation.md#servicesauthservicets` | OAuth/API Key 认证、token 缓存 |
| `src/services/cacheService.ts` | `v2-phase2-implementation.md#servicescacheservicets` | 磁盘缓存读写、schema 版本管理 |
| `src/services/localUsageService.ts` | `v2-local-estimation-design.md` | 本地 JSONL 扫描、用量聚合 |
| `src/services/scheduler.ts` | `v2-phase2-implementation.md#servicesschedulerts` | 长短 tick 调度、自动刷新 |
| `src/services/apiHistoryService.ts` | `v2-phase2-implementation.md#servicesapihistoryservicets` | 估算器历史 JSONL 磁盘读写（api + short tick） |

---

## 按功能模块索引

### 核心架构
- **状态管理**：`v2-rebuild-design.md` → `src/store.ts`
- **Provider 抽象**：`v2-provider-abstraction.md` → `src/services/apiService.ts`, `src/services/authService.ts`
- **配置系统**：`v2-phase2-implementation.md#configts` → `src/config.ts`, `package.json`

### 显示层
- **状态栏**：`v2-phase2-implementation.md#presentersstatusbarts` → `src/presenters/statusBar.ts`
- **Dashboard**：`v2-dashboard-design.md` → `src/presenters/dashboard.ts`
- **i18n**：`CODING_STANDARDS.md#5-i18n-强制规范` → `src/i18n.ts`

### 数据层
- **API 配额**：`v2-provider-abstraction.md` → `src/services/apiService.ts`
- **本地估算**：`v2-local-estimation-design.md` → `src/services/localUsageService.ts`, `src/calc.ts`
- **缓存**：`v2-phase2-implementation.md#servicescacheservicets` → `src/services/cacheService.ts`

### 调度与刷新
- **Scheduler**：`v2-phase2-implementation.md#servicesschedulerts` → `src/services/scheduler.ts`
- **暂停/恢复**：`v2-phase2-implementation.md#extensionts` → `src/extension.ts`, `src/presenters/statusBar.ts`

### 编码规范
- **通用规范**：`CODING_STANDARDS.md` → `src/` 全部文件
- **测试规范**：`v2-test-design.md` → `test/` 全部文件
- **发布流程**：`.kimi/skills/vscode-extension-release-workflow/SKILL.md` → `bin/`, `package.json`

---

## 快速检查脚本（PowerShell）

```powershell
# 1. 列出代码中所有 DESIGN 注释
Write-Host "=== 代码中的 DESIGN 标记 ==="
grep -rn "DESIGN:" src/

# 2. 检查最近修改的代码文件对应的设计文档
Write-Host "`n=== 最近修改的文件（git diff --name-only）===""
git diff --name-only HEAD~1 | ForEach-Object {
    $file = $_
    Write-Host "`n文件: $file"
    # 在索引中查找匹配
    $match = Select-String -Path docs/INDEX.md -Pattern $file
    if ($match) {
        $match | ForEach-Object { Write-Host "  -> $($_.Line)" }
    } else {
        Write-Host "  -> 未在索引中找到，需要补充"
    }
}
```
