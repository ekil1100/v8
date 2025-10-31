# Live Range 和寄存器分配详解

## 概述

本文档详细解释编译器中的 **Live Range（生命周期）** 概念，以及 V8 Maglev 编译器如何使用它进行寄存器分配。

## 一、什么是 Live Range？

### 1. 基本定义

**Live Range（生命周期）**：一个值从被**定义**到**最后使用**之间的时间范围。

```
live range: [7-53]
            │  │
            │  └─── 最后使用的指令编号
            └────── 首次定义的指令编号
```

**含义**：
- 从**指令 7** 开始，这个值被创建/计算/定义
- 到**指令 53** 为止，这个值可能被使用
- 在这个范围内，这个值必须**保持可用**（在寄存器或栈上）
- 在指令 53 之后，这个值不再需要，可以释放资源

### 2. 什么是 "存活"（Liveness）？

在编译器中，一个值是**存活的（live）**意味着：

| 条件 | 说明 |
|-----|------|
| **已被定义** | 值已经被计算出来，存在于某个位置 |
| **将来会用** | 后续的指令还需要使用这个值 |
| **不能丢弃** | 不能覆盖或释放这个值占用的资源 |

**反义**：一个值**死亡（dead）**意味着不会再被使用，可以释放资源。

## 二、Live Range 的作用

### 1. 核心用途：寄存器分配

**问题**：x64 架构只有有限的寄存器（16 个通用寄存器），但程序可能需要几十甚至上百个变量。

**寄存器分配器需要回答**：
- 哪些值放在寄存器里？（快速访问）
- 哪些值暂时存到栈上？（寄存器不够用）
- 多个值能否**复用同一个寄存器**？

**Live Range 是回答这些问题的关键**。

### 2. 可用的物理寄存器（x64）

```
通用寄存器（16 个）：
  rax, rbx, rcx, rdx    ← 传统寄存器
  rsi, rdi              ← 源/目标索引
  rbp, rsp              ← 帧指针/栈指针（特殊用途）
  r8-r15                ← 扩展寄存器

实际可用于分配：约 10-12 个
  （rbp, rsp 通常固定用途）
```

### 3. 寄存器分配的目标

```
目标 1：最大化寄存器使用
  ✓ 寄存器访问速度快（1 个 CPU 周期）
  ✗ 栈访问较慢（需要内存访问）

目标 2：最小化寄存器溢出（spilling）
  溢出 = 将寄存器中的值临时保存到栈上

目标 3：减少数据移动（move）
  尽量让值直接产生在需要的位置
```

## 三、Live Range 示例

### 示例代码

```javascript
function processData(arr, threshold) {
  let sum = 0;      // r0
  let count = 0;    // r1

  for (let i = 0; i < arr.length; i++) {  // r2
    if (arr[i] > threshold) {
      sum += arr[i];
      count++;
    }
  }

  return sum / count;
}
```

### Maglev IR 中的 Live Range

```
7/1: InitialValue(<this>) → [stack:-6|t], live range: [7-53]
8/2: InitialValue(a0) → [stack:-7|t], live range: [8-53]
9/3: InitialValue(a1) → [stack:-8|t], live range: [9-53]
```

### 时间线可视化

```
指令编号:  7  8  9  10 ... 20 ... 40 ... 50 51 52 53
           │  │  │                              │  │  │
this       ╞══════════════════════════════════════════╡  [7-53]
arr           ╞═══════════════════════════════════════╡  [8-53]
threshold        ╞══════════════════════════════════════╡  [9-53]
sum           ╞═══════════════════════════════════════╡  [8-53]
count         ╞═══════════════════════════════════════╡  [8-53]
i                ╞═══════════════════════════════════╡  [9-53]
```

**观察**：
1. 所有参数和变量的生命周期**高度重叠**
2. 需要**多个不同的存储位置**
3. 物理寄存器不够，需要使用栈

## 四、寄存器复用

### 1. 不重叠的 Live Range（可以复用）

```
节点 A: live range: [10-20]
节点 B: live range: [25-35]
```

**时间线**：

```
指令: 10 ═════════ 20   25 ═════════ 35
      └─ A 存活 ─┘      └─ B 存活 ─┘
                   ▲
                   └─ A 和 B 不重叠！
```

**寄存器分配决策**：

```
✓ A 和 B 的生命周期不重叠
✓ 可以让 A 和 B 使用同一个寄存器 rax

实际分配：
  指令 10-20: rax 存储 A 的值
  指令 21-24: rax 空闲，可被其他值使用
  指令 25-35: rax 存储 B 的值
```

### 2. 重叠的 Live Range（不能复用）

```
节点 C: live range: [10-30]
节点 D: live range: [15-25]
```

**时间线**：

```
指令: 10 ═══════════════════════════ 30
      └────── C 存活 ──────────┘
           15 ════════ 25
           └─ D 存活 ─┘
                ▲
                └─ C 和 D 重叠了！（15-25）
```

**寄存器分配决策**：

```
✗ C 和 D 的生命周期重叠（指令 15-25）
✗ 不能使用同一个寄存器

实际分配：
  C → rax        (分配到寄存器)
  D → rbx        (分配到另一个寄存器)
  或
  D → [stack:0]  (溢出到栈上)
```

### 3. 实际示例

```
Block b1:
  13/11: LoadTaggedFieldForProperty(...) → [rcx|R|t], live range: [13-45]
  14/13: UnsafeSmiUntag [v13/n11:[rcx|R|t]] → [rcx|R|w32], live range: [14-45]
```

**分析**：

```
节点 13: [13-45]  (arr.length, tagged)
节点 14: [14-45]  (arr.length, int32)

时间线:
  13 ═══════════════════════════════ 45
  └─ 节点 13 ─┘
     14 ═══════════════════════════ 45
     └─ 节点 14 ────────────────┘

观察：
  - 节点 13 的值在指令 14 之后就不再需要了
  - 节点 14 是节点 13 的转换结果
  - 可以原地转换（in-place），都用 rcx 寄存器
```

## 五、寄存器溢出（Spilling）

### 1. 什么是溢出？

当**物理寄存器不够用**时，编译器需要将某些值临时保存到**栈上**，这叫做**寄存器溢出（spilling）**。

### 2. Maglev 输出中的溢出标记

```
13/11: LoadTaggedFieldForProperty(...) → [rcx|R|t] (spilled: [stack:0|t]), live range: [13-45]
                                                     ^^^^^^^^^^^^^^^^^^^^
                                                     溢出信息
```

**含义**：
- **主要位置**：rcx 寄存器
- **溢出位置**：栈槽位 0
- **何时溢出**：当 rcx 被其他值占用时，这个值会被移动到 `[stack:0]`
- **何时恢复**：需要使用时，从 `[stack:0]` 重新加载到寄存器

### 3. 溢出的代价

```
正常的寄存器访问（快）：
  mov rax, rcx         ; 1 个 CPU 周期

溢出到栈（慢）：
  mov [rbp-32], rcx    ; 保存到栈：需要内存访问（~10-100 周期）
  ...
  mov rcx, [rbp-32]    ; 从栈恢复：需要内存访问

结论：
  溢出会降低性能，寄存器分配器尽量减少溢出
```

### 4. 溢出决策

寄存器分配器会选择**溢出成本最低**的值：

```
优先保留在寄存器：
  - 频繁使用的值（循环内的变量）
  - 短生命周期的临时值

优先溢出到栈：
  - 不常用的值（参数、很少使用的变量）
  - 长生命周期的值（整个函数都存活）
```

## 六、Live Range 的计算

### 1. 定义点（Definition）

值第一次被创建的指令：

```javascript
let sum = 0;  // ← sum 的定义点
```

对应 Maglev IR：
```
10/10: SmiConstant(0) → [rbx|R|w32]
        ▲
        └─ 定义点：指令 10
```

### 2. 使用点（Use）

值被读取/使用的指令：

```javascript
sum += arr[i];  // ← sum 的使用点
return sum / count;  // ← sum 的另一个使用点
```

对应 Maglev IR：
```
38/49: Int32AddWithOverflow [v37/n48:[rdi|R|w32], v5/n12:[rbx|R|w32]] → [rdx|R|w32]
                                                           ▲
                                                           └─ sum 的使用点：指令 38

55/73: Int32DivideWithOverflow [v54/n72:[rdi|R|w32], v53/n71:[r9|R|w32]] → [rax|R|w32]
                                  ▲
                                  └─ sum 的使用点：指令 55
```

### 3. Live Range 的确定

```
Live Range = [第一次定义, 最后一次使用]

示例：
  定义：指令 10
  使用：指令 38, 55
  Live Range: [10-55]
```

### 4. 为什么不精确？

**保守估计**：编译器可能过度估计生命周期。

```javascript
function processData(arr, threshold) {
  let sum = 0;      // ← 定义
  let count = 0;

  for (...) {
    sum += arr[i];  // ← 最后真实使用（指令 40）
    count++;
  }

  return sum / count;  // ← 使用 sum（指令 65）
}
```

```
arr 的实际使用：
  定义：指令 8
  使用：指令 13 (arr.length), 20 (arr[i]), 36 (arr[i])
  最后使用：约指令 40

但 Live Range 可能是 [8-53]（到函数结束）

原因：
  1. 解优化需要：发生解优化时需要恢复所有参数
  2. 保守估计：精确分析成本高，保守估计更安全
  3. 控制流复杂：多个分支路径难以精确计算
```

## 七、实际案例分析

### 案例：processData 函数的寄存器分配

#### JavaScript 代码

```javascript
function processData(arr, threshold) {
  let sum = 0;
  let count = 0;

  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > threshold) {
      sum += arr[i];
      count++;
    }
  }

  return sum / count;
}
```

#### 关键值的 Live Range

| 值 | Live Range | 分配位置 | 说明 |
|----|-----------|---------|------|
| this | [7-53] | stack:-6 | 参数，长生命周期，溢出到栈 |
| arr | [8-53] | stack:-7 → rax | 参数，频繁使用，先栈后寄存器 |
| threshold | [9-53] | stack:-8 → r8 | 参数，使用时加载到寄存器 |
| sum | [10-65] | rbx/rdi | 循环中频繁使用，保持在寄存器 |
| count | [10-65] | r9 | 循环中使用，保持在寄存器 |
| i | [12-53] | rax/rbx | 循环计数器，频繁使用 |
| arr.length | [13-45] | rcx | 临时值，短生命周期 |
| arr[i] | [20-22] | rdx/rdi | 非常短的生命周期，易于分配 |

#### 寄存器使用时间线

```
指令:  7  10  13  20  38  55  65
       │   │   │   │   │   │   │
rax:   │arr│   │ i │   │   │result
rbx:   │   │sum│   │   │   │
rcx:   │   │   │len│   │   │
rdx:   │   │   │   │[i]│   │
rdi:   │   │   │   │   │sum│
r8:    │   │thr│   │   │   │
r9:    │   │cnt│   │   │   │
```

**观察**：
- **高复用**：rax 在不同阶段存储不同的值（arr → i → result）
- **专用寄存器**：sum, count 有专用寄存器（频繁使用）
- **临时分配**：arr[i] 使用后立即释放（短生命周期）

## 八、优化建议

### 1. 减少变量生命周期

**差的代码**：
```javascript
function bad(arr) {
  let temp = arr[0];  // ← temp 定义

  // 很多其他代码...
  doSomething();
  doMore();
  evenMore();

  return temp * 2;  // ← temp 最后使用（生命周期很长）
}
```

**好的代码**：
```javascript
function good(arr) {
  // 很多其他代码...
  doSomething();
  doMore();
  evenMore();

  let temp = arr[0];  // ← temp 定义
  return temp * 2;    // ← temp 立即使用（生命周期很短）
}
```

**效果**：短生命周期更容易分配寄存器，减少溢出。

### 2. 避免不必要的变量

**差的代码**：
```javascript
function bad(x, y) {
  let a = x + 1;
  let b = y + 1;
  let c = a + b;  // ← a, b, c 同时存活
  let d = c * 2;
  return d;
}
```

**好的代码**：
```javascript
function good(x, y) {
  return ((x + 1) + (y + 1)) * 2;  // ← 临时值立即使用
}
```

**效果**：减少同时存活的值，降低寄存器压力。

### 3. 理解循环的寄存器压力

**高压力**：
```javascript
function highPressure(arr) {
  let a = 0, b = 0, c = 0, d = 0, e = 0;  // ← 5 个变量

  for (let i = 0; i < arr.length; i++) {
    a += arr[i];
    b += arr[i] * 2;
    c += arr[i] * 3;
    d += arr[i] * 4;
    e += arr[i] * 5;
  }  // ← a, b, c, d, e, i, arr 都存活（7+ 个值）

  return [a, b, c, d, e];
}
```

**影响**：循环内的所有变量同时存活，可能导致溢出。

## 九、调试技巧

### 1. 查看 Live Range

```bash
out/x64.debug/d8 --allow-natives-syntax --print-maglev-graph script.js
```

查找：
```
InitialValue(a0) → [stack:-7|t], live range: [8-53]
                                  ^^^^^^^^^^^^^
```

### 2. 识别寄存器溢出

查找 `(spilled: ...)` 标记：

```
LoadTaggedFieldForProperty(...) → [rcx|R|t] (spilled: [stack:0|t])
                                              ^^^^^^^^^^^^^^^^^^^^^
                                              这个值可能被溢出
```

### 3. 分析寄存器压力

计算同时存活的值的数量：

```
指令 20:
  - arr: [8-53]       存活 ✓
  - threshold: [9-53] 存活 ✓
  - sum: [10-65]      存活 ✓
  - count: [10-65]    存活 ✓
  - i: [12-53]        存活 ✓
  - arr[i]: [20-22]   存活 ✓

同时存活：6 个值 → 需要 6 个寄存器/栈位置
```

### 4. 使用 --trace-register-allocation

```bash
out/x64.debug/d8 --trace-register-allocation script.js
```

输出寄存器分配的详细决策过程（非常冗长）。

## 十、Live Range vs 其他概念

### 对比表

| 概念 | 含义 | 层次 | 例子 |
|-----|------|-----|------|
| **Live Range** | 值的存活时间 | 编译器 IR | [7-53] |
| **Scope（作用域）** | 变量的可见范围 | JavaScript 语法 | 函数内、块内 |
| **Context（上下文）** | 闭包捕获的环境 | JavaScript 运行时 | 外层函数的变量 |
| **Lifetime（生命期）** | 对象在堆上的存活时间 | 垃圾回收 | 从创建到 GC 回收 |

### 示例：区分概念

```javascript
function outer() {
  let x = 10;  // ← x 的 Scope 是 outer 函数

  function inner() {
    return x;  // ← x 在 Context 中被捕获
  }

  return inner;
}

// 编译 outer 函数时：
// - x 的 Live Range: [定义 x, 创建 inner 闭包]
// - x 的 Scope: outer 函数体
// - x 在 inner 的 Context 中
```

## 十一、相关源代码位置

- Live Range 计算：`src/maglev/maglev-register-allocator.cc`
- 寄存器分配算法：`src/maglev/maglev-register-allocator.cc` (LinearScanAllocator)
- 溢出决策：`src/maglev/maglev-register-allocator.cc` (SpillAtDefinition)
- IR 节点生命周期：`src/maglev/maglev-graph-labeller.cc`

## 十二、总结

### 关键概念

| 概念 | 说明 |
|-----|------|
| **Live Range** | 值从定义到最后使用的时间范围 |
| **格式** | `[开始指令, 结束指令]` |
| **用途** | 寄存器分配的关键信息 |
| **存活** | 值已定义、将来会用、不能丢弃 |
| **重叠** | 两个值同时存活，不能共享寄存器 |
| **溢出** | 寄存器不够，值被保存到栈上 |

### 核心理解

1. **Live Range 是编译器概念**：与 JavaScript 的作用域、上下文不同
2. **用于寄存器分配**：决定哪些值放在寄存器，哪些溢出到栈
3. **越短越好**：短生命周期更容易获得寄存器，性能更好
4. **重叠决定复用**：不重叠的值可以共享寄存器
5. **指令编号范围**：基于 Maglev IR 图中的节点编号

### 快速参考

```
live range: [7-53]
  ↓
从指令 7（定义）到指令 53（最后使用）这个值都存活

作用：
  ✓ 寄存器分配器知道何时可以复用寄存器
  ✓ 优化器知道何时可以删除死代码
  ✓ 溢出决策基于生命周期长度

优化目标：
  ✓ 减少同时存活的值 → 降低寄存器压力
  ✓ 缩短生命周期 → 提高寄存器复用
  ✓ 减少溢出 → 提升性能
```

## 延伸阅读

- [Maglev 调试标志详细分析](./maglev_trace_flags_analysis.md)
- [栈帧布局详解](./stack_frame_layout.md)
- [ScopeInfo 深度解析](./scope_info_deep_dive.md)
- 经典教材：《编译原理》（龙书）- 第 9 章：寄存器分配
- V8 博客：[Maglev: V8's Fastest Optimizing JIT](https://v8.dev/blog/maglev)
