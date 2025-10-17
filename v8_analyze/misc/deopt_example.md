# Deoptimization 实例分析

## 代码

```javascript
function add(a, b) {
  let result = a + b;
  return result;
}

add(1, 2); // 预热：整数
add(3, 4); // 预热：整数
add(5, 6.1); // 💥 反优化！浮点数
```

```shell
out/x64.debug/d8 --trace-deopt --allow-natives-syntax test_frame.js
```

## Maglev 编译过程

### 第一阶段：类型反馈收集

```
调用 add(1, 2):
  - 参数 a: Smi (1)
  - 参数 b: Smi (2)
  - 反馈槽 [0]: BinaryOp:SignedSmall ✓

调用 add(3, 4):
  - 参数 a: Smi (3)
  - 参数 b: Smi (4)
  - 反馈槽 [0]: BinaryOp:SignedSmall ✓✓ (确认)
```

### 第二阶段：Maglev 投机优化

```
编译假设：a 和 b 都是 Smi
生成代码：
  n9: CheckedSmiUntag [a]      // 守卫：确保 a 是 Smi
  n10: CheckedSmiUntag [b]     // 守卫：确保 b 是 Smi  ← 💥 这里会失败
  n11: Int32Add [n9, n10]      // 快速整数加法
  n14: Int32ToNumber [n11]     // 转回 Number
  n15: Return [n14]
```

### 第三阶段：反优化触发

```
调用 add(5, 6.1):
  - 参数 a: Smi (5)  ✓
  - 参数 b: HeapNumber (6.1)  ✗ 不是 Smi！

执行到 n10: CheckedSmiUntag [b]:
  - 检查 6.1 的类型标签
  - 发现不是 Smi（是 HeapNumber）
  - 触发 deopt-eager
```

## FrameState 恢复过程

```
┌─────────────────────────────────────┐
│ Maglev 优化代码 (执行中)             │
│                                     │
│ n9: CheckedSmiUntag [5]    ✓       │
│ n10: CheckedSmiUntag [6.1] ✗ 失败! │
│         ↓                           │
│    触发反优化                        │
└─────────────────────────────────────┘
         ↓
    使用 FrameState 恢复
         ↓
┌─────────────────────────────────────┐
│ 字节码解释器（恢复状态）             │
│                                     │
│ bytecode offset 2: Add a0, [0]     │
│   寄存器 a0 = 5                     │
│   寄存器 a1 = 6.1                   │
│   累加器 = a1 (6.1)                 │
│                                     │
│ 执行通用 Add 操作：                  │
│   - 检查类型（Number + Number）     │
│   - 调用浮点加法                     │
│   - 返回 11.1                       │
└─────────────────────────────────────┘
```

## FrameState 保存的信息

```cpp
DeoptFrame {
  frame_type: kInterpretedFrame,
  bytecode_offset: 2,           // 回到字节码偏移 2
  registers: [
    receiver: <global>,         // this
    a0: Smi(5),                // 参数 a
    a1: HeapNumber(6.1),       // 参数 b
    r0: <undefined>,           // 局部变量 result（还未计算）
  ],
  accumulator: HeapNumber(6.1), // 累加器（Ldar a1 刚加载的值）
  context: <native context>,
  virtual_objects: []           // 虚拟对象列表（本例为空）
}
```

## 反优化日志解读

```
[bailout (kind: deopt-eager, reason: not a Smi): begin.
deoptimizing 0x15e60082cb0d <JSFunction add (sfi = 0x15e60082ca6d)>,
0x25d400800309 <Code MAGLEV>,
opt id 0,              // 优化 ID
node id 0,             // 节点 ID
bytecode offset 2,     // 恢复到字节码偏移 2 (Add 指令)
deopt exit 1,          // 反优化出口 1 (CheckedSmiUntag)
FP to SP delta 24,     // 栈帧信息
caller SP 0x7ffcac2e2bf0,
pc 0x7f509e6003b5]     // 程序计数器
```

### 关键信息：

- **kind: deopt-eager** → 立即反优化（非延迟）
- **reason: not a Smi** → 原因：不是小整数
- **bytecode offset 2** → 回到字节码 `Add a0, [0]`
- **deopt exit 1** → 从第 1 个反优化点退出（n10: CheckedSmiUntag）

## 性能影响

### 优化路径（整数）

```
add(5, 6) 执行时间：
  CheckedSmiUntag:  ~1 cycle
  Int32Add:         ~1 cycle
  Int32ToNumber:    ~2 cycles
  总计：            ~4 cycles
```

### 反优化后（通用路径）

```
add(5, 6.1) 首次执行：
  CheckedSmiUntag:  ~1 cycle (失败)
  Deopt:            ~50-100 cycles (保存状态、跳转)
  解释器 Add:       ~20-30 cycles
  总计：            ~70-130 cycles (首次)

后续调用：
  解释器 Add:       ~20-30 cycles (已反优化)
```

## 教训

1. **类型稳定性很重要**：

   - ✓ 总是传相同类型 → 优化有效
   - ✗ 类型变化 → 反优化开销

2. **FrameState 的代价**：

   - 优化代码需要在关键点保存状态
   - 反优化时需要重建完整的解释器状态

3. **投机优化的权衡**：
   - 大多数情况快速 → 值得优化
   - 偶尔反优化 → 可以接受
   - 频繁反优化 → 可能放弃优化（标记为 "never optimize"）
