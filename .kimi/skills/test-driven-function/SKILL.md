---
name: test-driven-function
description: 对复杂、可复用或高风险的函数强制采用测试优先开发。适用于添加涉及非平凡逻辑、被多个模块调用或错误行为后期调试成本高昂的新函数时。本规则适用于 src/ 和 test/ 中的 TypeScript/JavaScript 源文件。
---

# 测试驱动的函数开发

## 何时应用

在编写或修改符合以下一项或多项标准的任何函数之前，应用本规则：

1. **复杂逻辑**：分支、带边界情况的算术、状态转换或算法计算
2. **多消费者**：从模块导出并被 2+ 个其他文件导入
3. **高影响范围**：此处的 bug 会破坏 UI、损坏数据或导致扩展宿主崩溃
4. **纯函数 / 易于测试**：函数无副作用或副作用可被模拟
5. **回归风险**：替换现有函数，其行为被其他模块依赖

## 工作流程

### 第 1 步：先写测试

在实现函数体之前，先在适当的 `test/*.test.ts` 文件中编写测试：

- 用有代表性的输入覆盖**正常路径**
- 覆盖**边界情况**：零、null、undefined、空数组、边界值
- 如果函数预期会抛出异常或返回错误状态，覆盖**错误路径**
- 测试命名应具有描述性：`it('caps at 100% when usage exceeds limit')`

### 第 2 步：运行测试 —— 它必须失败

运行测试套件并确认新测试失败（红）：

```bash
node node_modules/mocha/bin/mocha --config .mocharc.json
```

如果在函数实现之前测试就通过了，则测试无效（例如，断言了未定义的行为）。修复测试。

### 第 3 步：实现函数

编写使测试通过的最小实现。不要过度设计。

### 第 4 步：运行测试 —— 它必须通过

再次运行完整测试套件并确认：

- 新测试通过
- **所有现有测试仍然通过**（无回归）

如果有任何测试失败，在继续之前修复实现。不要带着失败的测试套件继续推进。

### 第 5 步：如需则重构

在测试通过的保障下，为清晰度、性能或 DRY 原则进行重构。每次重构步骤后重新运行测试。

## 测试覆盖指南

| 函数类型 | 最低覆盖率 |
|---|---|
| 纯数学 / 工具函数 (calc.ts) | 100% 分支 |
| Store reducer | 100% action 类型 |
| Service 公共方法 | 80% 分支 |
| Presenter 渲染逻辑 | 60%（UI 断言） |

## 禁止的模式

- **不要**提交没有至少一个对应测试的新函数
- **不要**用 `.skip()` 或注释跳过失败的测试，除非附带 `// TODO(#issue)`
- **不要**仅依赖手动测试来验证可被单元测试的函数
- **不要**仅在集成 bug 出现在生产环境后才添加测试

## 例外：难以测试的函数

如果某个函数确实难以进行单元测试（例如深度 VS Code API 集成、文件系统监视器），在代码注释中说明原因，并改为提供集成测试或手动测试脚本。

## 示例

```typescript
// src/calc.ts
export function calibrateTokenCapacity(apiPct: number, tokens: number): number | null {
  // 实现
}

// test/calc.test.ts
import { calibrateTokenCapacity } from '../src/calc';

describe('calibrateTokenCapacity', () => {
  it('calculates capacity from API pct and local tokens', () => {
    const cap = calibrateTokenCapacity(62, 10_000_000);
    expect(cap).to.be.closeTo(16_129_032, 1);
  });
  it('returns null for zero API pct', () => {
    expect(calibrateTokenCapacity(0, 10_000_000)).to.be.null;
  });
});
```
