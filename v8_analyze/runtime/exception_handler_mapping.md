# Handler Table 与 Maglev IR Block 的对应关系

## 一、Handler Table 结构

Handler Table 在 **BytecodeArray** 中定义异常处理范围：

```
Handler Table (size = 32)
   from   to       hdlr (prediction,   data)
  (   5,  17)  ->    19 (prediction=1, data=1)
  (  38,  53)  ->    55 (prediction=1, data=1)
```

**字段含义**：

| 字段 | 含义 | 示例值 |
|------|------|--------|
| **from** | try 块开始的字节码偏移量 | 5 |
| **to** | try 块结束的字节码偏移量（不包含） | 17 |
| **hdlr** | catch 块开始的字节码偏移量 | 19 |
| **prediction** | 异常预测（1=可能抛异常） | 1 |
| **data** | 额外数据（catch 变量索引等） | 1 |

**语义**：
- **范围 [from, to)**：这段字节码如果抛异常，会跳转到 `hdlr`
- **hdlr**：异常处理器的入口点（catch 块开始）

---

## 二、多个 try-catch 的对应关系

### 示例代码

```javascript
function multiTryCatch(a, b, c) {
  let result = 0;

  // 第一个 try-catch
  try {
    result += a / b;  // 字节码偏移 5-17
  } catch (e1) {      // 字节码偏移 19
    result = -1;
  }

  // 第二个 try-catch
  try {
    result += parseInt(c);  // 字节码偏移 38-53
  } catch (e2) {            // 字节码偏移 55
    result = -2;
  }

  return result;
}
```

### BytecodeArray 映射

**第一个 try-catch**：

```
字节码偏移 5-16（try 块）：
   5 : 0b 04             Ldar a1
   7 : 43 03 01          Div a0, [1]      ← 可能抛异常
  10 : 40 f9 00          Add r0, [0]
  13 : 1b f9 f7          Mov r0, r2
  16 : d2                Star0

字节码偏移 17（跳过 catch）：
  17 : 96 12             Jump [18]        → 跳到偏移 35

字节码偏移 19-34（catch 块 e1）：
  19 : d0                Star2
  20 : 8d f7 00          CreateCatchContext r2, [0]  ← Handler 入口
  ...
  32 : d2                Star0
  33 : 1d f7             PopContext r2
```

**Handler Table 条目 1**：
```
(   5,  17)  ->    19
```
- **[5, 17)**：try 块字节码范围
- **→ 19**：如果抛异常，跳转到偏移 19（CreateCatchContext）

---

**第二个 try-catch**：

```
字节码偏移 38-52（try 块）：
  38 : 23 01 03          LdaGlobal [1], [3]
  41 : cf                Star3
  42 : 6b f6 05 05       CallUndefinedReceiver1 r3, a2, [5]  ← 可能抛异常
  46 : 40 f9 02          Add r0, [2]
  49 : 1b f9 f7          Mov r0, r2
  52 : d2                Star0

字节码偏移 53（跳过 catch）：
  53 : 96 12             Jump [18]        → 跳到偏移 71

字节码偏移 55-70（catch 块 e2）：
  55 : d0                Star2
  56 : 8d f7 02          CreateCatchContext r2, [2]  ← Handler 入口
  ...
  68 : d2                Star0
  69 : 1d f7             PopContext r2
```

**Handler Table 条目 2**：
```
(  38,  53)  ->    55
```
- **[38, 53)**：try 块字节码范围
- **→ 55**：如果抛异常，跳转到偏移 55（CreateCatchContext）

---

## 三、Maglev IR 中的异常处理

### 情况 1：优化成功，无显式异常 Block

当 Maglev 成功优化时，异常处理可能**隐式**存在：

```
Block b1
         ↱ eager @7 (8 live vars)
  15/11: CheckedSmiUntag [v10/n2:[rax|R|t]] → [rax|R|w32]
         ↱ eager @7 (8 live vars)
  16/12: CheckedSmiUntag [v11/n3:[rcx|R|t]] → [rcx|R|w32]
         ↱ eager @7 (8 live vars)
  17/13: Int32DivideWithOverflow [...]
```

**隐式异常处理**：
- `↱ eager @7`：如果检查失败，会**反优化**（Deopt）到字节码偏移 7
- **反优化后**：回退到 Ignition 解释器，此时 Handler Table 生效
- 不需要在 Maglev IR 中显式创建异常处理 Block

**流程**：
```
Maglev IR 执行
  ↓ CheckedSmiUntag 失败
Deopt → 回退到 Ignition（字节码偏移 7）
  ↓ Ignition 执行 Div 指令
如果抛异常
  ↓ 查询 Handler Table
跳转到 catch 块（偏移 19）
```

---

### 情况 2：优化失败，显式异常 Block

当 Maglev 无法优化时（例如用例 4: parseNumber），会创建**显式的异常处理 Block**：

```
Block b2（抛异常路径）
  17/14: 🐢 Construct [v5/n12:[rdi|R|t], ...]
        ↳ lazy @18 (4 live vars)
        ↳ throw (b4)    ← 显式指向异常处理 Block
  18/15: 🐢 Throw(Throw, has_input=1) [v17/n14:[rax|R|t]]
        ↳ lazy @23 (4 live vars)
        ↳ throw (b4)    ← 显式指向异常处理 Block
  19/16: Abort(Unexpectedly returned from a throw)

Block b4 (exception handler)  ← 异常处理 Block
    49: ConstantGapMove(n36 → [rax|R|t])
  23/37: SetPendingMessage [v9/n36:[rax|R|t]] → [rcx|R|t]
    50: ConstantGapMove(n20 → [rax|R|t])
  24/39: ReduceInterruptBudgetForReturn(46) [v2/n20:[rax|R|t]]
    51: ConstantGapMove(n38 → [rax|R|t])
  25/40: Return [v10/n38:[rax|R|t]]
```

**显式异常处理**：
- `↳ throw (b4)`：明确指示如果抛异常，跳转到 Block b4
- **Block b4** 对应 Handler Table 中的 `hdlr` 偏移量
- Maglev 生成了异常处理的优化代码

---

## 四、对应关系总结

### Handler Table ↔ Maglev IR 映射

**类型 A：隐式处理（通过 Deopt）**

```
Handler Table:
  (from=5, to=17) → hdlr=19

Maglev IR:
  Block b1 (字节码 5-17)
    CheckedSmiUntag    ↱ eager @7 (Deopt)
    Int32DivideWith... ↱ eager @7 (Deopt)

  没有显式的异常 Block

  如果抛异常：
    1. Deopt 回退到 Ignition
    2. Ignition 查询 Handler Table
    3. 跳转到字节码偏移 19（catch 块）
```

**类型 B：显式处理（异常 Block）**

```
Handler Table:
  (from=3, to=33) → hdlr=33

Maglev IR:
  Block b2 (字节码 3-33)
    Construct          ↳ throw (b4)
    Throw              ↳ throw (b4)

  Block b4 (exception handler) ← 对应 hdlr=33
    SetPendingMessage
    Return -1

  如果抛异常：
    1. 直接跳转到 Block b4（Maglev 优化的异常路径）
    2. 执行优化的异常处理代码
```

---

## 五、多个异常处理器的识别

### 如何区分多个异常处理器？

在 **BytecodeArray** 中：
```
Handler Table (size = 32)
   from   to       hdlr (prediction,   data)
  (   5,  17)  ->    19 (prediction=1, data=1)  ← 第一个异常处理器
  (  38,  53)  ->    55 (prediction=1, data=1)  ← 第二个异常处理器
```

**识别规则**：
1. **不重叠的范围**：[5, 17) 和 [38, 53) 不重叠
2. **不同的 hdlr**：hdlr=19 和 hdlr=55 是两个不同的 catch 块
3. **data 字段**：可能指示 catch 变量的槽位索引

---

在 **Maglev IR** 中（类型 B 的情况）：

```
Block b2
  Construct          ↳ throw (b4)  ← 指向第一个异常处理 Block
  Throw              ↳ throw (b4)

Block b3
  CallKnownJSFunction ↳ throw (b5)  ← 指向第二个异常处理 Block

Block b4 (exception handler)  ← 第一个 catch 块
  SetPendingMessage
  Return -1

Block b5 (exception handler)  ← 第二个 catch 块
  SetPendingMessage
  Return -2
```

**识别规则**：
1. **不同的 Block ID**：b4 和 b5 是两个独立的异常处理 Block
2. **throw 标注**：根据 `↳ throw (bX)` 确定跳转目标
3. **Block 标签**：`Block bX (exception handler)` 明确标识

---

## 六、实际调试步骤

### 步骤 1：查看 BytecodeArray 的 Handler Table

```bash
out/x64.debug/d8 --allow-natives-syntax --print-bytecode script.js
```

输出：
```
Handler Table (size = 32)
   from   to       hdlr (prediction,   data)
  (   5,  17)  ->    19 (prediction=1, data=1)
  (  38,  53)  ->    55 (prediction=1, data=1)
```

**记录**：
- 第一个异常处理器：try 块 [5, 17)，catch 块从 19 开始
- 第二个异常处理器：try 块 [38, 53)，catch 块从 55 开始

---

### 步骤 2：查看 Maglev IR

```bash
out/x64.debug/d8 --allow-natives-syntax --print-maglev-graph script.js
```

**查找 Block 对应关系**：

1. **找到 try 块对应的 Block**：
   - 查看字节码注释（`[0;34m 7 : Div a0, [1][m`）
   - 确定字节码偏移量在哪个 Block 中

2. **查找异常跳转标注**：
   - 寻找 `↳ throw (bX)` 标注
   - 确定异常跳转到哪个 Block

3. **识别异常处理 Block**：
   - 查找 `Block bX (exception handler)` 标签
   - 对比 Handler Table 中的 `hdlr` 偏移量

---

### 步骤 3：建立映射表

| Handler Table | BytecodeArray 偏移 | Maglev IR Block | 说明 |
|---------------|-------------------|-----------------|------|
| (5, 17) → 19 | try: 5-16, catch: 19-34 | b1 → b4 (隐式 Deopt) | 第一个 try-catch |
| (38, 53) → 55 | try: 38-52, catch: 55-70 | b2 → b5 (隐式 Deopt) | 第二个 try-catch |

---

## 七、特殊情况

### 嵌套 try-catch

```javascript
function nested(a, b, c) {
  try {
    try {
      return a / b;
    } catch (e1) {
      return c / a;
    }
  } catch (e2) {
    return -1;
  }
}
```

**Handler Table**（嵌套范围）：
```
Handler Table (size = 48)
   from   to       hdlr (prediction,   data)
  (   5,  10)  ->    12 (prediction=1, data=1)  ← 内层 try-catch
  (   5,  20)  ->    22 (prediction=1, data=2)  ← 外层 try-catch（包含内层）
```

**识别规则**：
- **范围重叠**：[5, 10) ⊆ [5, 20)
- **内层优先**：如果在偏移 7 抛异常，先匹配内层的 hdlr=12
- **如果内层不处理**：继续向外层传播，匹配 hdlr=22

---

### 没有 catch 的 finally

```javascript
function withFinally(a, b) {
  try {
    return a / b;
  } finally {
    console.log("done");
  }
}
```

**Handler Table**：
```
Handler Table (size = 16)
   from   to       hdlr (prediction,   data)
  (   5,  10)  ->    15 (prediction=0, data=0)  ← prediction=0 表示 finally
```

**prediction 含义**：
- `prediction=1`：预测会抛异常（catch 块）
- `prediction=0`：不一定抛异常（finally 块）

---

## 八、关键要点

1. **Handler Table 是权威来源**：
   - 定义了哪些字节码范围有异常处理
   - 定义了异常跳转的目标偏移量

2. **Maglev IR 的两种处理方式**：
   - **隐式**（通过 Deopt）：优化成功，不创建异常 Block
   - **显式**（异常 Block）：无法完全优化，创建 `exception handler` Block

3. **异常传播链**：
   ```
   Maglev IR 执行
     ↓ (如果需要)
   Deopt → Ignition 字节码
     ↓
   查询 Handler Table
     ↓
   跳转到 catch 块 (hdlr 偏移)
   ```

4. **多个异常处理器**：
   - 通过 **from-to 范围** 区分
   - 通过 **hdlr 偏移量** 确定跳转目标
   - 嵌套时**优先匹配内层**

5. **调试技巧**：
   - 先看 Handler Table（字节码级别）
   - 再看 Maglev IR（优化级别）
   - 建立 **字节码偏移 ↔ Block** 的映射关系

---

## 相关文档

- [maglev_debugging_guide.md](./maglev_debugging_guide.md) - Maglev 调试完整指南
- [inline_cache_deep_dive.md](./inline_cache_deep_dive.md) - IC 机制详解
