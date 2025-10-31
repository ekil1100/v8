# FunctionEntryStackCheck 详解

## 概述

本文档详细解释 V8 中的 **FunctionEntryStackCheck** 机制，以及解优化时的活跃变量恢复。

## 一、FunctionEntryStackCheck 是什么？

### 1. 基本定义

**FunctionEntryStackCheck** 是**栈溢出检查**（Stack Overflow Check），用于防止无限递归导致栈空间耗尽。

```
目的：防止栈溢出导致程序崩溃
位置：函数入口处（在执行函数体之前）
作用：检查当前栈空间是否充足
```

### 2. 不是检查栈帧正确性

**常见误解**：

| ❌ 错误理解 | ✓ 正确理解 |
|-----------|-----------|
| 检查栈帧结构是否正确 | 检查栈空间是否即将耗尽 |
| 验证 rbp/rsp 的值 | 比较 rsp 和栈限制地址 |
| 调试工具 | 运行时安全机制 |

### 3. 防止的问题

#### 无限递归示例

```javascript
// 危险：无限递归
function bad() {
  return bad();  // ← 每次调用都消耗栈空间
}

bad();  // ← 如果没有检查，会导致 Segmentation Fault
```

#### 有检查 vs 无检查

```
无检查（危险）:
  bad() → bad() → bad() → ... → 写入非法内存 → 程序崩溃 (Segfault)

有检查（安全）:
  bad() → bad() → ... → FunctionEntryStackCheck 失败 → 抛出 RangeError
```

## 二、工作原理

### 1. 栈的布局

```
高地址 (0xFFFFFFFF)
  ↑
  │   栈保护区（Guard Page）
  │   ══════════════════════════════  ← Stack Limit (栈限制地址)
  │
  │   可用栈空间
  │   (每次函数调用都会消耗)
  │   - 返回地址 (8 字节)
  │   - 保存的 rbp (8 字节)
  │   - 局部变量
  │   - 临时变量
  │
  ├────────────────────────────────  ← 当前 rsp (栈顶指针)
  │
  │   已使用的栈空间
  │
低地址 (0x00000000)
```

**关键概念**：
- **rsp (Stack Pointer)**：当前栈顶指针，每次函数调用都会减小
- **Stack Limit**：栈的最低允许地址，由 V8 设置
- **Guard Page**：受保护的内存页，访问会触发 SIGSEGV

### 2. 检查逻辑

#### 伪代码

```cpp
void FunctionEntryStackCheck() {
  uintptr_t current_sp = get_stack_pointer();      // 获取当前 rsp
  uintptr_t stack_limit = isolate->stack_limit();  // 获取栈限制

  if (current_sp < stack_limit) {
    // 栈空间不足！
    ThrowStackOverflowException();
  }

  // 栈空间充足，继续执行
}
```

#### 实际的 x64 汇编代码

```asm
; FunctionEntryStackCheck 的实际实现
; 位于每个函数的入口处

; 1. 从 Isolate 加载栈限制地址
mov r10, [r13 + kIsolateRootOffset]       ; r13 = Isolate 指针
mov r10, [r10 + kStackLimitOffset]        ; 获取 stack_limit

; 2. 比较当前栈顶和限制
cmp rsp, r10                              ; rsp vs stack_limit

; 3. 如果栈空间不足，跳转到运行时处理
jb .stack_overflow                        ; jump if below (rsp < stack_limit)

; 4. 栈空间充足，继续执行函数体
; ... 函数的其余代码 ...

.stack_overflow:
  ; 调用运行时函数抛出异常
  call Runtime_StackGuard
```

### 3. 栈限制的设置

```cpp
// V8 源代码：src/execution/isolate.h (简化版)
class Isolate {
 public:
  // 默认栈大小
  static constexpr size_t kDefaultStackSize = 864 * 1024;  // 864 KB

  // 栈限制地址
  uintptr_t stack_limit() const { return stack_limit_; }

  void SetStackLimit(uintptr_t limit) {
    stack_limit_ = limit;
  }

 private:
  uintptr_t stack_limit_;  // 栈的最低允许地址
};
```

**默认配置**：

| 环境 | 栈大小 | 说明 |
|-----|--------|------|
| 主线程 | 864 KB | 足够大多数应用 |
| Worker 线程 | 512 KB | 较小以节省内存 |
| 嵌入式环境 | 可配置 | 可以更小（如 256 KB） |

## 三、Maglev 中的表示

### Maglev IR 输出

```
10/7: FunctionEntryStackCheck
      ↳ lazy @-1 (4 live vars)
      │       │   │
      │       │   └── 需要恢复的活跃变量数量
      │       └────── 字节码偏移 -1（函数入口）
      └────────────── 懒解优化点（Lazy Deoptimization）
```

### 各部分含义

| 部分 | 含义 | 说明 |
|-----|------|------|
| `10/7` | 节点 ID | 当前 ID / 原始 ID |
| `FunctionEntryStackCheck` | 操作类型 | 栈溢出检查 |
| `lazy` | 解优化类型 | 懒解优化（在调用运行时函数时） |
| `@-1` | 字节码偏移 | -1 表示函数入口（特殊值） |
| `4 live vars` | 活跃变量数 | 需要恢复的变量数量 |

### 字节码偏移 -1 的含义

```
字节码偏移:
  -1  ← 函数入口（在任何字节码执行之前）
  0   ← 第一条字节码: LdaZero
  1   ← 第二条字节码: Star0
  2   ← 第三条字节码: LdaZero
  ...
```

**为什么用 -1**：
- 表示"在执行任何字节码之前"的状态
- 区分于实际的字节码指令
- 解优化时可以精确定位到函数入口

## 四、4 个活跃变量（4 live vars）

### 1. 什么是活跃变量？

**活跃变量（Live Variables）**：如果在这个点发生解优化，需要恢复到解释器的变量。

### 2. 函数入口的 4 个活跃变量

```javascript
function processData(arr, threshold) {
  // ← 函数入口点（@-1）
  // FunctionEntryStackCheck 在这里

  let sum = 0;
  // ...
}
```

#### Maglev IR 上下文

```
7/1: InitialValue(<this>) → [stack:-6|t], live range: [7-53]
8/2: InitialValue(a0) → [stack:-7|t], live range: [8-53]
9/3: InitialValue(a1) → [stack:-8|t], live range: [9-53]
10/7: FunctionEntryStackCheck
      ↳ lazy @-1 (4 live vars)
```

#### 4 个变量列表

| 编号 | 变量名 | IR 节点 | JavaScript 含义 | 说明 |
|-----|--------|---------|----------------|------|
| 1 | **this** | 7/1 | 接收者对象 | JavaScript 的 this 值 |
| 2 | **arr** | 8/2 | 第 1 个参数 | 数组参数 (a0) |
| 3 | **threshold** | 9/3 | 第 2 个参数 | 阈值参数 (a1) |
| 4 | **closure** | - | 函数闭包 | 指向当前 JSFunction 对象 |

### 3. 第 4 个变量：Closure

**Closure（闭包）**：
- 每个函数都有一个隐式的 `closure` 变量
- 指向当前执行的 **JSFunction 对象**
- 包含函数的元数据：
  - SharedFunctionInfo（共享函数信息）
  - Feedback Vector（反馈向量）
  - Context（上下文对象）
- 在解优化时需要恢复，用于重建执行环境

#### 为什么需要 Closure？

```javascript
function makeCounter() {
  let count = 0;         // ← 捕获到闭包中

  return function() {    // ← 这个函数需要访问外层的 count
    return count++;
  };
}

const counter = makeCounter();
counter();  // ← 调用时需要 closure 对象来访问 count
```

### 4. 为什么需要恢复这些变量？

#### 解优化场景

```
情况 1：栈溢出
  FunctionEntryStackCheck 失败
  → 需要解优化到解释器
  → 抛出 RangeError 异常
  → 需要恢复 this, 参数, closure

情况 2：后续解优化
  函数继续执行，某个类型检查失败
  → 需要回退到函数入口的字节码
  → 需要恢复入口时的所有状态
```

#### 解优化恢复过程

```
优化代码（Maglev）发生异常:
  1. 读取解优化描述符
     - Bytecode offset: -1
     - Live variables: 4

  2. 恢复变量
     - this → 从 [stack:-6] 读取
     - arr → 从 [stack:-7] 读取
     - threshold → 从 [stack:-8] 读取
     - closure → 从固定位置读取

  3. 切换到解释器
     - 创建解释器栈帧
     - 设置字节码偏移为 0（或 -1）
     - 继续执行或抛出异常
```

## 五、不同位置的活跃变量数量

### 对比：函数不同位置的活跃变量

| 位置 | 字节码偏移 | 活跃变量数 | 包含的变量 |
|-----|-----------|-----------|-----------|
| **函数入口** | @-1 | 4 | this, arr, threshold, closure |
| **循环开始** | @9 | 8 | 前 4 个 + sum, count, i, arr.length |
| **循环内部** | @20 | 9 | 前 8 个 + arr[i] |
| **返回前** | @65 | 5 | this, closure, sum, count, result |

### 示例：循环内的活跃变量

```
Block b2:
  12/10: CheckMaps(...)
         ↱ eager @9 (8 live vars)
```

**8 个活跃变量**：
1. this
2. arr
3. threshold
4. closure
5. sum (局部变量)
6. count (局部变量)
7. i (循环变量)
8. arr.length (临时值)

**为什么更多**：因为进入循环后，局部变量已经被定义。

## 六、实际示例：触发栈溢出

### 测试代码

```javascript
function recursiveFunction(depth) {
  if (depth % 1000 === 0) {
    console.log(`Depth: ${depth}`);
  }
  return recursiveFunction(depth + 1);
}

try {
  recursiveFunction(0);
} catch (e) {
  console.log(`\nCaught error: ${e.name}`);
  console.log(`Message: ${e.message}`);
}
```

### 运行结果

```
Depth: 0
Depth: 1000
Depth: 2000
Depth: 3000
Depth: 4000
Depth: 5000
Depth: 6000
Depth: 7000
Depth: 8000
Depth: 9000

Caught error: RangeError
Message: Maximum call stack size exceeded
```

### 分析

**执行流程**：

```
调用 1: recursiveFunction(0)
  ├─ FunctionEntryStackCheck: OK (rsp > stack_limit)
  ├─ 输出 "Depth: 0"
  ├─ 调用 2: recursiveFunction(1)
  │   ├─ FunctionEntryStackCheck: OK
  │   ├─ 调用 3: recursiveFunction(2)
  │   │   ...
  │   │   ├─ 调用 9500: recursiveFunction(9500)
  │   │   │   ├─ FunctionEntryStackCheck: FAIL (rsp <= stack_limit)
  │   │   │   ├─ 解优化: 恢复 4 个变量
  │   │   │   │   - this
  │   │   │   │   - depth (参数)
  │   │   │   │   - closure
  │   │   │   │   - (其他)
  │   │   │   └─ 抛出 RangeError
  │   │   └── 异常向上传播
  │   └── 异常向上传播
  └── 捕获异常并输出
```

**关键点**：
- 每次调用约消耗 **80-100 字节**栈空间
- 864 KB / 100 字节 ≈ **8000-9000 次调用**
- 达到栈限制时，`FunctionEntryStackCheck` 失败
- 抛出 `RangeError` 而不是程序崩溃

## 七、性能影响

### 1. 检查的开销

```
每次函数调用的开销：
  1. mov r10, [r13 + offset]    ; 2-3 CPU 周期
  2. mov r10, [r10 + offset]    ; 2-3 CPU 周期（内存访问）
  3. cmp rsp, r10               ; 1 CPU 周期
  4. jb .overflow               ; 1 CPU 周期（通常不跳转）

总计：约 6-8 个 CPU 周期
```

**相对成本**：
- 函数调用本身：约 10-20 周期
- 栈检查：约 6-8 周期
- **额外开销**：约 30-40%

### 2. 为什么不在每个操作都检查？

**只在函数入口检查**：

| 方案 | 优点 | 缺点 |
|-----|------|------|
| 每个操作都检查 | 更精确 | 开销巨大（100x） |
| 只在函数入口检查 | 开销小 | 可能浪费一些栈空间 |

**V8 的选择**：只在函数入口检查，因为：
1. 性能开销可接受
2. 函数体不会无限消耗栈（有限的局部变量）
3. 足够安全（提前检查）

### 3. 优化：内联函数

```javascript
// 被内联的函数不需要单独的栈检查
function add(a, b) {
  return a + b;  // ← 内联后没有独立的 FunctionEntryStackCheck
}

function calculate(x, y) {
  // FunctionEntryStackCheck
  return add(x, y) * 2;  // ← add 被内联，不产生调用
}
```

**好处**：
- 减少栈检查次数
- 减少函数调用开销
- 提高性能

## 八、相关源代码位置

### V8 源代码

```
栈限制管理:
  src/execution/isolate.h
  src/execution/isolate.cc
  - Isolate::stack_limit()
  - Isolate::SetStackLimit()

栈溢出处理:
  src/execution/execution.cc
  - StackGuard::HandleInterrupts()

字节码生成:
  src/interpreter/interpreter-generator.cc
  - GenerateBytecodeHandler()

Maglev 代码生成:
  src/maglev/maglev-graph-builder.cc
  - MaglevGraphBuilder::VisitFunctionEntryStackCheck()

  src/maglev/x64/maglev-assembler-x64-inl.h
  - MaglevAssembler::StackOverflowCheck()
```

### 关键数据结构

```cpp
// src/execution/isolate.h
class StackGuard {
 public:
  uintptr_t real_climit() {
    return thread_local_.real_climit_;
  }

  bool HandleInterrupts();

 private:
  uintptr_t climit_;       // C++ 栈限制
  uintptr_t jslimit_;      // JavaScript 栈限制
};
```

## 九、调试技巧

### 1. 查看栈限制

使用 GDB/LLDB：

```bash
gdb --args out/x64.debug/d8 script.js

(gdb) break v8::internal::Isolate::SetStackLimit
(gdb) run
(gdb) print this->stack_limit_
$1 = 0x7ffff7a00000
```

### 2. 修改栈大小

```cpp
// 在嵌入 V8 时可以配置
v8::Isolate::CreateParams params;
params.constraints.set_stack_limit(512 * 1024);  // 512 KB
v8::Isolate* isolate = v8::Isolate::New(params);
```

### 3. 追踪栈溢出

```bash
# 使用 d8 的调试标志
out/x64.debug/d8 --trace-stack-size script.js
```

### 4. 分析解优化

```bash
out/x64.debug/d8 --trace-deopt --allow-natives-syntax script.js
```

查找：
```
[deoptimizing (DEOPT lazy): begin ...]
  bytecode offset: -1
  live values: 4
```

## 十、常见问题

### Q1: 为什么不直接访问 Guard Page？

**A**: Guard Page 会触发 SIGSEGV，需要信号处理器介入，开销更大。提前检查可以避免信号处理。

### Q2: 递归深度限制是多少？

**A**: 取决于每次调用的栈消耗：
```
最大深度 ≈ 栈大小 / 每次调用的栈消耗
         ≈ 864 KB / 100 字节
         ≈ 8000-9000 次
```

### Q3: 能否增加栈大小？

**A**: 可以在创建 Isolate 时配置，但不推荐设置过大（内存占用）。

### Q4: Lazy Deopt 是什么？

**A**:
- **Lazy（懒）**：在调用运行时函数时才解优化
- 对比 **Eager（急切）**：立即解优化

## 十一、总结

### 关键概念

| 概念 | 说明 |
|-----|------|
| **FunctionEntryStackCheck** | 函数入口的栈溢出检查 |
| **目的** | 防止栈溢出导致程序崩溃 |
| **机制** | 比较 rsp 和 stack_limit |
| **位置** | 每个函数的入口处（@-1） |
| **失败处理** | 抛出 RangeError 异常 |
| **活跃变量** | 解优化时需要恢复的变量 |

### 4 个活跃变量

```
函数入口的 4 个活跃变量：
  1. this (接收者)
  2. 参数 1 (arr)
  3. 参数 2 (threshold)
  4. closure (函数对象)

用途：
  - 解优化时恢复状态
  - 抛出异常时保持正确的 JavaScript 语义
```

### 核心理解

1. **不是检查栈帧正确性**：是检查栈空间是否充足
2. **防止崩溃**：通过抛出异常代替 Segmentation Fault
3. **性能权衡**：只在函数入口检查，避免过大开销
4. **解优化准备**：记录活跃变量，支持回退到解释器

### 快速参考

```
FunctionEntryStackCheck
  ↳ lazy @-1 (4 live vars)

含义：
  - 函数入口的栈溢出检查
  - 懒解优化点（调用运行时函数时）
  - 字节码偏移 -1（函数入口特殊值）
  - 4 个活跃变量需要恢复（this, 参数, closure）

失败时：
  → 抛出 RangeError: Maximum call stack size exceeded
```

## 延伸阅读

- [Maglev 调试标志详细分析](./maglev_trace_flags_analysis.md)
- [Live Range 和寄存器分配](./live_range_and_register_allocation.md)
- [栈帧布局详解](./stack_frame_layout.md)
- V8 博客：[Stack Handling in V8](https://v8.dev/blog)
