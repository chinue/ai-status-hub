# CodexStatusPro Agent Instructions

## 最高优先级规则（不可遗忘）

### 1. 发版流程（必须严格执行）
每次修复/功能完成后，**必须**按以下顺序执行：
1. 类型检查：`node node_modules/typescript/bin/tsc --noEmit`
2. 运行测试：`node node_modules/mocha/bin/mocha --config .mocharc.json`
3. 升级版本号（`package.json`）— 规则如下：
   - **PATCH +1**：Bug 修复、重构、当前阶段内的单个新功能
   - **MINOR +1, PATCH = 0**：新阶段 / 重大功能模块完成
   - **MAJOR +1**：破坏性 API 变更 / 完全重建（v0.x 中极少）
   - 示例：dashboard 添加成本曲线 → 0.1.0→0.1.1；修复 scheduler 竞态 → 0.1.1→0.1.2
4. Production 编译：`node esbuild.js --production`
5. 打包 VSIX：`node node_modules/@vscode/vsce/vsce package --no-dependencies --out bin/`
6. 更新 `ChangeLog.md`
7. **询问用户确认**后执行 Git 提交

### 2. 设计文档同步检查
- 每个 `src/` 文件顶部必须有 `// DESIGN: <doc>#<anchor>` 注释
- 修改代码后**必须**同步更新对应的设计文档（`docs/v2-phase2-implementation.md` 等）
- 通过 `docs/INDEX.md` 查找文件到文档的映射

### 3. 编码强制规范（来自 `docs/CODING_STANDARDS.md`）
- **磁盘访问隔离**：只有 `LocalUsageService` 和 `CacheService` 可以访问磁盘；Presenter/Service 禁止直接 IO
- **格式化封装**：所有格式化/显示逻辑提取到 `src/calc.ts`，禁止在 Presenter/Service 中内联
- **异常防护**：磁盘 IO、网络请求、`JSON.parse`、第三方库调用必须加 `try-catch`，禁止裸抛异常
- **i18n**：所有显示字符串通过 `makeT()` 翻译，禁止硬编码；新增时必须中英双语同时添加
- 新增复杂函数必须**先写测试**（`test-driven-function` skill）
- 源文件使用 Windows CRLF 换行（`line-endings` skill）
- 含中文的文件通过 PowerShell 读写时必须显式指定 `-Encoding UTF8`

### 4. 项目架构速查
| 模块 | 入口文件 | 设计文档 |
|---|---|---|
| 状态管理 | `src/store.ts` | `v2-phase2-implementation.md#storets` |
| 状态栏 | `src/presenters/statusBar.ts` | `v2-phase2-implementation.md#presentersstatusbarts` |
| 调度器 | `src/services/scheduler.ts` | `v2-phase2-implementation.md#servicesschedulerts` |
| 本地估算 | `src/services/localUsageService.ts` | `v2-local-estimation-design.md` |
| Dashboard | `src/presenters/dashboard.ts` | `v2-dashboard-design.md` |

### 6. 中文优先沟通
- **Plan 文档**：通过 `EnterPlanMode` 制定的所有实现计划、技术方案必须使用中文书写（技术术语可保留英文）。
- **用户回答**：向用户作出的所有文字回复必须使用中文（用户明确要求其他语言时除外）。
- **思考过程**：内部推理、分析、总结优先使用中文进行。
- 参考 `.kimi/skills/chinese-first/SKILL.md`

### 5. Skills 目录
```
.kimi/skills/
  vscode-extension-release-workflow/SKILL.md  ← 发版流程（最高优先级）
  version-bump-rules/SKILL.md                 ← 版本号规则
  reusable-format-functions/SKILL.md          ← 格式化函数提取规则
  test-driven-function/SKILL.md               ← 测试优先规则
  line-endings/SKILL.md                       ← 换行风格
  safe-utf8-file-ops/SKILL.md                 ← UTF-8 文件安全读写
```

---

> **记忆口诀**：修完代码→测→编→包→问→提。文档同步不能忘，calc.ts 里找格式。
