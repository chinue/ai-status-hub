---
name: reusable-format-functions
description: 强制提取任何可能在多处使用的格式化、显示或计算逻辑为可复用函数。适用于 claude-status-pro 项目中的所有 TypeScript 源文件。
---

# 可复用格式化函数规则

## 原则

**任何用于格式化、计算或转换数据以供显示的逻辑 —— 且可能需要在多个位置使用 —— 必须提取为命名导出函数，放在 `src/calc.ts`（或其他适当的共享模块）中。**

禁止在 UI 组件、Presenter 或 Service 中内联格式化逻辑。

## 原因

- **一致性**：同一数据在任何地方都以相同方式渲染。
- **可维护性**：当格式要求变更时（例如"秒数始终用 0 填充"），只需修改**一个函数**，而非分散在 N 处的副本。
- **可测试性**：独立的纯函数易于单元测试。
- **可发现性**：新开发者可以在一个地方找到格式化工具函数。

## 强制提取清单

以下类别必须始终是函数，绝不能是内联代码：

| 类别 | 示例 | 当前位置 |
|---|---|---|
| **时长 / 剩余时间** | `fmtDuration`、`fmtHours`、`fmtReset` | `src/calc.ts` |
| **Token 数量** | `fmtTokens`（k/M 后缀） | `src/calc.ts` |
| **成本 / 货币** | `fmtCost`（¥ 自适应小数位） | `src/calc.ts` |
| **百分比** | `formatPercent`、`formatPercentPadded` | `src/calc.ts` |
| **进度条** | `buildBar`、`buildMiniBar` | `src/calc.ts` |
| **ASCII 表格** | `drawBorderTable`、`displayWidth`、`padCell` | `src/calc.ts` |
| **数据提取** | 从 state 中获取配额百分比、利用率、重置时间 | `src/calc.ts` |

## 禁止的模式

❌ **在 Presenter 中内联格式化**
```typescript
// BAD — 在 dashboard.ts 或 statusBar.ts 内部
const secs = totalSeconds % 60;
const pad2 = (n) => String(n).padStart(2, ' ');
return pad2(days) + 'd' + pad2(hours) + 'h';
```

✅ **在 calc.ts 中使用可复用函数**
```typescript
// GOOD — 单一可信来源
export function fmtDuration(totalSeconds: number): string {  // ...实现...
}
```

❌ **在 tooltip 中内联构建表格**
```typescript
// BAD — 手动空格，无 CJK 感知
md.appendMarkdown(`${''.padEnd(6)} ${col1.padStart(8)} ...`);
```

✅ **使用可复用表格绘制器**
```typescript
// GOOD — CJK 感知、对齐、可测试
const lines = drawBorderTable(header, rows, align);
md.appendMarkdown(lines.join('\n'));
```

## 审查检查清单

在将任何 Presenter 或 Service 文件标记为完成之前，请验证：

1. [ ] 没有对显示值使用内联 `padStart`/`padEnd` 格式化
2. [ ] 没有对百分比或利用率使用内联算术
3. [ ] 没有对时长、成本或 Token 数量使用内联字符串拼接
4. [ ] 没有内联表格/行构造（使用 `drawBorderTable`）
5. [ ] 所有格式化工具函数均从 `src/calc.ts`（或指定的共享模块）导入

## 何时添加新函数

问自己：**"这个逻辑是否可能在另一个组件中使用？"**

- 如果是 → 提取到 `src/calc.ts`
- 如果否（真正的一次性使用）→ 添加注释说明为什么保持内联

> **默认倾向**：犹豫不决时，提取它。
