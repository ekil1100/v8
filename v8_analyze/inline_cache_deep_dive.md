# Inline Cache (IC) 深度分析

## 目录

- [一、什么是 Inline Cache](#一什么是-inline-cache)
- [二、IC 状态详解](#二ic-状态详解)
- [三、IC 类型](#三ic-类型)
- [四、实际案例分析](#四实际案例分析)
- [五、IC 对优化的影响](#五ic-对优化的影响)

---

## 一、什么是 Inline Cache

**Inline Cache (IC)** 是 V8 引擎中用于**优化动态类型查找**的核心机制。

### 背景

JavaScript 是动态类型语言：
```javascript
function add(a, b) {
  return a + b;  // a 和 b 可能是任何类型
}
```

每次执行时，V8 需要：
1. 检查 `a` 和 `b` 的类型（Number？String？Object？）
2. 根据类型选择正确的加法操作（数值加法、字符串拼接、对象转换）

这种**运行时类型查找**非常昂贵。

### IC 的解决方案

IC 通过**记住之前的类型信息**来加速后续操作：

1. **首次执行**：进行完整的类型查找，并记录结果到 **FeedbackVector**
2. **后续执行**：直接使用缓存的类型信息，跳过查找
3. **优化编译**：Maglev/TurboFan 读取 FeedbackVector，生成针对特定类型的优化代码

**关键概念**：

```
JavaScript 代码
    ↓
Ignition 解释器执行
    ↓
记录类型信息到 FeedbackVector（IC 数据）
    ↓
Maglev/TurboFan 读取 IC 数据
    ↓
生成类型特化的优化代码
```

---

## 二、IC 状态详解

IC 状态表示**类型反馈的稳定性**，直接影响优化质量。

### IC 状态分类

| IC 状态 | 含义 | 看到的类型数量 | 优化程度 | 示例 |
|---------|------|---------------|----------|------|
| **UNINITIALIZED** | 未初始化 | 0 | 无法优化 | 函数从未执行 |
| **PREMONOMORPHIC** | 预单态 | 1（刚开始收集） | 部分优化 | 执行 1-2 次 |
| **MONOMORPHIC** | 单态 | 1（稳定） | **最佳优化** ✓ | 总是 Smi 或总是同一个对象 |
| **POLYMORPHIC** | 多态 | 2-4 | 中等优化 | 有时是 Smi，有时是 HeapNumber |
| **MEGAMORPHIC** | 超多态 | >4 | 最差优化 | 各种类型都有 |

### 状态转换

```
UNINITIALIZED
    ↓ 首次执行
PREMONOMORPHIC（收集类型 A）
    ↓ 多次执行，都是类型 A
MONOMORPHIC（稳定为类型 A）
    ↓ 遇到类型 B
POLYMORPHIC（类型 A + B）
    ↓ 遇到类型 C, D, E...
MEGAMORPHIC（类型太多）
```

### 代码示例

#### MONOMORPHIC（最佳情况）

```javascript
function add(a, b) {
  return a + b;
}

// 总是传入 Smi（小整数）
for (let i = 0; i < 100; i++) {
  add(1, 2);  // MONOMORPHIC: BinaryOp:SignedSmall
}
```

**FeedbackVector**：
```
- slot #0 BinaryOp BinaryOp:SignedSmall {
     [0]: 1
  }
```

**优化效果**：Maglev 生成整数加法（`Int32Add`），使用 CPU 原生指令。

#### POLYMORPHIC（中等情况）

```javascript
function add(a, b) {
  return a + b;
}

for (let i = 0; i < 100; i++) {
  add(1, 2);      // Smi + Smi
  add(1.5, 2.5);  // Double + Double
}
```

**FeedbackVector**：
```
- slot #0 BinaryOp BinaryOp:SignedSmall+Number {
     [0]: 3  // 两种类型
  }
```

**优化效果**：生成类型检查 + 分支代码（if Smi then... else if Double then...）。

#### MEGAMORPHIC（最差情况）

```javascript
function add(a, b) {
  return a + b;
}

add(1, 2);              // Smi
add(1.5, 2.5);          // Double
add("hello", "world");  // String
add({}, {});            // Object
add([], []);            // Array
```

**FeedbackVector**：
```
- slot #0 BinaryOp BinaryOp:Generic {
     [0]: 0  // 类型太多，放弃收集
  }
```

**优化效果**：回退到通用路径，每次都做完整的类型检查和分派。

---

## 三、IC 类型

V8 中有多种 IC，用于不同的操作。

### 3.1 LoadGlobal IC

用于**加载全局变量**。

#### LoadGlobalNotInsideTypeof

**场景**：直接访问全局变量（不在 `typeof` 内）

```javascript
new Error("message");  // 加载全局 Error
parseInt("123");       // 加载全局 parseInt
```

**特点**：
- 如果全局变量不存在，会抛出 `ReferenceError`
- 可以被优化为编译时常量（如果是 MONOMORPHIC）

**FeedbackVector 示例**：
```
- slot #0 LoadGlobalNotInsideTypeof MONOMORPHIC
  [weak] 0x2c5700815b3d <PropertyCell name=0x... <String[5]: #Error> value=0x... <JSFunction Error>>
  {
    [0]: [weak] 0x2c5700815b3d <PropertyCell ...>
    [1]: 0x2c5700000e6d <Symbol: (uninitialized_symbol)>
  }
```

**Maglev IR**：
```
Constant(0x2c5700815b3d <JSFunction Error>) → v-1
```

直接将 Error 函数作为编译时常量！

#### LoadGlobalInsideTypeof

**场景**：在 `typeof` 操作符内访问全局变量

```javascript
typeof undefinedVar;  // 不会抛出 ReferenceError，返回 "undefined"
```

**特点**：
- 如果全局变量不存在，返回 `"undefined"`（不抛异常）
- 语义与 `LoadGlobalNotInsideTypeof` 不同，需要特殊处理

**原因**：ECMAScript 规范要求 `typeof` 对未定义变量返回 `"undefined"`。

### 3.2 Call IC

用于**函数调用**。

**Maglev vs TurboFan 的内联策略**：

V8 有两个主要的优化编译器，内联能力不同：

| 特性 | Maglev | TurboFan |
|------|--------|----------|
| **设计目标** | 快速编译（中级优化） | 高度优化（高级优化） |
| **内联 Pass** | `MaglevInliner` | `JSInliner` + `JSIntrinsicLowering` |
| **内联策略** | 保守（字节码大小限制） | 激进（成本-收益分析） |
| **内联对象** | 小的用户定义函数 | 用户函数 + 内建函数 + API |
| **字节码限制** | `max_inlined_bytecode_size_cumulative()` | 更宽松 |
| **典型场景** | 简单的 getter/setter、小工具函数 | 复杂的库函数、parseInt、Array.map 等 |

**示例对比**：

```javascript
// 简单函数 - Maglev 可以内联
function add(a, b) {
  return a + b;
}

// 复杂内建函数 - 通常只有 TurboFan 内联
parseInt("123");
```

**为什么 Maglev 不内联 parseInt？**

1. **编译速度优先**：Maglev 追求快速编译，复杂内联会增加编译时间
2. **字节码大小限制**：parseInt 的实现较大，超过 Maglev 的内联阈值
3. **成本-收益权衡**：对于内建函数，Maglev 使用 `CallKnownJSFunction` 已经足够高效
4. **留给 TurboFan**：如果函数继续热执行，TurboFan 会接管并进行更激进的内联

**V8 编译层级**：

```
冷代码 → Ignition（解释器）
  ↓ 热度上升
温代码 → Maglev（快速优化，保守内联）
  ↓ 继续热执行
热代码 → TurboFan（深度优化，激进内联）
```

#### Call MONOMORPHIC

**场景**：调用点总是调用同一个函数

```javascript
function foo() { return 42; }

for (let i = 0; i < 100; i++) {
  foo();  // Call MONOMORPHIC
}
```

**FeedbackVector 示例**：
```
- slot #6 Call MONOMORPHIC {
     [6]: [weak] 0x2c5700814ef5 <JSFunction parseInt (sfi = 0x2c570032434d)>
     [7]: 40
  }
```

- `[6]`: 指向被调用函数的弱引用
- `[7]: 40`: 调用计数或元数据

**Maglev IR**：
```
CallKnownJSFunction(0x2c570032434d <SharedFunctionInfo parseInt>, {})
```

**优化效果**：
- `CallKnownJSFunction` 代替通用的 `Call`
- 跳过动态查找和类型检查
- 直接跳转到函数入口点
- **内联可能性**：
  * Maglev 有 `MaglevInliner` pass，主要内联小的用户定义函数
  * 对于复杂内建函数（如 parseInt），Maglev 通常不内联
  * TurboFan 的内联能力更强，可以内联更复杂的函数

#### Call POLYMORPHIC

**场景**：调用点可能调用多个不同的函数

```javascript
function add1(x) { return x + 1; }
function add2(x) { return x + 2; }

for (let i = 0; i < 100; i++) {
  let fn = i % 2 === 0 ? add1 : add2;
  fn(i);  // Call POLYMORPHIC（add1 或 add2）
}
```

**优化效果**：
- 生成类型检查 + 分支调用
- 比 MONOMORPHIC 慢，但比 MEGAMORPHIC 快

### 3.3 BinaryOp IC

用于**二元操作**（+、-、*、/ 等）。

**状态示例**：

| 状态 | 含义 | FeedbackVector |
|------|------|----------------|
| `BinaryOp:None` | 未收集到类型信息 | `[0]: 0` |
| `BinaryOp:SignedSmall` | 总是 Smi + Smi | `[0]: 1` |
| `BinaryOp:Number` | Number 类型（Smi 或 Double） | `[0]: 2` |
| `BinaryOp:String` | 字符串拼接 | `[0]: 3` |

**案例**：用例 3（safeDivide）中的除法操作

- **10 次预热（失败）**：`BinaryOp:None`，无法优化 → Deopt
- **100 次预热（成功）**：`BinaryOp:SignedSmall`，生成整数除法 → `Int32DivideWithOverflow`

### 3.4 CompareOp IC

用于**比较操作**（>、<、===、!== 等）。

```javascript
function classify(num) {
  if (num > 10) {  // CompareOp IC
    return "large";
  } else {
    return "small";
  }
}
```

**FeedbackVector 示例**：
```
- slot #0 CompareOp CompareOp:SignedSmall {
     [0]: 1
  }
```

**Maglev IR**：
```
CheckedSmiUntag [v9/n2:[rax|R|t]] → [rax|R|w32]
BranchIfInt32Compare(GreaterThan) [v12/n9:[rax|R|w32], v7/n10:[rcx|R|w32]] b2 b3
```

生成整数比较，使用 CPU 原生指令。

---

## 四、实际案例分析

### 案例 1：用例 3（safeDivide）- IC 状态的影响

#### 代码

```javascript
function safeDivide(a, b) {
  try {
    return a / b;
  } catch (e) {
    return 0;
  }
}
```

#### 10 次预热（优化失败）

**FeedbackVector**：
```
- slot #0 BinaryOp BinaryOp:None {
     [0]: 0
  }
```

- **IC 状态**：`BinaryOp:None`（未收集到类型信息）
- **Maglev IR**：`Deopt(Insufficient type feedback for binary operation)`
- **结果**：反优化，回退到 Ignition

#### 100 次预热（优化成功）

**FeedbackVector**：
```
- slot #0 BinaryOp BinaryOp:SignedSmall {
     [0]: 1
  }
- invocation count: 81
```

- **IC 状态**：`BinaryOp:SignedSmall`（知道是 Smi 除法）
- **Maglev IR**：
  ```
  CheckedSmiUntag [v5/n2:[rax|R|t]] → [rax|R|w32]
  CheckedSmiUntag [v6/n3:[rcx|R|t]] → [rcx|R|w32]
  Int32DivideWithOverflow [v9/n9:[rbx|R|w32], v10/n10:[rcx|R|w32]] → [rax|R|w32]
  ```
- **结果**：成功优化，使用 CPU 原生整数除法（`idiv`）

**关键洞察**：IC 状态从 `None` → `SignedSmall` 是优化的关键！

---

### 案例 2：用例 4（parseNumber）- MONOMORPHIC 的威力

#### 代码

```javascript
function parseNumber(str) {
  try {
    if (typeof str !== "string") {
      throw new Error("Not a string");
    }
    return parseInt(str);
  } catch (e) {
    return -1;
  }
}
```

#### FeedbackVector

**LoadGlobal IC（Error）**：
```
- slot #0 LoadGlobalNotInsideTypeof MONOMORPHIC
  [weak] 0x2c57008266a5 <PropertyCell name=0x... <String[5]: #Error> value=0x... <JSFunction Error>>
  {
    [0]: [weak] 0x2c57008266a5 <PropertyCell ...>
    [1]: 0x2c5700000e6d <Symbol: (uninitialized_symbol)>
  }
```

**LoadGlobal IC（parseInt）**：
```
- slot #4 LoadGlobalNotInsideTypeof MONOMORPHIC
  [weak] 0x2c57008265dd <PropertyCell name=0x... <String[8]: #parseInt> value=0x... <JSFunction parseInt>>
  {
    [4]: [weak] 0x2c57008265dd <PropertyCell ...>
    [5]: 0x2c5700000e6d <Symbol: (uninitialized_symbol)>
  }
```

**Call IC（Error 构造函数）**：
```
- slot #2 Call MONOMORPHIC {
     [2]: [weak] 0x2c5700815b3d <JSFunction Error (sfi = 0x2c570032668d)>
     [3]: 40
  }
```

**Call IC（parseInt）**：
```
- slot #6 Call MONOMORPHIC {
     [6]: [weak] 0x2c5700814ef5 <JSFunction parseInt (sfi = 0x2c570032434d)>
     [7]: 40
  }
```

#### Maglev IR（优化结果）

**Error 加载**：
```
Constant(0x2c5700815b3d <JSFunction Error>) → v-1
```

**parseInt 加载**：
```
Constant(0x2c5700814ef5 <JSFunction parseInt>) → v-1
```

**parseInt 调用**：
```
CallKnownJSFunction(0x2c570032434d <SharedFunctionInfo parseInt>, {})
```

**优化效果**：
1. **LoadGlobal MONOMORPHIC**：Error 和 parseInt 直接作为编译时常量
2. **Call MONOMORPHIC**：使用 `CallKnownJSFunction`，跳过动态查找
3. **无运行时查找**：全局变量查找在编译时完成

---

## 五、IC 对优化的影响

### 5.1 优化决策

Maglev/TurboFan 根据 IC 状态决定是否优化：

| IC 状态 | 优化决策 |
|---------|----------|
| UNINITIALIZED | 无法优化，等待更多反馈 |
| PREMONOMORPHIC | 部分优化，保守策略 |
| **MONOMORPHIC** | **激进优化，生成特化代码** |
| POLYMORPHIC | 中等优化，生成多路分支 |
| MEGAMORPHIC | 放弃优化，使用通用代码 |

### 5.2 代码特化

#### MONOMORPHIC 优化示例

**JavaScript**：
```javascript
function add(a, b) {
  return a + b;
}
```

**MONOMORPHIC (SignedSmall)**：
```
CheckedSmiUntag [a] → [rax|w32]
CheckedSmiUntag [b] → [rcx|w32]
Int32AddWithOverflow [rax], [rcx] → [rdx|w32]
Int32ToNumber [rdx] → [rax|t]
```

生成的机器码：
```asm
; CheckedSmiUntag a
mov rax, [stack+a]
test rax, 1           ; 检查是否为 Smi
jz deopt              ; 不是 Smi，反优化
sar rax, 1            ; 解标记（右移 1 位）

; CheckedSmiUntag b
mov rcx, [stack+b]
test rcx, 1
jz deopt
sar rcx, 1

; Int32AddWithOverflow
mov rdx, rax
add rdx, rcx
jo deopt              ; 溢出检查

; Int32ToNumber（重新标记为 Smi）
lea rax, [rdx*2+1]
```

**高效！使用 CPU 原生整数指令。**

#### POLYMORPHIC 优化示例

**JavaScript**：
```javascript
function add(a, b) {
  return a + b;
}
// 有时是 Smi，有时是 Double
```

**POLYMORPHIC (SignedSmall + Number)**：
```
CheckSmiOrNumber [a]
if Smi:
  CheckedSmiUntag [a] → [rax|w32]
  CheckedSmiUntag [b] → [rcx|w32]
  Int32AddWithOverflow [rax], [rcx] → [rdx|w32]
else:
  Float64Load [a] → [xmm0]
  Float64Load [b] → [xmm1]
  Float64Add [xmm0], [xmm1] → [xmm2]
```

**需要分支！比 MONOMORPHIC 慢，但比通用代码快。**

### 5.3 反优化（Deoptimization）

当运行时类型与 IC 假设不符时，触发**反优化**：

**示例**：
```javascript
function add(a, b) {
  return a + b;
}

// 预热阶段：总是 Smi
for (let i = 0; i < 100; i++) {
  add(1, 2);  // MONOMORPHIC: SignedSmall
}

// Maglev 编译，假设总是 Smi

// 运行时：传入 String！
add("hello", "world");  // ← 触发反优化
```

**反优化过程**：
1. `CheckedSmiUntag` 检测到 `"hello"` 不是 Smi
2. 触发 `Deopt(eager @offset)`
3. 保存当前状态（live vars）
4. 回退到 Ignition 解释器
5. 更新 FeedbackVector（SignedSmall → Polymorphic）
6. 下次可能重新编译（使用 POLYMORPHIC 策略）

### 5.4 最佳实践

#### 保持类型一致

**好**：
```javascript
function add(a, b) {
  return a + b;
}

// 总是传入相同类型
for (let i = 0; i < 10000; i++) {
  add(1, 2);  // MONOMORPHIC
}
```

**差**：
```javascript
function add(a, b) {
  return a + b;
}

// 类型混乱
add(1, 2);              // Smi
add(1.5, 2.5);          // Double
add("a", "b");          // String
add({}, {});            // Object
// → MEGAMORPHIC，无法优化
```

#### 预热充分

**好**：
```javascript
function divide(a, b) {
  return a / b;
}

// 充分预热（100+ 次）
for (let i = 0; i < 100; i++) {
  divide(10, 2);
}
// → MONOMORPHIC，成功优化
```

**差**：
```javascript
function divide(a, b) {
  return a / b;
}

// 预热不足（<10 次）
for (let i = 0; i < 5; i++) {
  divide(10, 2);
}
// → BinaryOp:None，无法优化
```

#### 避免运行时类型变化

**好**：
```javascript
function process(obj) {
  return obj.value;  // obj 总是 {value: number} 形状
}

// 所有对象结构相同
for (let i = 0; i < 100; i++) {
  process({value: i});  // MONOMORPHIC
}
```

**差**：
```javascript
function process(obj) {
  return obj.value;
}

// 对象结构不同
process({value: 1});
process({value: 2, extra: "x"});
process({other: 3, value: 4});
// → POLYMORPHIC 或 MEGAMORPHIC
```

---

## 六、调试 IC 状态

### 使用 `--trace-ic` 标志

```bash
out/x64.debug/d8 --trace-ic script.js
```

输出示例：
```
[LoadIC in ~process+52 at script.js:3 (0->.) map=0x... 0x...]
[LoadIC in ~process+52 at script.js:3 (.->1) map=0x... 0x...]
[LoadIC in ~process+52 at script.js:3 (1->1) map=0x... 0x...]
```

- `(0->.)`: UNINITIALIZED → PREMONOMORPHIC
- `(.->1)`: PREMONOMORPHIC → MONOMORPHIC
- `(1->1)`: 保持 MONOMORPHIC

### 查看 FeedbackVector

```bash
out/x64.debug/d8 --allow-natives-syntax --print-bytecode script.js
```

查看输出中的 FeedbackVector 部分：
```
- slot #0 LoadGlobalNotInsideTypeof MONOMORPHIC
- slot #1 Call MONOMORPHIC
- slot #2 BinaryOp BinaryOp:SignedSmall
```

---

## 七、总结

### IC 的核心价值

1. **性能关键**：动态语言的优化基础
2. **类型反馈**：记录运行时类型信息
3. **指导优化**：Maglev/TurboFan 依赖 IC 生成特化代码
4. **动态适应**：根据实际执行调整策略

### IC 状态重要性

| 状态 | 性能 | 推荐做法 |
|------|------|----------|
| MONOMORPHIC | ⭐⭐⭐⭐⭐ | 保持类型一致 |
| POLYMORPHIC | ⭐⭐⭐ | 限制类型数量（<4） |
| MEGAMORPHIC | ⭐ | 重构代码，减少类型变化 |

### 关键要点

1. **MONOMORPHIC 是目标**：最佳优化，激进特化
2. **类型一致性**：保持相同类型，避免类型混乱
3. **充分预热**：至少 100 次调用以收集稳定反馈
4. **反优化代价**：类型变化导致性能下降
5. **FeedbackVector 是宝藏**：存储所有优化决策的依据

### 相关文档

- [maglev_debugging_guide.md](./maglev_debugging_guide.md) - Maglev 调试完整指南
- [phi_node_deep_dive.md](./phi_node_deep_dive.md) - Phi 节点详解
- [interrupt_budget_deep_dive.md](./interrupt_budget_deep_dive.md) - 中断预算机制
- [smi_operations_deep_dive.md](./smi_operations_deep_dive.md) - Smi 操作详解

---

**参考资料**：
- V8 Blog: [Inline Caches](https://mathiasbynens.be/notes/shapes-ics)
- V8 Docs: [Understanding V8's Bytecode](https://medium.com/dailyjs/understanding-v8s-bytecode-317d46c94775)
- Source: `src/ic/` (V8 源码中的 IC 实现)
