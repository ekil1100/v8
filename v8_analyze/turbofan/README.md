# TurboFan/Turboshaft 分析 (TurboFan/Turboshaft Analysis)

本目录包含 V8 高级优化编译器 TurboFan 和新一代编译器 Turboshaft 的分析文档。

## 文档列表

- **`turbolev_shared_backend_analysis.md`** - Maglev/TurboFan 共享后端分析
  - Maglev 和 TurboFan 的后端共享机制
  - 寄存器分配器的共享
  - 代码生成阶段的复用
  - 两个编译器的差异和联系

## TurboFan 概述

**TurboFan** 是 V8 的高层优化编译器，位于编译管线的最顶层：

```
Ignition → Sparkplug → Maglev → TurboFan/Turboshaft
(解释器) (快速基线) (中层优化) (高级优化)
```

### 主要特性

- **基于 Sea-of-Nodes IR**：图形化中间表示
- **激进的推测性优化**：基于类型反馈进行大胆假设
- **内联**：积极的函数内联
- **逃逸分析**：标量替换和对象消除
- **循环优化**：循环不变量外提、边界检查消除
- **常量折叠和传播**：编译时计算

## Turboshaft 概述

**Turboshaft** 是 TurboFan 的继任者，采用新的编译器架构：

- **基于 CFG 的 IR**：更结构化的中间表示
- **更快的编译速度**：改进的算法和数据结构
- **更好的可维护性**：更清晰的代码结构
- **渐进式替换**：逐步替换 TurboFan 的各个阶段

### 状态（2024年）

Turboshaft 正在逐步替换 TurboFan，两者目前共存：
- 一些优化pass已经迁移到 Turboshaft
- 后端代码生成仍然共享
- 最终将完全替换 TurboFan

## 共享后端

Maglev 和 TurboFan/Turboshaft 共享部分后端实现：

### 共享的组件

1. **寄存器分配器**（部分）
   - 线性扫描算法
   - 溢出处理

2. **指令选择**（部分）
   - 机器码生成
   - 平台特定优化

3. **代码对象管理**
   - Code 对象创建
   - 元数据管理

### 差异点

- **IR 表示**：Maglev 使用自己的 IR，TurboFan 使用 Sea-of-Nodes
- **优化策略**：TurboFan 更激进，Maglev 更保守
- **编译时间**：Maglev 更快，TurboFan 更慢但优化更好

## 源码位置

```
src/compiler/              # TurboFan 主要代码
src/compiler/turboshaft/   # Turboshaft 代码
src/maglev/                # Maglev 代码
src/codegen/               # 共享的代码生成
```

## 可视化工具

### Turbolizer

TurboFan/Turboshaft 提供强大的可视化工具：

```bash
# 生成可视化数据
out/x64.debug/d8 --trace-turbo script.js

# 使用 Turbolizer 查看
# https://v8.github.io/turbolizer/
```

Turbolizer 可以展示：
- 编译图的各个阶段
- 节点之间的依赖关系
- 优化 pass 的效果
- 最终生成的代码

## 相关标志

### TurboFan 调试标志

```bash
# 追踪 TurboFan 编译
--trace-turbo

# 打印优化代码
--print-opt-code

# 详细的优化信息
--trace-opt-verbose

# 追踪内联
--trace-turbo-inlining

# 追踪逃逸分析
--trace-turbo-escape
```

### Turboshaft 调试标志

```bash
# 追踪 Turboshaft
--trace-turboshaft

# Turboshaft 图可视化
--trace-turboshaft-graph
```

## 学习资源

### V8 官方资源

- **V8 Blog**: https://v8.dev/blog
  - TurboFan 设计文章
  - Turboshaft 介绍文章

- **V8 Docs**: https://v8.dev/docs
  - 编译器架构文档

### 源码学习

推荐阅读顺序：

1. **基础概念**
   - `src/compiler/node.h` - Node 的定义
   - `src/compiler/graph.h` - Graph 的结构

2. **优化 Pass**
   - `src/compiler/typed-optimization.cc` - 类型优化
   - `src/compiler/escape-analysis.cc` - 逃逸分析
   - `src/compiler/inlining.cc` - 内联

3. **Turboshaft**
   - `src/compiler/turboshaft/operations.h` - Turboshaft IR
   - `src/compiler/turboshaft/optimization-phase.h` - 优化阶段

## 性能对比

### 编译时间（相对）

```
Sparkplug:  1x  (最快)
Maglev:     5x
TurboFan:   50x (最慢但最优)
```

### 代码质量（相对）

```
Sparkplug:  1x  (基线)
Maglev:     2x  (中等优化)
TurboFan:   5x  (最高优化)
```

### 何时使用

- **Sparkplug**: 快速启动，基本性能
- **Maglev**: 平衡编译时间和性能，适合大多数代码
- **TurboFan**: 热点代码，追求极致性能

## 相关主题

- **`../maglev/`** - Maglev 编译器分析
- **`../compiler/`** - 编译器核心机制
- **`../optimization/`** - 优化技术详解
- **`../debugging/`** - 调试工具和方法

## 未来展望

- **Turboshaft 完全替换 TurboFan**：预计在未来版本完成
- **更快的编译速度**：持续优化编译性能
- **更好的优化**：引入新的优化技术

---

**注意**：这些文档是个人学习笔记，建议以 V8 官方文档和源码为准。
