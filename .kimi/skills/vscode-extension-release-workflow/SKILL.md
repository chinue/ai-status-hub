---

name: vscode-extension-release-workflow

description: VS Code 扩展开发和发布工作流程。适用于 kimi-status-ex 项目。强制执行 测试 → 编译 → 打包 → 更新变更日志 → Git 提交 的顺序。

---



# VS Code 扩展发布工作流程



## 预提交检查清单（必须按顺序执行）



1. **代码变更完成** —— 通过 `WriteFile` / `StrReplaceFile` 应用所有编辑

2. **设计文档同步检查** —— 验证设计文档是否已更新

   - 运行 `git diff --name-only HEAD~1` 列出变更的文件

   - 运行 `grep -rn "DESIGN:" src/` 查看引用了哪些设计文档

   - 对照 `docs/INDEX.md` 交叉检查：对每个变更的 `src/` 文件，验证其链接的设计文档是否反映了当前代码

   - 如果新功能/模块没有 `DESIGN:` 注释或没有索引条目，则同时添加两者：

     - 在新代码文件顶部添加 `// DESIGN: <doc>#<anchor>`

     - 在 `docs/INDEX.md` 中添加文件到文档的映射

3. **类型检查** —— 运行 `node node_modules/typescript/bin/tsc --noEmit`

4. **运行测试** —— 运行 `node node_modules/mocha/bin/mocha --config .mocharc.json`

   - 如果测试失败 → 先修复代码，不要继续

5. **升级版本号** —— 检查 `package.json` 中的 `version` 字段，确保本次发版版本号已增加

   - 版本格式为 `MAJOR.MINOR.PATCH`（例如 `0.1.0`）

   - **MAJOR（第一位）**：仅在破坏性变更或完全重写时升级（v0.x 阶段很少变动）

   - **MINOR（第二位）**：新阶段 / 重大功能模块完成时升级，并将 PATCH 归零（例如 `0.0.3 → 0.1.0`）

   - **PATCH（第三位）**：当前阶段内的单个新功能、Bug 修复、重构或测试补充时升级（例如 `0.1.0 → 0.1.1`）

   - 每次发版**至少**升级 PATCH +1，禁止版本号不变

6. **编译** —— 运行 `node esbuild.js --production`

7. **打包 VSIX** —— 运行 `node node_modules/@vscode/vsce/vsce package --no-dependencies`

   - 打包生成的 `.vsix` 文件**必须放到 `bin/` 目录**

   - 清理冗余文件：

     - 删除与已有 `.vsix` **内容完全相同**的 `.zip` 文件（VSIX 本质就是 ZIP，保留 `.vsix` 即可）

     - 删除 `bin/` 下所有 `vsix-xxx` 解压文件夹（这些是旧版本手动解压的临时目录，不属于构建产物）

     - 若某个版本只有 `.zip` 没有 `.vsix`，将其重命名为 `.vsix`

8. **询问用户是否确认 Git 提交** —— 展示变更摘要

   - 如果用户说 **否** → 停止，保持工作目录原样

   - 如果用户说 **是** → 继续执行步骤 9-10

9. **更新 `ChangeLog.md`**

   - 在顶部 `## [Unreleased]` 下添加变更

   - 分类为 `### Added`、`### Changed`、`### Fixed`、`### Removed`

   - 编写简洁的要点，附带受影响的文件引用

10. **Git 提交**

   - 暂存所有变更：`git add -A`

   - 使用能概括变更本质的摘要信息提交

   - 如果存在多个逻辑变更，使用多次提交或多行提交信息



## 变更日志格式



```markdown

## [Unreleased]



### Added

- **功能名称** (`src/file.ts`)

  - 详细要点

  - 另一个要点



### Changed

- **行为变更** (`src/file.ts`)

  - 变更前 → 变更后描述



### Fixed

- **Bug 描述** (`src/file.ts`)

  - 根因和修复摘要

```



## 提交信息风格



- 使用祈使语气："Add X"、"Fix Y"、"Refactor Z"

- 添加类型前缀：`feat:`、`fix:`、`style:`、`refactor:`、`test:`、`docs:`

- 主题行保持在 72 个字符以内

- 如果变更跨多个文件或有副作用，添加正文要点



## 提交后



- 向用户报告提交哈希和测试数量

- 如果打包成功，提及打包的 VSIX 文件名

