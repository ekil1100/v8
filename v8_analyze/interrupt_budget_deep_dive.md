# 中断预算（Interrupt Budget）详解

## 一、什么是中断预算？

**中断预算**（Interrupt Budget）是 V8 用来定期中断 JavaScript 执行的机制，防止代码无限循环卡死整个系统。

### 设计目的

1. **垃圾回收（GC）**：定期检查是否需要触发 GC
2. **调试器支持**：响应调试器的暂停请求
3. **防止卡死**：防止无限循环占用 CPU 导致程序无响应
4. **异步事件**：处理 I/O 事件、定时器等异步任务
5. **分层编译（Tiering）**：检查是否需要从 Maglev 升级到 TurboFan

## 二、工作原理

### 基本机制

每个函数有一个**中断预算计数器**，存储在 `FeedbackCell` 对象中：

```
┌─────────────────┐
│  FeedbackCell   │
├─────────────────┤
│ value           │ ← FeedbackVector 指针
│ interrupt_budget│ ← 中断预算计数器（int32）
│ dispatch_handle │
└─────────────────┘
```

### 循环中的预算减少

```
初始预算：1000（示例值）

第 1 次迭代：1000 - 35 = 965  ✓ 继续执行
第 2 次迭代：965  - 35 = 930  ✓ 继续执行
第 3 次迭代：930  - 35 = 895  ✓ 继续执行
...
第 28 次迭代：35   - 35 = 0    ✓ 继续执行
第 29 次迭代：0    - 35 = -35  ✗ 触发中断检查！
```

当预算 ≤ 0 时，触发**中断处理**：
- 检查是否需要 GC
- 检查调试器断点
- 处理异步事件
- 检查是否需要分层编译（升级到 TurboFan）
- **重置预算**，继续执行

## 三、Maglev IR 中的表示

### processData 函数中的例子

```
Block b5
  53 : JumpLoop [44], [0], [11]
       │         │     │    └─ 预算减少值：11（字节码层面）
       │         │     └────── 循环深度：0
       │         └──────────── 跳转目标偏移：44

  27/34: ReduceInterruptBudgetForLoop(35) [v1/n33:[r11|R|t]]
         │                             │    └─ FeedbackCell 对象
         │                             └────── 每次循环减少 35
         └──────────────────────────────────── Maglev IR 节点

         ↳ lazy @53 (8 live vars)
            └─ 懒惰解优化点（预算耗尽时可能触发）
```

**关键点**：
- 字节码层面：减少 11
- Maglev IR 层面：减少 35
- 这个差异可能是因为 Maglev 优化了循环体，执行更快，所以减少更多

### 为什么是 35？

预算减少值**不是固定的**，由 V8 根据以下因素计算：

1. **循环体大小**：循环体越大，减少越多
2. **字节码数量**：更多字节码 → 更多减少
3. **编译层级**：Maglev/TurboFan 执行更快 → 减少更多
4. **优化强度**：优化越激进 → 减少越多

公式示例（简化）：
```
预算减少值 = 字节码长度 × 权重系数
```

在我们的例子中：
- 循环体包含数组访问、条件判断、加法等操作
- 字节码约 30-40 字节
- Maglev 优化后 → 减少值为 35

## 四、机器码实现（x64）

### 生成的汇编代码

```assembly
; ReduceInterruptBudgetForLoop(35) 生成的代码

; 1. 减少预算
subl [r11 + FeedbackCell::kInterruptBudgetOffset], 35
     │      └─ FeedbackCell.interrupt_budget 字段偏移
     └──────── FeedbackCell 对象地址（r11 寄存器）

; 2. 检查是否 < 0
jl HandleInterruptsAndTiering    ; 如果 less（小于 0），跳转到中断处理

; 3. 继续执行
done:
  ; 循环继续...
```

**汇编代码解释**：

1. **subl 指令**：
   ```
   subl [内存地址], 立即数
   ```
   - 从内存地址（FeedbackCell.interrupt_budget）减去 35
   - 设置标志寄存器（EFLAGS）

2. **jl 指令**（Jump if Less）：
   - 检查标志寄存器的符号位（SF）
   - 如果结果 < 0，跳转到中断处理函数

3. **HandleInterruptsAndTiering**：
   - 延迟执行（deferred）的代码
   - 处理 GC、调试器、分层编译等
   - 重置预算并返回

### 实际源码（src/maglev/x64/maglev-ir-x64.cc）

```cpp
void GenerateReduceInterruptBudget(MaglevAssembler* masm, Node* node,
                                   Register feedback_cell,
                                   ReduceInterruptBudgetType type, int amount) {
  // 从 FeedbackCell 的 interrupt_budget 字段减去 amount
  __ subl(FieldOperand(feedback_cell, FeedbackCell::kInterruptBudgetOffset),
          Immediate(amount));

  ZoneLabelRef done(masm);

  // 如果结果 < 0，跳转到延迟代码处理中断
  __ JumpToDeferredIf(less, HandleInterruptsAndTiering, done, node, type);

  __ bind(*done);
}
```

## 五、中断处理流程

### 当预算耗尽时（< 0）

```
1. 跳转到 HandleInterruptsAndTiering
   ↓
2. 保存当前状态（寄存器、栈等）
   ↓
3. 调用运行时函数（Runtime::kHandleInterrupts）
   ↓
4. 检查各种中断源：
   - GC 请求 → 触发垃圾回收
   - 调试器断点 → 暂停执行，等待调试命令
   - 异步事件 → 处理 I/O、定时器等
   - 分层编译 → 检查是否需要升级到 TurboFan
   ↓
5. 重置预算（例如重新设置为 1000）
   ↓
6. 恢复状态
   ↓
7. 返回循环继续执行
```

### 解优化点

```
27/34: ReduceInterruptBudgetForLoop(35) [v1/n33:[r11|R|t]]
       ↳ lazy @53 (8 live vars)
          └─ 懒惰解优化点
```

**为什么需要解优化点？**

当预算耗尽并处理中断时，可能发生：
- **类型反馈改变**：运行时发现类型假设不再成立
- **需要解优化**：从 Maglev 代码回退到字节码解释器

解优化点记录了 8 个活跃变量，确保可以正确恢复状态：
1. this
2. arr
3. threshold
4. closure
5. sum
6. count
7. i
8. arr.length

## 六、不同场景的预算减少

### 1. 循环中（ReduceInterruptBudgetForLoop）

```javascript
for (let i = 0; i < arr.length; i++) {
  // 每次循环迭代减少预算
}
```

- 每次循环迭代减少固定值（如 35）
- 防止无限循环卡死

### 2. 函数返回时（ReduceInterruptBudgetForReturn）

```javascript
function foo() {
  // ...
  return result;  // 返回时也会减少预算
}
```

- 每次函数返回减少较小值（如 1-5）
- 用于分层编译决策（调用次数统计）

### 3. 字节码层面（JumpLoop）

```
JumpLoop [44], [0], [11]
                      └─ 字节码层面的减少值
```

- 解释器执行时使用这个值
- 通常比 Maglev 的减少值小

## 七、为什么不同层级的减少值不同？

### 执行速度差异

| 编译层级     | 速度      | 预算减少值 | 原因                     |
| ------------ | --------- | ---------- | ------------------------ |
| Ignition     | 慢        | 小（~5-15）| 解释器执行，速度慢       |
| Sparkplug    | 中        | 中（~20）  | 简单编译，速度中等       |
| Maglev       | 快        | 大（~35）  | 优化编译，速度快         |
| TurboFan     | 最快      | 很大（~50+）| 高度优化，速度最快       |

**原理**：
- 编译后的代码执行更快 → 单位时间内执行更多迭代
- 为了保持**大约相同的时间间隔**触发中断检查
- 更快的代码需要**更大的预算减少值**

**举例**：
```
假设目标：每 10ms 检查一次中断

Ignition（解释器）：
  每次迭代 0.1ms → 100 次迭代 = 10ms
  预算减少值 = 1000 / 100 = 10

Maglev（优化编译）：
  每次迭代 0.03ms → 333 次迭代 = 10ms
  预算减少值 = 1000 / 333 ≈ 35

TurboFan（高度优化）：
  每次迭代 0.02ms → 500 次迭代 = 10ms
  预算减少值 = 1000 / 500 ≈ 50
```

## 八、调试和观察

### 使用 d8 观察中断预算

```bash
# 打印中断相关信息
out/x64.debug/d8 --trace-interrupt-budget script.js

# 打印 GC 触发（与预算相关）
out/x64.debug/d8 --trace-gc script.js

# 调整初始预算（用于测试）
out/x64.debug/d8 --interrupt-budget=100 script.js
```

### 测试无限循环保护

```javascript
// 无限循环测试
function infiniteLoop() {
  while (true) {
    // 不断减少预算
  }
}

// 即使是无限循环，V8 也会定期中断检查
// 可以响应 Ctrl+C，可以触发 GC
infiniteLoop();
```

### 在 C++ 调试器中查看

```cpp
// 断点在 GenerateReduceInterruptBudget
(gdb) break GenerateReduceInterruptBudget

// 查看当前预算值
(gdb) x/w feedback_cell + FeedbackCell::kInterruptBudgetOffset
0x12345678:  965   // 当前预算为 965

// 单步执行 subl 指令
(gdb) si

// 再次查看
(gdb) x/w feedback_cell + FeedbackCell::kInterruptBudgetOffset
0x12345678:  930   // 减少了 35
```

## 九、常见问题

### Q1: 为什么需要预算机制，不能每次循环都检查吗？

**A**: 性能原因。

每次中断检查需要：
- 读取内存（检查中断标志）
- 可能的函数调用（HandleInterrupts）
- 状态保存和恢复

如果每次循环都检查 → 严重影响性能（~10-20% 开销）

使用预算机制 → 每 N 次循环检查一次 → 开销可控（~1% 以下）

### Q2: 预算耗尽一定会触发 GC 吗？

**A**: 不一定。

中断检查会执行：
```cpp
if (需要 GC) { 触发 GC; }
if (有调试器断点) { 暂停执行; }
if (有异步事件) { 处理事件; }
if (需要分层编译) { 重新编译; }
// 无论如何，重置预算
```

只有在实际需要时才会执行相应操作。

### Q3: 字节码的减少值 11 和 Maglev 的 35 有什么关系？

**A**: 它们是独立计算的。

- **字节码减少值（11）**：Ignition 解释器使用
- **Maglev 减少值（35）**：Maglev 编译后的代码使用

同一个循环在不同编译层级使用不同的减少值，以适应执行速度差异。

### Q4: 为什么我们的例子中是 35？

**A**: 基于循环体的复杂度计算。

我们的循环体包含：
- 数组边界检查（CheckInt32Condition）
- 元素加载（LoadFixedArrayElement）
- Smi 检查（CheckedSmiUntag）
- 整数比较（BranchIfInt32Compare）
- 条件加法（Int32AddWithOverflow）
- phi 节点合并

总共约 10-15 个 Maglev IR 节点，对应约 30-40 字节的字节码，因此预算减少值为 35。

## 十、总结

### 核心要点

1. **中断预算 = 定期中断检查的计数器**
   - 每次循环减少固定值
   - 预算 ≤ 0 时触发中断处理

2. **主要用途**：
   - 垃圾回收调度
   - 调试器支持
   - 防止无限循环卡死
   - 分层编译决策

3. **减少值计算**：
   - 基于循环体复杂度
   - 基于编译层级（越快 → 减少越多）
   - 目标：每隔固定时间间隔触发中断检查

4. **实现方式**：
   ```assembly
   subl [feedback_cell.interrupt_budget], amount
   jl HandleInterrupts
   ```

5. **懒惰解优化**：
   - 中断处理时可能发现类型假设失效
   - 需要记录活跃变量以支持解优化

### 关键理解

> **中断预算不是性能开销，而是性能优化**：通过减少检查频率（只在预算耗尽时检查），大幅降低中断检查的性能影响，同时保证系统的响应性。

---

相关源码位置：
- `src/objects/feedback-cell.h` - FeedbackCell 定义
- `src/maglev/maglev-ir.h` - ReduceInterruptBudgetForLoop 节点
- `src/maglev/x64/maglev-ir-x64.cc` - x64 代码生成
- `src/execution/isolate.cc` - 中断处理逻辑
