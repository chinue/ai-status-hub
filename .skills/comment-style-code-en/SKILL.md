---
name: comment-style-code-en
description: 在 C/C++/CUDA 源文件中强制使用英文注释，并优先使用 //。适用于编辑或审查匹配 **/*.{c,cc,cpp,cxx,h,hpp,hh,hxx,cu,cuh,inl} 的文件。本规则仅约束源代码内部的注释；规则文件、文档和对话语言不受限制。
---

# 源代码注释风格：英文 + 优先使用 //

> 注意：仅**源代码内部的注释**必须使用英文。Cursor 规则、对话回复和文档不受此规则约束。

## 通用规则

- **源代码注释统一使用英文**（包括 TODO / NOTE / FIXME 的描述）。
- **优先使用双斜杠注释**：`//`。

## 详细规则

- **单行 / 简短注释**：使用 `//`。
- **多行说明**：优先使用多行 `//`（每行一条），不要用 `/* ... */` 包裹大块内容。
- **允许使用块注释 `/* ... */` 的场景**：  - **许可证 / 版权头**（通常必须保持原样）。  - **大量临时注释掉的代码**（例如临时禁用，且逐行添加 `//` 会更难阅读）。  - **少量跨行的 Doxygen 风格注释**（如果项目已有约定或接口文档需要）。
- **避免**重复描述代码在做什么；注释应说明意图、约束、边界条件以及**为什么**要这样做。

## 示例（注释正文使用英文）

```cpp
// GOOD: English + //
// Semiplanar chroma rows are interleaved; stride is width * 2 * bpp for UV.

// GOOD: multiple lines
// In-place paths may need a scratch buffer to avoid read/write hazards.

/* OK: license header (example) */
```
