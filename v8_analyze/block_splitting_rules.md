# Maglev IR Block 分割规则详解

## 一、什么是 Block

**Block（基本块）** 是 Maglev IR 中的基本控制流单元：

```
Block = 一段顺序执行的 IR 节点序列
      + 没有内部跳转（除了最后一条）
      + 只有一个入口（开头）
      + 只有一个出口（结尾）
```

**关键特性**：

| 特性         | 说明                                      |
| ------------ | ----------------------------------------- |
| **顺序执行** | Block 内的指令从上到下依次执行，无分支    |
| **单入口**   | 只能从 Block 开头进入                     |
| **单出口**   | 只能从 Block 结尾离开（跳转、返回、分支） |
| **原子性**   | 要么全部执行，要么不执行（用于优化）      |

---

## 二、Block 分割的触发条件

### 规则 1：函数入口

**每个函数都有一个入口 Block（通常是 Block b0）**

**示例**：

```javascript
function foo(x) {
  return x + 1; // 简单函数，只有一个 Block
}
```

**Block 结构**：

```
Block b0 (函数入口)
  InitialValue(<this>)
  InitialValue(x)
  FunctionEntryStackCheck
  Int32AddWithOverflow [x, 1]
  Return
```

**分割点**：

- ✅ **函数开始** → 创建 Block b0

---

### 规则 2：条件分支（if-else）

**当遇到条件跳转指令时，分割成 3 个 Block**

**字节码**：

```
JumpIfTrue [offset]    ← 条件为真跳转
JumpIfFalse [offset]   ← 条件为假跳转
```

**示例**：

```javascript
function classify(x) {
  if (x > 10) {
    return "large";
  } else {
    return "small";
  }
}
```

**Block 分割**：

```
Block b0: 函数入口
  ├─→ 跳转到 Block b1

Block b1: 条件判断
  ├─→ 如果 x > 10，跳转到 Block b2（true 分支）
  └─→ 否则跳转到 Block b3（false 分支）

Block b2: true 分支
  └─→ Return "large"

Block b3: false 分支
  └─→ Return "small"
```

**分割点**：

- ✅ **条件判断指令** → 创建两个后续 Block（true/false 分支）
- ✅ **每个分支的开始** → 创建新的 Block

---

### 规则 3：循环（for/while）

**循环会创建多个 Block，包含循环头、循环体、退出 Block**

**字节码**：

```
JumpLoop [offset]      ← 跳回循环头
JumpIfFalse [offset]   ← 条件为假退出循环
```

**示例**：

```javascript
function sumArray(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}
```

**Block 分割**：

```
Block b0: 函数入口
  └─→ 跳转到 Block b1

Block b1: 循环准备
  ├─→ sum = 0, i = 0
  └─→ 跳转到 Block b2（循环头）

Block b2: 循环头 ⭐
  ├─→ φ 节点：合并 sum 和 i 的值
  ├─→ 检查条件：i < arr.length
  ├─→ 如果为真，跳转到 Block b3（循环体）
  └─→ 如果为假，跳转到 Block b4（退出循环）

Block b3: 循环体
  ├─→ sum += arr[i]
  ├─→ i++
  └─→ 跳回 Block b2（循环头）

Block b4: 退出循环
  └─→ Return sum
```

**分割点**：

- ✅ **循环头** → 创建 Block（包含 phi 节点和循环条件）
- ✅ **循环体** → 创建 Block
- ✅ **退出循环** → 创建 Block
- ✅ **JumpLoop 的目标** → 循环头 Block

---

### 规则 4：异常处理（try-catch）

**异常处理会创建异常处理器 Block**

**字节码**：

```
Handler Table
   from   to       hdlr
  (   5,  17)  ->    19    ← [5, 17) 抛异常跳转到 19
```

**示例**：

```javascript
function safeDivide(a, b) {
  try {
    return a / b;
  } catch (e) {
    return 0;
  }
}
```

**Block 分割**：

```
Block b0: 函数入口
  └─→ 跳转到 Block b1

Block b1: try 块
  ├─→ 计算 a / b
  ├─→ 如果成功，Return
  └─→ 如果抛异常，跳转到 Block b2（异常处理器）

Block b2 (exception handler): catch 块 ⭐
  ├─→ SetPendingMessage（清除异常状态）
  └─→ Return 0
```

**分割点**：

- ✅ **try 块开始** → 创建 Block
- ✅ **catch 块开始（hdlr 偏移）** → 创建异常处理器 Block
- ✅ **finally 块** → 创建额外的 Block

---

### 规则 5：无条件跳转（Jump）

**当遇到 Jump 指令时，跳转目标开始一个新的 Block**

**字节码**：

```
Jump [offset]    ← 无条件跳转到 offset
```

**示例**：

```javascript
function example(x) {
  let y = x + 1; // Block b0
  // 跳转
  return y; // Block b1（跳转目标）
}
```

**Block 分割**：

```
Block b0
  ├─→ y = x + 1
  └─→ Jump → Block b1

Block b1
  └─→ Return y
```

**分割点**：

- ✅ **Jump 指令之后** → 当前 Block 结束
- ✅ **Jump 的目标偏移** → 新 Block 开始

---

### 规则 6：函数返回（Return）

**Return 指令总是 Block 的最后一条指令**

**字节码**：

```
Return           ← 返回累加器中的值
```

**示例**：

```javascript
function add(a, b) {
  return a + b;
}
```

**Block 结构**：

```
Block b0
  ├─→ a + b
  └─→ Return        ← Block 结束
```

**分割点**：

- ✅ **Return 指令** → 当前 Block 结束
- ❌ **Return 之后** → 没有新的 Block（函数已结束）

---

## 三、Block 分割的完整算法

### 字节码 → Block 的转换流程

```
1. 扫描字节码
   ↓
2. 识别跳转目标
   - 记录所有 JumpIfTrue/JumpIfFalse 的目标偏移
   - 记录所有 Jump 的目标偏移
   - 记录所有 JumpLoop 的目标偏移
   - 记录所有 Handler Table 中的 hdlr 偏移
   ↓
3. 在跳转目标位置创建 Block 边界
   - 每个跳转目标开始一个新 Block
   - 每个跳转指令结束当前 Block
   ↓
4. 构建 Block 内容
   - 从 Block 开始位置顺序处理字节码
   - 遇到跳转指令时结束当前 Block
   ↓
5. 建立 Block 之间的控制流边
   - 条件分支：连接到 true/false 两个 Block
   - 无条件跳转：连接到目标 Block
   - 循环：连接回循环头 Block
```

---

## 四、典型 Block 模式

### 模式 1：线性流（无分支）

```javascript
function linear(x) {
  let y = x + 1;
  let z = y * 2;
  return z;
}
```

**Block 结构**：

```
Block b0
  InitialValue(x)
  y = x + 1
  z = y * 2
  Return z
```

**特点**：

- ✅ 只有 **1 个 Block**
- ✅ 顺序执行，无跳转

---

### 模式 2：二分支（if-else）

```javascript
function branch(x) {
  if (x > 0) {
    return 1;
  } else {
    return -1;
  }
}
```

**Block 结构**：

```
Block b0: 函数入口
  └─→ b1

Block b1: 条件判断
  ├─→ b2 (x > 0)
  └─→ b3 (x <= 0)

Block b2: true 分支
  Return 1

Block b3: false 分支
  Return -1
```

**特点**：

- ✅ **4 个 Block**（入口 + 判断 + 两个分支）
- ✅ 控制流在 b1 分裂成两条路径

---

### 模式 3：循环（for）

```javascript
function loop(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += i;
  }
  return sum;
}
```

**Block 结构**：

```
Block b0: 函数入口
  └─→ b1

Block b1: 循环准备
  sum = 0, i = 0
  └─→ b2

Block b2: 循环头 ⭐
  φ(sum), φ(i)
  ├─→ b3 (i < n)
  └─→ b4 (i >= n)

Block b3: 循环体
  sum += i
  i++
  └─→ b2 (跳回循环头)

Block b4: 退出循环
  Return sum
```

**特点**：

- ✅ **5 个 Block**
- ✅ **b2 → b3 → b2** 形成循环
- ✅ b2 是循环头，包含 **phi 节点**

---

### 模式 4：嵌套分支

```javascript
function nested(x, y) {
  if (x > 0) {
    if (y > 0) {
      return 1;
    } else {
      return 2;
    }
  } else {
    return 3;
  }
}
```

**Block 结构**：

```
Block b0: 函数入口
  └─→ b1

Block b1: 第一层判断 (x > 0)
  ├─→ b2 (x > 0)
  └─→ b5 (x <= 0)

Block b2: 第二层判断 (y > 0)
  ├─→ b3 (y > 0)
  └─→ b4 (y <= 0)

Block b3: return 1
Block b4: return 2
Block b5: return 3
```

**特点**：

- ✅ **6 个 Block**
- ✅ 树状结构（b1 → {b2, b5}，b2 → {b3, b4}）

---

### 模式 5：异常处理（try-catch）

```javascript
function tryCatch(x) {
  try {
    return riskyOperation(x);
  } catch (e) {
    return -1;
  }
}
```

**Block 结构**（优化失败，显式异常处理）：

```
Block b0: 函数入口
  └─→ b1

Block b1: try 块
  CallKnownJSFunction(riskyOperation)
  ├─→ 如果成功，Return
  └─→ 如果抛异常，跳转到 b2 ⭐

Block b2 (exception handler): catch 块
  SetPendingMessage
  Return -1
```

**特点**：

- ✅ **3 个 Block**
- ✅ b2 标记为 `(exception handler)`
- ✅ 异常路径：b1 → b2

---

## 五、Block 分割的实际示例

### 示例：用例 1（循环）

**JavaScript 代码**：

```javascript
function simpleLoop(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}
```

**字节码**（关键部分）：

```
  0 : LdaZero                  ← Block b0 开始
  1 : Star0
  2 : LdaZero
  3 : Star1
  4 : TestLessThan r1, [2]     ← Block b2 开始（循环头）
  7 : JumpIfFalse [23]         ← 条件跳转，分割点
  9 : Ldar r1                  ← Block b3 开始（循环体）
 14 : GetKeyedProperty r0, [3]
 17 : Add r0, [0]
 20 : Star0
 21 : Inc [1]
 22 : Star1
 23 : JumpLoop [19]            ← 跳回 Block b2，分割点
 25 : Ldar r0                  ← Block b4 开始（退出循环）
 26 : Return
```

**Block 分割分析**：

| 字节码偏移 | 指令         | Block 边界  | 原因                       |
| ---------- | ------------ | ----------- | -------------------------- |
| 0          | LdaZero      | **b0 开始** | 函数入口                   |
| 3          | Star1        | **b1 开始** | 跳转目标（循环准备）       |
| 4          | TestLessThan | **b2 开始** | JumpLoop 的目标（循环头）  |
| 7          | JumpIfFalse  | **b2 结束** | 条件分支，分割成 b3/b4     |
| 9          | Ldar r1      | **b3 开始** | 循环体                     |
| 23         | JumpLoop     | **b3 结束** | 跳回 b2                    |
| 25         | Ldar r0      | **b4 开始** | JumpIfFalse 的目标（退出） |
| 26         | Return       | **b4 结束** | 函数返回                   |

**最终 Block 结构**：

```
Block b0 → Block b1 → Block b2 ⇄ Block b3
                         ↓
                      Block b4
```

---

### 示例：用例 2（if-else）

**JavaScript 代码**：

```javascript
function classify(x) {
  if (x > 10) {
    return "large";
  } else {
    return "small";
  }
}
```

**字节码**：

```
  0 : Ldar a0                  ← Block b0 开始
  1 : Star0
  2 : LdaSmi [10]              ← Block b1 开始（条件判断）
  3 : TestGreaterThan r0, [0]
  6 : JumpIfFalse [7]          ← 分割点
  8 : LoadConstant [0]         ← Block b2 开始（true 分支）
  9 : Return
 10 : LoadConstant [1]         ← Block b3 开始（false 分支）
 11 : Return
```

**Block 分割分析**：

| 字节码偏移 | 指令         | Block 边界  | 原因                             |
| ---------- | ------------ | ----------- | -------------------------------- |
| 0          | Ldar a0      | **b0 开始** | 函数入口                         |
| 2          | LdaSmi       | **b1 开始** | 跳转目标（条件判断）             |
| 6          | JumpIfFalse  | **b1 结束** | 条件分支，分割成 b2/b3           |
| 8          | LoadConstant | **b2 开始** | true 分支                        |
| 9          | Return       | **b2 结束** | 返回                             |
| 10         | LoadConstant | **b3 开始** | JumpIfFalse 的目标（false 分支） |
| 11         | Return       | **b3 结束** | 返回                             |

**最终 Block 结构**：

```
Block b0 → Block b1 ─┬→ Block b2 (return "large")
                      │
                      └→ Block b3 (return "small")
```

---

## 六、Block 分割的高级情况

### 情况 1：循环 + 条件

```javascript
function complexLoop(arr) {
  let result = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 0) {
      result += arr[i];
    }
  }
  return result;
}
```

**Block 结构**：

```
Block b0: 函数入口
  └─→ b1

Block b1: 循环准备
  └─→ b2

Block b2: 循环头
  ├─→ b3 (i < arr.length)
  └─→ b6 (i >= arr.length, 退出)

Block b3: 循环体 - 条件判断
  ├─→ b4 (arr[i] > 0)
  └─→ b5 (arr[i] <= 0)

Block b4: result += arr[i]
  └─→ b5

Block b5: i++
  └─→ b2 (跳回循环头)

Block b6: 退出循环
  Return result
```

**特点**：

- ✅ **7 个 Block**
- ✅ 循环内嵌套条件分支
- ✅ 控制流更复杂

---

### 情况 2：提前返回（Early Return）

```javascript
function earlyReturn(x) {
  if (x < 0) {
    return -1; // 提前返回
  }
  let y = x * 2;
  return y;
}
```

**Block 结构**：

```
Block b0: 函数入口
  └─→ b1

Block b1: 条件判断
  ├─→ b2 (x < 0)
  └─→ b3 (x >= 0)

Block b2: 提前返回
  Return -1    ← Block 结束，不继续

Block b3: 正常流程
  y = x * 2
  Return y
```

**特点**：

- ✅ b2 提前返回，不连接到后续 Block
- ✅ 两条路径独立（b1 → b2 vs b1 → b3）

---

### 情况 3：多重异常处理

```javascript
function multiTryCatch(a, b, c) {
  let result = 0;
  try {
    result += a / b;
  } catch (e1) {
    result = -1;
  }
  try {
    result += parseInt(c);
  } catch (e2) {
    result = -2;
  }
  return result;
}
```

**Block 结构**：

```
Block b0: 函数入口
  └─→ b1

Block b1: 第一个 try 块
  ├─→ 如果成功，继续到 b2
  └─→ 如果抛异常，跳转到 b3

Block b3 (exception handler): 第一个 catch 块
  └─→ b2

Block b2: 第二个 try 块
  ├─→ 如果成功，继续到 b5
  └─→ 如果抛异常，跳转到 b4

Block b4 (exception handler): 第二个 catch 块
  └─→ b5

Block b5: 返回 result
  Return result
```

**特点**：

- ✅ **6 个 Block**
- ✅ 两个独立的异常处理路径
- ✅ b3 和 b4 都标记为 `exception handler`

---

## 七、关键要点总结

### Block 分割的核心规则

1. **函数入口**：总是创建 Block b0
2. **条件分支**：分割成多个 Block（true/false 路径）
3. **循环**：循环头、循环体、退出各是独立 Block
4. **异常处理**：catch/finally 块是独立 Block
5. **跳转目标**：任何跳转的目标位置开始新 Block
6. **返回指令**：总是 Block 的最后一条指令

### Block 的控制流边

| 指令类型       | 后续 Block 数量 | 控制流                      |
| -------------- | --------------- | --------------------------- |
| **顺序指令**   | 1               | 继续到下一条                |
| **条件跳转**   | 2               | true 分支 + false 分支      |
| **无条件跳转** | 1               | 跳转到目标 Block            |
| **JumpLoop**   | 1               | 跳回循环头 Block            |
| **Return**     | 0               | 函数结束                    |
| **异常**       | 2               | 正常路径 + 异常处理器 Block |

### 如何识别 Block 边界

**在字节码中识别**：

```bash
# 查找跳转指令（Block 结束）
JumpIfTrue, JumpIfFalse, Jump, JumpLoop, Return

# 查找跳转目标（Block 开始）
计算跳转指令的目标偏移量
查看 Handler Table 的 hdlr 字段
```

**在 Maglev IR 中识别**：

```bash
# Block 声明
Block b0
Block b1 (effects:)
Block b2 (exception handler)

# Block 结束的指令
Return
Jump b3
BranchIfInt32Compare(...) b2 b3
```

### 为什么要分割 Block？

1. **控制流分析**：清晰地表示程序的执行路径
2. **优化边界**：每个 Block 可以独立优化
3. **phi 节点放置**：循环头 Block 需要 phi 节点合并值
4. **活跃性分析**：确定变量的生命周期
5. **寄存器分配**：基于 Block 边界进行寄存器分配

---

## 八、调试技巧

### 查看 Block 分割

```bash
# 查看字节码（识别跳转指令）
out/x64.debug/d8 --allow-natives-syntax --print-bytecode script.js

# 查看 Maglev IR（查看 Block 结构）
out/x64.debug/d8 --allow-natives-syntax --print-maglev-graph script.js

# 查看 Block 构建过程
out/x64.debug/d8 --allow-natives-syntax --trace-maglev-graph-building script.js
```

### 分析 Block 边界

1. **找到所有跳转指令**：JumpIfTrue/False, Jump, JumpLoop
2. **计算跳转目标**：跳转指令 + 偏移量 = 目标 Block 开始
3. **标记 Handler Table**：hdlr 偏移 = 异常处理 Block 开始
4. **绘制控制流图**：Block 之间的跳转关系

### 示例：手动分割 Block

**给定字节码**：

```
  0 : Ldar a0
  1 : TestGreaterThan [10]
  4 : JumpIfFalse [7]          ← 偏移 4 + 7 = 11
  6 : LdaSmi [1]
  7 : Return
  8 : LdaSmi [2]
  9 : Return
```

**分割步骤**：

1. **识别跳转指令**：

   - 偏移 4: `JumpIfFalse [7]` → 目标偏移 = 4 + 7 = 11（但没有偏移 11，实际是偏移 8）
   - 偏移 7: `Return`
   - 偏移 9: `Return`

2. **标记 Block 边界**：

   - Block b0: [0-1]（函数入口）
   - Block b1: [1-4]（条件判断）
   - Block b2: [6-7]（true 分支）
   - Block b3: [8-9]（false 分支）

3. **绘制控制流**：
   ```
   b0 → b1 ─┬→ b2 (Return 1)
            │
            └→ b3 (Return 2)
   ```

---

## 九、相关文档

- [maglev_debugging_guide.md](./maglev_debugging_guide.md) - Maglev 调试完整指南
- [phi_node_deep_dive.md](./phi_node_deep_dive.md) - Phi 节点详解（循环头 Block）
- [exception_handler_mapping.md](./exception_handler_mapping.md) - 异常处理 Block 映射

---

## 十、参考资料

**V8 源码**：

- `src/maglev/maglev-graph-builder.cc` - Block 构建逻辑
- `src/maglev/maglev-graph.h` - Block 定义
- `src/compiler/bytecode-analysis.h` - 字节码分析（识别跳转目标）
- `src/interpreter/bytecodes.h` - 字节码定义
