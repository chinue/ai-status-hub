---
name: safe-utf8-file-ops
description: 防止 Windows 上 UTF-8 文件损坏。适用于通过 PowerShell、Shell 或任何自动化工具读写包含中文字符的文本文件时。基于真实事件：Set-Content 将 6 份设计文档从 UTF-8 重新编码为 GBK 导致损坏。
---

# Windows 上的安全 UTF-8 文件操作

## 陷阱：PowerShell 5.1 的默认编码

在 Windows 上使用 PowerShell 5.1（内置版本）时，`Set-Content` 和 `Get-Content` 默认使用**系统 ANSI 代码页**（中文 Windows 通常为 CP936/GBK），**而非 UTF-8**。

当你运行：
```powershell
$content = Get-Content file.md -Raw     # 将 UTF-8 字节按 GBK 读取 → 乱码
Set-Content file.md $content            # 将乱码按 GBK 写入 → 永久损坏
```

UTF-8 字节被 GBK 错误解码，然后重新编码为 GBK。无效字节被替换为 `?` (`0x3F`)。这种损坏是**不可逆的** —— 原始字节已永久丢失。

### 真实事件（2026-05-11）

一个使用 `Set-Content` 的批量替换脚本摧毁了 **6 份设计文档**（总计约 120KB）。Git 无法恢复它们，因为这些文件未被跟踪。恢复需要从 Kimi CLI 的 `context_4.jsonl` / `context_5.jsonl` 压缩备份中提取原始的 `WriteFile` 工具调用。

---

## 危险操作（永远不要对含中文的 UTF-8 文件使用）

| 操作 | 为什么危险 | 安全替代方案 |
|-----------|--------------|------------------|
| `Set-Content file $text` | 默认使用 ANSI (GBK) 编码 | `WriteFile` 工具，或 Python `open(..., encoding='utf-8')` |
| `Get-Content file` → `Set-Content file` | 双重损坏：先错误解码再错误编码 | `Copy-Item`（二进制复制），或 `StrReplaceFile` 工具 |
| `Out-File file` | 与 `Set-Content` 相同的默认编码陷阱 | 同上 |
| `Get-Content file`（无 `-Encoding`） | 在 PS 5.1 上默认使用 ANSI；可能误读 UTF-8 字节 | Python `open(..., encoding='utf-8')`，或 `Get-Content -Encoding UTF8` |

---

## 安全操作（始终使用这些）

### 1. `WriteFile` 工具（二进制安全，推荐）

`WriteFile` 工具直接写入原始字节，不进行任何编码转换。它是创建或覆盖包含中文字符的文件的最安全方法。

```
WriteFile(path="docs/设计文档.md", content="# 标题\n中文内容...")
```

- ✅ 默认 UTF-8 无 BOM
- ✅ 不依赖系统代码页
- ✅ 永远不会损坏中文字符

### 2. `StrReplaceFile` 工具（二进制安全，推荐）

对于原地文本替换，使用 `StrReplaceFile` 替代 PowerShell 字符串替换 + `Set-Content`：

```
StrReplaceFile(path="docs/设计文档.md", edit={  old: "kimiStatusEx",  new: "claudeStatusPro"
})
```

- ✅ 保留原始 UTF-8 编码
- ✅ 无中间编码转换
- ✅ 比任何基于 PowerShell 的替换更安全

### 3. `Copy-Item`（二进制复制）

用于在目录之间复制文件：

```powershell
Copy-Item -Path "source/设计文档.md" -Destination "target/设计文档.md"
```

- ✅ 纯二进制复制 —— 编码无关紧要
- ✅ 永远不会损坏内容

### 4. Python（显式编码控制）

当你需要以编程方式读写时：

```python
# 安全读取 UTF-8
with open("docs/设计文档.md", "r", encoding="utf-8") as f:
    content = f.read()

# 安全写入 UTF-8
with open("docs/设计文档.md", "w", encoding="utf-8") as f:
    f.write(content)
```

- ✅ 显式声明编码
- ✅ 跨平台一致性
- ✅ 适用于所有 Python 版本

### 5. PowerShell 6+（如果可用）

如果必须使用 PowerShell 且已安装 PS 6+：

```powershell
# PS 6+ 支持 utf8NoBOM
Set-Content -Path "file.md" -Value $text -Encoding utf8NoBOM
```

- ⚠️ 内置 PowerShell 5.1 不可用
- ⚠️ 优先使用 `WriteFile` / `StrReplaceFile` / Python

---

## 批量替换最佳实践

跨多个文件替换文本时：

```
❌ BAD: PowerShell 管道
$files = Get-ChildItem docs -Filter "*.md"
foreach ($f in $files) {
    $c = Get-Content $f -Raw              # 危险：ANSI 解码
    $c = $c -replace "old", "new"
    Set-Content $f $c -NoNewline          # 危险：ANSI 编码
}

✅ GOOD: StrReplaceFile 工具（首选）
StrReplaceFile(path="docs/设计文档.md", edit={old:"old", new:"new"})
# 对每个文件重复

✅ GOOD: Python 脚本（如果文件很多）
import os, re
for fname in os.listdir("docs"):
    path = os.path.join("docs", fname)
    with open(path, "r", encoding="utf-8") as f:
        content = f.read()
    content = content.replace("old", "new")
    with open(path, "w", encoding="utf-8") as f:
        f.write(content)
```

---

## 编码检测提示

操作文件前，验证其编码：

```powershell
# 检查 UTF-8 BOM（前 3 个字节）
$bytes = [System.IO.File]::ReadAllBytes("file.md")
$hasBom = ($bytes[0] -eq 239 -and $bytes[1] -eq 187 -and $bytes[2] -eq 191)

# 使用 Python 快速检查 UTF-8 有效性
python -c "
with open('file.md', 'rb') as f:
    data = f.read()
try:
    data.decode('utf-8')
    print('Valid UTF-8')
except:
    print('NOT valid UTF-8 — do not proceed with text operations')
"
```

---

## 恢复（如果损坏已发生）

如果文件被 ANSI 编码损坏：

1. **不要再向文件写入任何内容** —— 每次写入都会使恢复更加困难
2. **检查 Git** —— 如果文件已被跟踪，`git checkout -- <file>` 可能恢复它们
3. **检查 Kimi CLI 备份** —— `.kimi/sessions/` 中的 `context_4.jsonl`、`context_5.jsonl` 可能包含原始的 `WriteFile` 工具调用
4. **检查 VS Code 撤销历史** —— 如果文件在 VS Code 中编辑且未关闭
5. **接受重新创建** —— 如果所有方法都失败了，损坏通常是不可逆的

---

## 总结规则

> **当你需要以编程方式读写包含中文字符的文件时：**> > 1. **优先使用 `WriteFile` / `StrReplaceFile` 工具**（二进制安全）> 2. **使用显式 `encoding='utf-8'` 的 Python**（显式控制）> 3. **复制文件时使用 `Copy-Item`**（二进制，无编码问题）> 4. **永远不要在 PowerShell 5.1 中使用裸 `Set-Content` / `Get-Content` / `Out-File`**
