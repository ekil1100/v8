# Maglev 统计演示 - 使用指南

本指南演示如何使用 `maglev-stats-demo.js` 来观察V8 Maglev编译器的编译时间统计。

---

## 快速开始

### 1. 基本用法 - 查看每个函数的编译时间

```bash
cd /home/like/google/v8/v8
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js
```

**预期输出:**
```
[marking 0x... <simpleAdd> for optimization with Maglev]
[maglev] Compiled: 1 functions with 45 byte source size in 2.3ms.

[marking 0x... <sumArray> for optimization with Maglev]
[maglev] Compiled: 2 functions with 123 byte source size in 5.8ms.

[marking 0x... <fibonacci> for optimization with Maglev]
[maglev] Compiled: 3 functions with 234 byte source size in 9.5ms.

...
```

**解读:**
- 每行显示一个函数的编译
- 数字是累计值：函数数量、源代码总大小、累计编译时间

---

### 2. 详细统计 - 查看编译阶段分解

```bash
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js
```

**预期输出:**
```
=== Maglev Compilation Statistics for 'simpleAdd' ===
Phase Kind: V8.MaglevPrepareJob
  Time: 0.2ms
  Allocated: 256 bytes

Phase Kind: V8.MaglevExecuteJob
  Time: 1.8ms
  Allocated: 4096 bytes
  Input graph: 12 nodes
  Output graph: 10 nodes

Phase Kind: V8.MaglevFinalizeJob
  Time: 0.3ms
  Allocated: 512 bytes

Total: 2.3ms

=== Maglev Compilation Statistics for 'fibonacci' ===
...
```

**关键指标:**
- **Prepare时间**: 准备编译资源（通常很短）
- **Execute时间**: 构建图、优化、寄存器分配（最耗时）
- **Finalize时间**: 生成机器代码（中等耗时）
- **Input/Output graph size**: 优化前后的节点数量

---

### 3. 完整的优化追踪

```bash
out/x64.release/d8 --trace-opt --trace-opt-stats --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | less
```

**可以看到:**
- 哪些函数被标记为优化
- 完整的编译时间统计
- 详细的阶段分解

---

### 4. 追踪反优化

```bash
out/x64.release/d8 --trace-opt --trace-deopt --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js
```

观察是否有函数被反优化（deoptimized）。

---

### 5. JSON格式输出（机器可读）

```bash
out/x64.release/d8 --maglev-stats-nvp v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | tee maglev_stats.json
```

生成JSON格式的统计数据，可用于：
- 自动化分析
- 性能回归测试
- 可视化展示

---

### 6. 结合Runtime Call Stats

```bash
out/x64.release/d8 --runtime-call-stats --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js
```

查看完整的运行时调用统计，包括：
- Maglev编译时间
- GC时间
- API调用时间
- 总执行时间

---

## 测试用例说明

### 包含的函数类型

| 函数名 | 复杂度 | 预期编译时间 | 特点 |
|--------|--------|------------|------|
| `simpleAdd` | 低 | <3ms | 简单运算，快速编译 |
| `sumArray` | 中 | 3-6ms | 包含循环和数组访问 |
| `fibonacci` | 中-高 | 5-10ms | 复杂循环，更多优化机会 |
| `complexCalculation` | 高 | 8-15ms | 多种操作，类型推断 |
| `processObject` | 中 | 4-8ms | 对象属性访问 |
| `multiplyArrayElements` | 中 | 5-10ms | 数组操作，内联候选 |
| `processString` | 中 | 4-8ms | 字符串操作 |
| `mainFunction` | 低 | 2-5ms | 函数调用链，测试内联 |

### 触发Maglev编译的条件

每个函数都被调用10,000次以确保：
1. 达到热度阈值
2. 收集足够的类型反馈
3. 触发Maglev编译（而不是直接到TurboFan）

---

## 观察要点

### 1. 编译时间差异

比较不同函数的编译时间：
```bash
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "maglev"
```

**问题思考:**
- 为什么 `fibonacci` 比 `simpleAdd` 编译慢？
- Execute阶段占总时间的百分比是多少？

### 2. 图的大小变化

```bash
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "graph"
```

**观察:**
- Input graph vs Output graph
- 优化减少了多少节点？

### 3. 内存分配

```bash
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "Allocated"
```

**关注:**
- 哪个阶段分配内存最多？
- 不同函数的内存分配差异

---

## 高级用法

### 对比Maglev vs TurboFan

```bash
# Maglev编译
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "\[maglev\]"

# 强制TurboFan编译（禁用Maglev）
out/x64.release/d8 --no-maglev --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "\[turbofan\]"
```

**对比维度:**
- 编译时间：Maglev通常快5-10倍
- 函数覆盖：Maglev可以编译更多函数

### 追踪详细的Maglev图构建

```bash
out/x64.debug/d8 --trace-maglev-graph-building v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | less
```

查看Maglev如何构建优化图。

### 追踪Maglev内联决策

```bash
out/x64.debug/d8 --trace-maglev-inlining v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "inline"
```

观察哪些函数被内联，哪些没有。

### 查看生成的代码

```bash
out/x64.debug/d8 --print-maglev-code v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | less
```

查看Maglev生成的机器代码。

---

## 性能分析流程

### 步骤1: 识别热函数

```bash
out/x64.release/d8 --trace-opt v8_analyze/test-cases/maglev-stats-demo.js
```

查看哪些函数被优化。

### 步骤2: 分析编译时间

```bash
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js
```

确定编译开销。

### 步骤3: 检查优化效果

```bash
# 观察优化前后的性能差异
# 脚本已经包含了benchmark部分
out/x64.release/d8 v8_analyze/test-cases/maglev-stats-demo.js
```

### 步骤4: 深入分析慢函数

```bash
out/x64.release/d8 --maglev-stats --trace-maglev-inlining v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "fibonacci" -A 20
```

---

## 输出文件管理

### 保存统计到文件

```bash
# 保存trace输出
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | tee maglev_trace.log

# 保存详细统计
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | tee maglev_detailed.log

# 保存JSON数据
out/x64.release/d8 --maglev-stats-nvp v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | tee maglev_stats.json
```

### 提取特定信息

```bash
# 只看编译时间
grep "maglev.*Compiled" maglev_trace.log

# 只看总时间
grep "Total:" maglev_detailed.log

# 提取Execute阶段时间
grep "MaglevExecuteJob" maglev_detailed.log -A 3
```

---

## 常见问题

### Q: 为什么看不到Maglev编译输出？

A: 检查：
1. V8构建是否启用了Maglev (`V8_ENABLE_MAGLEV`)
2. 是否使用了release构建（debug构建行为可能不同）
3. 函数是否被调用足够次数

### Q: 如何确认函数被Maglev而不是TurboFan编译？

A: 使用 `--trace-opt-verbose`:
```bash
out/x64.release/d8 --trace-opt-verbose v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep -E "(Maglev|TurboFan)"
```

### Q: Execute阶段时间过长怎么办？

A: 可能原因：
- 函数太复杂（考虑拆分）
- 类型不稳定（检查类型反馈）
- 内联了太多代码（查看 `--trace-maglev-inlining`）

### Q: 如何测量编译对总执行时间的影响？

A: 对比：
```bash
# 禁用优化
out/x64.release/d8 --no-opt v8_analyze/test-cases/maglev-stats-demo.js

# 启用Maglev
out/x64.release/d8 v8_analyze/test-cases/maglev-stats-demo.js
```

---

## 实验建议

### 实验1: 函数大小与编译时间的关系

修改函数，增加循环次数或计算复杂度，观察编译时间变化。

### 实验2: 类型稳定性的影响

```javascript
// 添加类型不稳定的调用
for (let i = 0; i < 1000; i++) {
  simpleAdd(i, i + 1);        // 数字
  simpleAdd("a", "b");        // 字符串
}
```

观察编译时间和优化决策的变化。

### 实验3: 内联的影响

比较 `mainFunction` 和单独的 `helper1`、`helper2` 的编译时间。

---

## 参考文档

- **主文档**: `v8_analyze/debug_and_profiling_capabilities.md`
- **Maglev详解**: `v8_analyze/maglev_compilation_timing.md`
- **V8官方文档**: https://v8.dev/docs

---

## 快速命令参考

```bash
# 最常用的三个命令

# 1. 快速查看编译统计
d8 --trace-opt-stats maglev-stats-demo.js

# 2. 详细阶段分解
d8 --maglev-stats maglev-stats-demo.js

# 3. 完整追踪
d8 --trace-opt --trace-opt-stats --maglev-stats maglev-stats-demo.js
```

---

**创建时间:** 2025-10-22
**测试环境:** V8 latest (主分支)
**建议使用:** Release构建 (`out/x64.release/d8`)
