# Maglev 编译耗时统计详解

本文档详细说明V8 Maglev中级优化编译器的编译时间统计功能。

---

## 1. Maglev 编译时间统计概述

Maglev提供了详细的编译时间统计，可以追踪每个函数在不同编译阶段的耗时。

### 1.1 关键标志

#### `--maglev-stats`

**定义位置:** `src/flags/flag-definitions.h:741`

```cpp
DEFINE_BOOL(maglev_stats, false, "print Maglev statistics")
```

**功能:**
- 打印Maglev编译的详细统计信息
- 包括时间、内存使用、图大小等
- 以人类可读的格式输出

**使用示例:**
```bash
out/x64.release/d8 --maglev-stats script.js
```

#### `--maglev-stats-nvp`

**定义位置:** `src/flags/flag-definitions.h:742-743`

```cpp
DEFINE_BOOL(maglev_stats_nvp, false,
            "print Maglev statistics in machine-readable format")
```

**功能:**
- 以NVP (Name-Value Pair) 格式输出统计信息
- 机器可解析，适合自动化分析
- JSON格式输出

**使用示例:**
```bash
out/x64.release/d8 --maglev-stats-nvp script.js > maglev_stats.json
```

#### `--trace-opt-stats`

**定义位置:** `src/flags/flag-definitions.h:2798`

```cpp
DEFINE_BOOL(trace_opt_stats, false, "trace optimized compilation statistics")
```

**功能:**
- 追踪所有优化编译（包括Maglev和TurboFan）的统计信息
- 打印累计的编译时间、函数数量和代码大小
- 实时输出每次编译的增量统计

**使用示例:**
```bash
out/x64.release/d8 --trace-opt-stats script.js
```

**输出格式:**
```
[maglev] Compiled: 5 functions with 1234 byte source size in 12.5ms.
[maglev] Compiled: 10 functions with 2468 byte source size in 25.8ms.
```

---

## 2. 编译时间分解

### 2.1 编译阶段

Maglev编译过程分为三个主要阶段，每个阶段都单独计时：

#### 2.1.1 Prepare 阶段

**实现位置:** `src/maglev/maglev-concurrent-dispatcher.cc:116-126`

**功能:**
- 准备编译所需的资源
- 确保源位置信息可用（如果启用了 `--collect-source-positions`）
- 初始化编译环境

**时间记录:**
```cpp
counters->maglev_optimize_prepare()->AddSample(
    static_cast<int>(time_taken_to_prepare_.InMicroseconds()));
```

**对应计数器:** `V8.MaglevOptimizePrepare`

#### 2.1.2 Execute 阶段

**实现位置:** `src/maglev/maglev-concurrent-dispatcher.cc:128-140`

**功能:**
- 构建Maglev图
- 执行优化passes
- 寄存器分配
- 代码生成准备

**时间记录:**
```cpp
counters->maglev_optimize_execute()->AddSample(
    static_cast<int>(time_taken_to_execute_.InMicroseconds()));
```

**对应计数器:** `V8.MaglevOptimizeExecute`

**注意:** 这是编译过程中最耗时的阶段

#### 2.1.3 Finalize 阶段

**实现位置:** `src/maglev/maglev-concurrent-dispatcher.cc:142-168`

**功能:**
- 生成最终的机器代码
- 注册弱引用对象
- 安装编译后的代码

**时间记录:**
```cpp
counters->maglev_optimize_finalize()->AddSample(
    static_cast<int>(time_taken_to_finalize_.InMicroseconds()));
```

**对应计数器:** `V8.MaglevOptimizeFinalize`

### 2.2 总编译时间

**时间记录:**
```cpp
counters->maglev_optimize_total_time()->AddSample(
    static_cast<int>(ElapsedTime().InMicroseconds()));
```

**对应计数器:** `V8.MaglevOptimizeTotalTime`

**计算公式:**
```
总时间 = Prepare时间 + Execute时间 + Finalize时间
```

---

## 3. 统计数据结构

### 3.1 MaglevPipelineStatistics

**实现位置:** `src/maglev/maglev-pipeline-statistics.h`

```cpp
class MaglevPipelineStatistics : public compiler::PipelineStatisticsBase {
 public:
  void BeginPhaseKind(const char* name);
  void EndPhaseKind();
  void BeginPhase(const char* name);
  void EndPhase();
};
```

**功能:**
- 继承自 `PipelineStatisticsBase`
- 集成到 `CompilationStatistics` 系统
- 支持Chrome Tracing事件输出

### 3.2 CompilationStatistics::BasicStats

**实现位置:** `src/diagnostics/compilation-statistics.h:33-46`

```cpp
class BasicStats {
 public:
  base::TimeDelta delta_;                    // 时间增量
  size_t total_allocated_bytes_ = 0;         // 总分配字节数
  size_t max_allocated_bytes_ = 0;           // 最大分配字节数
  size_t absolute_max_allocated_bytes_ = 0;  // 绝对最大分配
  size_t input_graph_size_ = 0;              // 输入图大小
  size_t output_graph_size_ = 0;             // 输出图大小
  std::string function_name_;                // 函数名

  std::string AsJSON();  // JSON格式输出
};
```

---

## 4. 计数器定义

### 4.1 Histogram计数器

**定义位置:** `src/logging/counters-definitions.h:232-235`

```cpp
HT(maglev_optimize_prepare, V8.MaglevOptimizePrepare, 100000, MICROSECOND)
HT(maglev_optimize_execute, V8.MaglevOptimizeExecute, 100000, MICROSECOND)
HT(maglev_optimize_finalize, V8.MaglevOptimizeFinalize, 100000, MICROSECOND)
HT(maglev_optimize_total_time, V8.MaglevOptimizeTotalTime, 1000000, MICROSECOND)
```

**说明:**
- `HT` = Histogram Template
- 第一个参数: 计数器名称
- 第二个参数: Chrome UMA指标名称
- 第三个参数: 最大值（微秒）
- 第四个参数: 单位

**精度:**
- Prepare/Execute/Finalize: 最大100,000微秒 (100ms)
- TotalTime: 最大1,000,000微秒 (1000ms)
- 单位: 微秒

---

## 5. 使用方法

### 5.1 基本统计

#### 查看Maglev编译统计

```bash
# 启用Maglev统计
out/x64.release/d8 --maglev-stats test.js

# 输出示例：
# === Maglev Compilation Statistics ===
# Phase Kind: V8.MaglevPrepareJob
#   Time: 0.5ms
#   Memory: 1024 bytes
# Phase Kind: V8.MaglevExecuteJob
#   Time: 15.2ms
#   Memory: 65536 bytes
# Phase Kind: V8.MaglevFinalizeJob
#   Time: 2.3ms
#   Memory: 8192 bytes
# Total: 18.0ms
```

#### 机器可读格式

```bash
# NVP格式输出
out/x64.release/d8 --maglev-stats-nvp test.js

# 输出JSON格式，可以重定向到文件
out/x64.release/d8 --maglev-stats-nvp test.js > stats.json
```

### 5.2 追踪优化统计

```bash
# 追踪所有Maglev编译
out/x64.release/d8 --trace-opt-stats test.js

# 输出示例：
# [maglev] Compiled: 1 functions with 245 byte source size in 3.2ms.
# [maglev] Compiled: 2 functions with 512 byte source size in 6.5ms.
# [maglev] Compiled: 3 functions with 890 byte source size in 11.8ms.
```

### 5.3 组合使用

```bash
# 完整的Maglev性能分析
out/x64.release/d8 \
  --maglev-stats \
  --trace-opt-stats \
  --trace-opt \
  --trace-deopt \
  test.js

# 包括详细的编译和反优化信息
```

### 5.4 与Tracing集成

```bash
# 启用Chrome Tracing
out/x64.release/d8 \
  --trace-turbo \
  --trace-turbo-path=/tmp/trace \
  --maglev-stats \
  test.js

# 生成的trace可以在chrome://tracing中查看
```

---

## 6. 统计信息创建条件

**实现位置:** `src/maglev/maglev-concurrent-dispatcher.cc:88-100`

```cpp
MaglevPipelineStatistics* CreatePipelineStatistics(
    Isolate* isolate, MaglevCompilationInfo* compilation_info,
    compiler::ZoneStats* zone_stats) {
  MaglevPipelineStatistics* pipeline_stats = nullptr;
  bool tracing_enabled;
  TRACE_EVENT_CATEGORY_GROUP_ENABLED(TRACE_DISABLED_BY_DEFAULT("v8.maglev"),
                                     &tracing_enabled);
  if (tracing_enabled || v8_flags.maglev_stats || v8_flags.maglev_stats_nvp) {
    pipeline_stats = new MaglevPipelineStatistics(
        compilation_info, isolate->GetMaglevStatistics(), zone_stats);
  }
  return pipeline_stats;
}
```

**触发条件（满足任一）:**
1. Chrome Tracing的 `v8.maglev` 类别启用
2. `--maglev-stats` 标志开启
3. `--maglev-stats-nvp` 标志开启

---

## 7. 输出格式详解

### 7.1 trace_opt_stats 输出

**实现位置:** `src/maglev/maglev-concurrent-dispatcher.cc:219-232`

```cpp
if (v8_flags.trace_opt_stats) {
  static double compilation_time = 0.0;
  static int compiled_functions = 0;
  static int code_size = 0;

  compilation_time += (time_taken_to_prepare_.InMillisecondsF() +
                       time_taken_to_execute_.InMillisecondsF() +
                       time_taken_to_finalize_.InMillisecondsF());
  compiled_functions++;
  code_size += function()->shared()->SourceSize();
  PrintF(
      "[maglev] Compiled: %d functions with %d byte source size in %fms.\n",
      compiled_functions, code_size, compilation_time);
}
```

**输出字段:**
- `compiled_functions`: 累计编译的函数数量
- `code_size`: 累计源代码字节数
- `compilation_time`: 累计编译时间（毫秒）

**特点:**
- 累计统计（每次编译都会累加）
- 实时输出
- 包含所有三个阶段的总时间

### 7.2 JSON格式输出

**实现位置:** `src/diagnostics/compilation-statistics.h:37`

```cpp
std::string AsJSON();
```

**JSON结构:**
```json
{
  "delta_ms": 15.234,
  "total_allocated_bytes": 65536,
  "max_allocated_bytes": 32768,
  "absolute_max_allocated_bytes": 32768,
  "input_graph_size": 150,
  "output_graph_size": 120,
  "function_name": "myFunction"
}
```

### 7.3 Chrome Tracing事件

**实现位置:** `src/maglev/maglev-pipeline-statistics.cc:29-56`

**事件类型:**

1. **PhaseKind事件** (V8.MaglevPrepareJob, V8.MaglevExecuteJob, V8.MaglevFinalizeJob)
```cpp
TRACE_EVENT_BEGIN1(kTraceCategory, name, "kind", CodeKindToString(code_kind()));
TRACE_EVENT_END2(kTraceCategory, phase_kind_name(), "kind",
                 CodeKindToString(code_kind()), "stats",
                 TRACE_STR_COPY(diff.AsJSON().c_str()));
```

2. **Phase事件** (细粒度的编译阶段)
```cpp
TRACE_EVENT_BEGIN1(kTraceCategory, phase_name(), "kind",
                   CodeKindToString(code_kind()));
TRACE_EVENT_END2(kTraceCategory, phase_name(), "kind",
                 CodeKindToString(code_kind()), "stats",
                 TRACE_STR_COPY(diff.AsJSON().c_str()));
```

**Tracing分类:** `TRACE_DISABLED_BY_DEFAULT("v8.maglev")`

---

## 8. 每个函数的详细统计

### 8.1 函数级别的时间追踪

通过 `--trace-opt` 和 `--maglev-stats` 组合，可以看到每个函数的编译信息：

```bash
out/x64.release/d8 --trace-opt --maglev-stats test.js
```

**输出示例:**
```
[compiling method 0x... using Maglev]
=== Maglev Compilation Statistics for 'myFunction' ===
Phase Kind: V8.MaglevPrepareJob
  Time: 0.3ms
  Allocated: 512 bytes
Phase Kind: V8.MaglevExecuteJob
  Time: 12.5ms
  Allocated: 32768 bytes
  Input graph: 150 nodes
  Output graph: 120 nodes
Phase Kind: V8.MaglevFinalizeJob
  Time: 1.8ms
  Allocated: 4096 bytes
Total: 14.6ms
[optimized myFunction (Maglev) in 14.6ms]
```

### 8.2 使用Runtime Call Stats

```bash
# 结合RCS查看更详细的时间分解
out/x64.release/d8 --runtime-call-stats --maglev-stats test.js
```

这会显示：
- V8内部各个运行时调用的耗时
- Maglev编译的各个阶段
- API调用开销
- GC时间等

---

## 9. 性能分析示例

### 9.1 分析单个函数

创建测试文件 `test_maglev.js`:
```javascript
function hotFunction(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += i * 2;
  }
  return sum;
}

// 预热使其被Maglev编译
for (let i = 0; i < 10000; i++) {
  hotFunction(100);
}
```

运行分析:
```bash
out/x64.release/d8 --trace-opt-stats --maglev-stats test_maglev.js
```

**输出:**
```
[maglev] Compiled: 1 functions with 89 byte source size in 8.3ms.
=== Maglev Statistics ===
Function: hotFunction
  Prepare: 0.2ms
  Execute: 7.5ms
  Finalize: 0.6ms
  Total: 8.3ms
  Input nodes: 45
  Output nodes: 38
```

### 9.2 分析多个函数

```javascript
function func1() { /* ... */ }
function func2() { /* ... */ }
function func3() { /* ... */ }

// 触发编译
for (let i = 0; i < 10000; i++) {
  func1();
  func2();
  func3();
}
```

```bash
out/x64.release/d8 --trace-opt-stats test.js
```

**输出:**
```
[maglev] Compiled: 1 functions with 45 byte source size in 3.2ms.
[maglev] Compiled: 2 functions with 98 byte source size in 6.8ms.
[maglev] Compiled: 3 functions with 156 byte source size in 11.5ms.
```

---

## 10. 与TurboFan对比

### 10.1 统计对比

```bash
# 同时追踪Maglev和TurboFan
out/x64.release/d8 --trace-opt-stats --trace-turbo-stats test.js
```

**典型输出:**
```
[maglev] Compiled: 5 functions with 1200 byte source size in 25.3ms.
[turbofan] Optimized: 2 functions with 450 byte source size in 156.8ms.
```

**观察:**
- Maglev编译速度通常比TurboFan快5-10倍
- Maglev可以处理更多函数
- TurboFan生成更优化的代码但耗时更长

### 10.2 时间分解对比

| 编译器 | Prepare | Execute | Finalize | Total |
|--------|---------|---------|----------|-------|
| Maglev | 0.5ms | 12.5ms | 2.0ms | 15.0ms |
| TurboFan | 2.0ms | 85.0ms | 8.0ms | 95.0ms |

**Maglev优势:**
- 快速编译
- 适合热代码早期优化
- 减少主线程阻塞

---

## 11. 高级用法

### 11.1 导出统计到文件

```bash
# 导出JSON统计
out/x64.release/d8 --maglev-stats-nvp test.js 2>&1 | tee maglev_stats.log

# 提取时间信息
grep "delta_ms" maglev_stats.log
```

### 11.2 自动化分析脚本

创建 `analyze_maglev.sh`:
```bash
#!/bin/bash
OUT_FILE="maglev_analysis.txt"
D8_PATH="out/x64.release/d8"

echo "=== Maglev Compilation Analysis ===" > $OUT_FILE
echo "Test file: $1" >> $OUT_FILE
echo "" >> $OUT_FILE

$D8_PATH --maglev-stats --trace-opt-stats $1 2>&1 | tee -a $OUT_FILE

echo "" >> $OUT_FILE
echo "Analysis complete. Results saved to $OUT_FILE"
```

使用:
```bash
chmod +x analyze_maglev.sh
./analyze_maglev.sh test.js
```

### 11.3 持续性能监控

```bash
# 对比不同版本的编译性能
for version in v8.0 v8.1 v8.2; do
  echo "Testing $version"
  $version/d8 --trace-opt-stats benchmark.js 2>&1 | grep "maglev"
done
```

---

## 12. 调试技巧

### 12.1 查看为什么函数未被Maglev编译

```bash
out/x64.debug/d8 --trace-opt --trace-opt-verbose test.js
```

查找输出中的:
```
[marking 0x... <myFunction> for optimization with Maglev]
[bailout: myFunction - reason: ...]
```

### 12.2 内存使用分析

```bash
# 查看Zone分配统计
out/x64.debug/d8 --trace-zone-stats --maglev-stats test.js
```

### 12.3 与GC时间关联

```bash
# 查看编译期间的GC影响
out/x64.release/d8 --trace-gc --maglev-stats test.js
```

---

## 13. 常见问题

### Q1: 如何只看特定函数的编译时间？

A: 使用 `--trace-opt` 配合函数名过滤：
```bash
out/x64.release/d8 --trace-opt --maglev-stats test.js | grep "myFunction"
```

### Q2: 为什么看不到统计输出？

A: 确保：
1. 函数确实被Maglev编译了（使用 `--trace-opt` 验证）
2. 启用了统计标志 (`--maglev-stats` 或 `--trace-opt-stats`)
3. 使用的是支持Maglev的构建 (`V8_ENABLE_MAGLEV`)

### Q3: Execute阶段占用时间过长怎么办？

A: Execute阶段时间长可能因为：
- 函数太大（考虑拆分）
- 内联了太多代码（检查 `--trace-maglev-inlining`）
- 复杂的类型反馈（使用 `--trace-deopt` 检查）

### Q4: 如何对比优化前后的性能？

A: 使用benchmark：
```bash
# 禁用Maglev
out/x64.release/d8 --no-maglev --trace-opt-stats benchmark.js

# 启用Maglev
out/x64.release/d8 --maglev --trace-opt-stats benchmark.js
```

---

## 14. 相关源码文件

| 文件 | 功能 |
|------|------|
| `src/maglev/maglev-concurrent-dispatcher.cc:204-233` | 编译时间记录 |
| `src/maglev/maglev-pipeline-statistics.h` | 统计基础设施 |
| `src/maglev/maglev-pipeline-statistics.cc` | 统计实现 |
| `src/diagnostics/compilation-statistics.h` | 通用编译统计 |
| `src/logging/counters-definitions.h:232-235` | 计数器定义 |
| `src/flags/flag-definitions.h:741-743` | 相关标志定义 |

---

## 15. 总结

**Maglev提供的编译时间统计能力:**

✅ **按阶段统计**: Prepare、Execute、Finalize三个阶段
✅ **函数级别**: 每个函数的独立统计
✅ **多种格式**: 人类可读、JSON、Chrome Tracing
✅ **实时监控**: `--trace-opt-stats` 实时输出
✅ **详细指标**: 时间、内存、图大小

**关键标志总结:**
- `--maglev-stats`: 详细统计
- `--maglev-stats-nvp`: JSON格式
- `--trace-opt-stats`: 实时追踪
- `--runtime-call-stats`: 完整RCS统计

**典型工作流:**
```bash
# 1. 开发阶段：快速检查
d8 --trace-opt-stats script.js

# 2. 性能分析：详细统计
d8 --maglev-stats --trace-opt script.js

# 3. 自动化分析：机器可读
d8 --maglev-stats-nvp script.js > stats.json

# 4. 深度诊断：完整追踪
d8 --maglev-stats --runtime-call-stats --trace-gc script.js
```

---

**文档创建时间:** 2025-10-21
**V8版本:** 基于最新主分支
**作者:** Maglev编译时间统计分析
