# 调试与工具 (Debugging & Tools)

本目录包含 V8 调试、追踪和性能分析工具的完整文档。

## 文档列表

### 调试完整指南

- **`debug_and_profiling_capabilities.md`** - V8 调试和性能分析完整指南
  - **Verify 验证能力**：内存和堆完整性检查
  - **Log 日志系统**：100+ 日志选项
  - **编译耗时统计**：详细的编译性能分析
  - **Trace 追踪功能**：100+ 追踪标志详解
  - **Runtime Call Stats**：运行时调用统计
  - **最佳实践**：调试和性能分析技巧

### Maglev 专项调试

- **`maglev_debugging_guide.md`** - Maglev 编译器调试完整指南
  - Maglev 特定的追踪标志
  - 图可视化工具
  - 性能分析方法
  - 常见问题诊断
  - 实用调试技巧

### 字节码与汇编

- **`bytecode_and_assembly_printing.md`** - 字节码和汇编打印指南
  - `--print-bytecode`：查看字节码
  - `--print-code`：查看生成的机器码
  - 反汇编输出解读
  - 各编译层级的代码对比

## 快速参考

### 常用调试命令

```bash
# 基础追踪
out/x64.debug/d8 --trace-opt script.js              # 追踪优化
out/x64.debug/d8 --trace-deopt script.js            # 追踪反优化
out/x64.debug/d8 --trace-ic script.js               # 追踪 IC

# Maglev 调试
out/x64.debug/d8 --trace-maglev script.js           # 追踪 Maglev 编译
out/x64.debug/d8 --trace-maglev-graph-building script.js  # 追踪图构建
out/x64.debug/d8 --print-maglev-code script.js      # 打印生成代码

# 性能统计
out/x64.release/d8 --runtime-call-stats script.js   # 运行时调用统计
out/x64.release/d8 --trace-opt-stats script.js      # 优化统计
out/x64.release/d8 --maglev-stats script.js         # Maglev 统计

# 代码打印
out/x64.debug/d8 --print-bytecode script.js         # 打印字节码
out/x64.debug/d8 --print-code script.js             # 打印机器码
out/x64.debug/d8 --code-comments script.js          # 代码注释

# 堆和 GC
out/x64.debug/d8 --trace-gc script.js               # 追踪 GC
out/x64.debug/d8 --verify-heap script.js            # 验证堆完整性

# 组合使用
out/x64.debug/d8 --trace-opt --trace-deopt --trace-maglev --allow-natives-syntax script.js
```

### 交互式演示工具

```bash
# Maglev 统计交互工具（推荐）
./test-cases/run_maglev_stats.sh
```

## 使用场景

### 场景 1：诊断优化问题

```bash
# 1. 查看函数是否被优化
out/x64.debug/d8 --trace-opt script.js

# 2. 查看为什么没有优化
out/x64.debug/d8 --trace-opt-verbose script.js

# 3. 查看是否发生反优化
out/x64.debug/d8 --trace-deopt script.js
```

### 场景 2：分析性能瓶颈

```bash
# 1. 运行时统计（最全面）
out/x64.release/d8 --runtime-call-stats script.js

# 2. 优化统计
out/x64.release/d8 --trace-opt-stats script.js

# 3. Maglev 编译统计
out/x64.release/d8 --maglev-stats script.js
```

### 场景 3：理解代码生成

```bash
# 1. 查看字节码
out/x64.debug/d8 --print-bytecode script.js

# 2. 查看 Maglev 生成的代码
out/x64.debug/d8 --print-maglev-code script.js

# 3. 查看 TurboFan 生成的代码
out/x64.debug/d8 --print-opt-code script.js
```

### 场景 4：调试 Maglev 编译

```bash
# 完整的 Maglev 调试流程
out/x64.debug/d8 \
  --trace-maglev \
  --trace-maglev-graph-building \
  --trace-maglev-regalloc \
  --print-maglev-code \
  --code-comments \
  --allow-natives-syntax \
  script.js
```

## 学习路径

### 初学者

1. 从 `debug_and_profiling_capabilities.md` 开始，了解所有可用工具
2. 实践基础追踪命令：`--trace-opt`、`--trace-deopt`
3. 使用 `--print-bytecode` 理解字节码

### 进阶用户

1. 深入 `maglev_debugging_guide.md`，掌握 Maglev 调试
2. 使用 `--runtime-call-stats` 进行性能分析
3. 学习读懂反汇编输出

### 专家级

1. 组合使用多个追踪标志
2. 使用 Turbolizer 可视化编译图
3. 自定义日志和统计收集

## 相关主题

- **`../maglev/`** - Maglev 编译器原理
- **`../optimization/`** - 优化机制详解
- **`../test-cases/`** - 测试和演示脚本

## 工具推荐

### 命令行工具

- **d8**：V8 的命令行 shell，支持所有调试标志
- **gdb/lldb**：C++ 源码级调试
- **perf**：Linux 性能分析工具

### 可视化工具

- **Turbolizer**：可视化 TurboFan/Turboshaft 编译图
- **Chrome DevTools**：JavaScript 层面的性能分析
- **Linux perf + FlameGraph**：生成火焰图

### 自定义脚本

- **`test-cases/run_maglev_stats.sh`**：交互式 Maglev 统计工具
- **`test-cases/decode-optimization-status.js`**：优化状态解码

## 性能分析最佳实践

1. **使用 release 构建进行性能测试**
   ```bash
   tools/dev/gm.py quiet x64.release
   out/x64.release/d8 --runtime-call-stats script.js
   ```

2. **使用 debug/optdebug 构建进行调试**
   ```bash
   tools/dev/gm.py quiet x64.debug
   out/x64.debug/d8 --trace-opt --trace-deopt script.js
   ```

3. **避免在 debug 构建上做性能测试**（会慢 10-100 倍）

4. **组合使用多个标志获取全貌**
   ```bash
   out/x64.debug/d8 \
     --trace-opt \
     --trace-deopt \
     --trace-ic \
     --allow-natives-syntax \
     script.js
   ```

## 常见问题

**Q: 为什么我的函数没有被优化？**
A: 使用 `--trace-opt-verbose` 查看原因，常见原因包括：
- 函数太大
- 包含不支持的语法（eval、with 等）
- 还没有达到热度阈值

**Q: 如何快速触发 Maglev 编译？**
A: 使用 `%PrepareFunctionForOptimization()` 和 `%OptimizeMaglevOnNextCall()`

**Q: 如何查看具体的反优化原因？**
A: 使用 `--trace-deopt` 会打印详细的反优化原因和位置

---

**注意**：这些文档是个人学习笔记，建议以 V8 官方文档和源码为准。
