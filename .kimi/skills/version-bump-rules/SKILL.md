---
name: version-bump-rules
description: 定义 claude-status-pro VS Code 扩展的版本升级规则。适用于更新 package.json 中的版本号、编译 VSIX 包或判断变更属于 minor 还是 patch 时。适用于 package.json 和发布流程步骤。
---

# 版本升级规则

## SemVer 方案

本项目使用 `MAJOR.MINOR.PATCH`（例如 `0.1.0`）。

| 位置 | 何时升级 | 示例 |
|---|---|---|
| **MAJOR**（第一位） | 破坏性变更或完全重写 | v1 → v2 架构大改 |
| **MINOR**（第二位） | **重大功能新增**或阶段完成 | Phase 2 本地估算、新 dashboard 卡片、多模型支持 |
| **PATCH**（第三位） | Bug 修复、小幅调整或微小改进 | Tooltip 措辞修复、颜色调整、单个测试补充 |

## 决策矩阵

```
新阶段 / 重大功能模块      → MINOR +1, PATCH = 0
  示例：0.0.3 → 0.1.0 (Phase 2: 本地估算)

当前阶段内的单个新功能     → PATCH +1
  示例：0.1.0 → 0.1.1 (dashboard 添加成本曲线)

Bug 修复 / 重构 / 仅测试   → PATCH +1
  示例：0.1.1 → 0.1.2 (修复 scheduler 竞态条件)

破坏性 API 变更 / 完全重建  → MAJOR +1 (v0.x 中较少见)
  示例：0.5.3 → 1.0.0 (稳定发布)
```

## VSIX 输出位置

**始终将 VSIX 编译到 `bin/`，**永远不要放在仓库根目录。

```bash
# 正确
node node_modules/@vscode/vsce/vsce package --no-dependencies --out bin/

# 错误 —— 污染根目录
node node_modules/@vscode/vsce/vsce package --no-dependencies
```

## 发布流程顺序

1. 按照上述规则在 `package.json` 中升级版本
2. 在新版本标题下更新 `ChangeLog.md`
3. 运行测试 → 必须通过
4. 编译 VSIX 到 `bin/`
5. 使用版本升级信息执行 Git commit

## 禁止的模式

- **不要**在仓库根目录遗留旧的 VSIX 文件
- **不要**为整个新功能模块升级 PATCH（应使用 MINOR）
- **不要**为单行修复升级 MINOR（应使用 PATCH）
- **不要**在测试通过前打包 VSIX
