# V8 字节码和汇编代码打印指南

本文档介绍如何使用 V8 的命令行标志来同时打印字节码和对应的汇编代码。

## 重要说明

**V8 不提供"逐字节码"对应汇编的直接输出格式**。输出总是分为两部分：
1. 先打印所有字节码
2. 然后打印所有汇编代码

但是，通过使用 `--code-comments` 标志，可以在汇编代码中看到 Maglev IR 节点的注释，从而推断字节码到汇编的对应关系。

## 快速参考

### 最佳方式（推荐）：带注释的 Maglev 输出

```bash
# 在汇编代码中显示 Maglev 节点注释
out/x64.debug/d8 --allow-natives-syntax --code-comments \
  --maglev-print-bytecode --print-maglev-code script.js
```

**这是最接近"字节码到汇编映射"的输出**，因为：
- 字节码会先打印
- 汇编代码中会有 Maglev IR 节点的注释（如 `CheckedSmiUntag`, `Int32AddWithOverflow`）
- 可以通过节点注释推断哪些汇编对应哪条字节码

### 通用方式（适用于所有编译器）

```bash
# 打印字节码和优化代码
out/x64.debug/d8 --print-bytecode --print-opt-code script.js

# 打印字节码和所有代码
out/x64.debug/d8 --print-bytecode --print-code script.js
```

### 显示 Maglev 图和代码生成

```bash
# 显示字节码到 IR 节点的转换，以及寄存器分配
out/x64.debug/d8 --allow-natives-syntax \
  --print-maglev-graph --print-maglev-code script.js
```

## 详细说明

### 1. 字节码打印标志

| 标志 | 说明 |
|------|------|
| `--print-bytecode` | 打印 Ignition 解释器生成的字节码 |
| `--print-bytecode-filter="pattern"` | 过滤要打印字节码的函数（默认 "*"） |
| `--maglev-print-bytecode` | 打印 Maglev 编译的函数的字节码 |
| `--maglev-print-feedback` | 打印 Maglev 编译代码的反馈向量 |
| `--maglev-print-inlined` | 同时打印内联代码的字节码/反馈向量 |

### 2. 汇编代码打印标志

| 标志 | 说明 |
|------|------|
| `--print-code` | 打印生成的所有代码 |
| `--print-opt-code` | 打印优化后的代码（TurboFan/Turboshaft） |
| `--print-opt-code-filter="pattern"` | 过滤要打印优化代码的函数 |
| `--print-maglev-code` | 打印 Maglev 代码 |
| `--print-code-verbose` | 打印更详细的代码信息 |
| `--print-all-code` | 启用所有代码打印相关的标志 |

### 3. 其他相关标志

| 标志 | 说明 |
|------|------|
| `--print-builtin-code` | 打印内置函数的代码 |
| `--print-builtin-code-filter="pattern"` | 过滤要打印的内置函数 |
| `--print-regexp-code` | 打印正则表达式生成的代码 |
| `--print-regexp-bytecode` | 打印正则表达式字节码 |

## 输出格式示例

### Maglev 编译器输出

```
Compiling 0x10980082caa1 <JSFunction add (sfi = 0x10980082ca11)> with Maglev

Parameter count 3
Register count 0
Frame size 0
   23 S> 0x37dc00800144 @    0 : 0b 04             Ldar a1
   32 E> 0x37dc00800146 @    2 : 40 03 00          Add a0, [0]
   36 S> 0x37dc00800149 @    5 : b7                Return

Constant pool (size = 0)
Handler Table (size = 0)
Source Position Table (size = 8)

[FeedbackVector 信息...]

--- Disassembly: ---
kind = MAGLEV
name = add
compiler = maglev
address = 0x37dc008002e1

Instructions (size = 896)
0x732773540040     0  8b59f4               movl rbx,[rcx-0xc]
0x732773540043     3  490b9d50020000       REX.W orq rbx,[r13+0x250]
0x73277354004a     a  f6431b80             testb [rbx+0x1b],0x80
0x73277354004e     e  740d                 jz 0x73277354005d  <+0x1d>
...
```

### Ignition + TurboFan 输出

使用 `--print-bytecode --print-opt-code` 时：
- 首先输出所有函数的字节码
- 然后在优化发生时输出优化后的代码

### 带注释的 Maglev 输出（推荐）

使用 `--code-comments --maglev-print-bytecode --print-maglev-code` 时，输出格式如下：

#### 1. 字节码部分
```
Parameter count 3
Register count 0
Frame size 0
   23 S> 0x... @    0 : 0b 04             Ldar a1
   32 E> 0x... @    2 : 40 03 00          Add a0, [0]    ← 字节码偏移 2
   36 S> 0x... @    5 : b7                Return
```

#### 2. Maglev 图部分（使用 `--print-maglev-graph`）
```
Block b1
[0;34m   2 : Add a0, [0]                    ← 字节码
[m    9/9: CheckedSmiUntag [n2]          ← Maglev IR 节点 9
  10/10: CheckedSmiUntag [n3]          ← Maglev IR 节点 10
  11/11: Int32AddWithOverflow [n9, n10] ← Maglev IR 节点 11
```

#### 3. 汇编代码部分（带注释）
```
Instructions (size = 896)
...
-- 9: CheckedSmiUntag [n2] ...         ← 节点 9 开始
0x...   115  488b4518      REX.W movq rax,[rbp+0x18]   ← 加载参数a1
0x...   132  a801          test al,0x1                 ← 检查是否是Smi
0x...   134  0f85...       jnz 0x...                   ← 不是则deopt

-- 10: CheckedSmiUntag [n3] ...        ← 节点 10 开始
0x...   174  488b4d20      REX.W movq rcx,[rbp+0x20]  ← 加载参数a0
0x...   191  f6c101        testb rcx,0x1               ← 检查是否是Smi
0x...   194  0f85...       jnz 0x...                   ← 不是则deopt

-- 11: Int32AddWithOverflow [n9, n10] ... ← 节点 11 开始
0x...   206  03c1          addl rax,rcx                ← 实际加法操作
0x...   208  0f80...       jo 0x...                    ← 溢出则deopt
```

#### 对应关系总结

对于字节码 `Add a0, [0]` (偏移 2)：
- **Maglev IR 节点**:
  - 节点 9: `CheckedSmiUntag` - 检查并解包第一个操作数
  - 节点 10: `CheckedSmiUntag` - 检查并解包第二个操作数
  - 节点 11: `Int32AddWithOverflow` - 执行整数加法并检查溢出
- **汇编代码**:
  - 加载两个参数到寄存器
  - 检查它们是否都是 Smi（小整数）
  - 将它们右移1位（Smi解包）
  - 执行整数加法
  - 检查是否溢出
  - 如果任何检查失败，跳转到deoptimization代码

这种三层对应关系（字节码 → IR节点 → 汇编）是理解V8优化的关键。

## 完整测试脚本示例

```javascript
// test_print.js
function add(a, b) {
  return a + b;
}

// 准备优化
%PrepareFunctionForOptimization(add);

// 预热函数
for (let i = 0; i < 100; i++) {
  add(i, i + 1);
}

// 触发 Maglev 优化
%OptimizeMaglevOnNextCall(add);
add(1, 2);

// 或者触发 TurboFan 优化
// %OptimizeFunctionOnNextCall(add);
// add(1, 2);
```

运行命令：
```bash
# Maglev
out/x64.debug/d8 --allow-natives-syntax --maglev-print-bytecode --print-maglev-code test_print.js

# TurboFan
out/x64.debug/d8 --allow-natives-syntax --print-bytecode --print-opt-code test_print.js
```

## 实用技巧

### 1. 只查看特定函数

```bash
# 只打印名为 "add" 的函数
out/x64.debug/d8 --print-bytecode-filter="add" --print-opt-code-filter="add" script.js
```

### 2. 重定向到文件

```bash
# 保存输出到文件
out/x64.debug/d8 --maglev-print-bytecode --print-maglev-code script.js 2>&1 | tee output.txt
```

### 3. 组合使用多个编译器

```bash
# 同时查看 Maglev 和 TurboFan
out/x64.debug/d8 --print-bytecode \
  --maglev-print-bytecode --print-maglev-code \
  --print-opt-code \
  script.js
```

### 4. 查看更详细的信息

```bash
# 包含反馈向量信息
out/x64.debug/d8 --maglev-print-bytecode \
  --maglev-print-feedback \
  --print-maglev-code \
  --print-code-verbose \
  script.js
```

## 注意事项

1. **并发编译**: 使用 `--maglev-print-bytecode` 或 `--print-maglev-code` 时，会自动禁用并发 Maglev 编译以便跟踪。

2. **优化触发**: 函数需要被多次调用才会触发优化，或者使用 `%OptimizeMaglevOnNextCall()` / `%OptimizeFunctionOnNextCall()` 手动触发。

3. **准备优化**: 在 debug 版本中，需要先调用 `%PrepareFunctionForOptimization()` 才能手动触发优化。

4. **构建模式**:
   - `debug` 版本包含更多断言和检查
   - `optdebug` 版本适合日常开发
   - `release` 版本用于性能测试

## 相关标志定义位置

所有标志定义在: `src/flags/flag-definitions.h`

字节码相关实现:
- `src/interpreter/bytecode-array.h`
- `src/interpreter/bytecode-array.cc`

反汇编器实现:
- `src/diagnostics/disassembler.h`
- `src/diagnostics/x64/disasm-x64.cc` (x64 架构)
- `src/objects/code.cc` (Code::Disassemble 方法)

Maglev 打印实现:
- `src/maglev/maglev-compiler.cc` (第 86-98 行打印字节码，第 269-279 行打印代码)

## 查看所有可用标志

```bash
# 查看所有标志
out/x64.debug/d8 --help

# 搜索特定标志
out/x64.debug/d8 --help | grep -i "print.*code"
out/x64.debug/d8 --help | grep -i "bytecode"
```
