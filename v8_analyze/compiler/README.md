# 编译器核心机制 (Compiler Core)

本目录包含 V8 编译器核心机制的深入分析文档，涵盖控制流、节点系统、寄存器分配等关键主题。

## 文档列表

### 控制流与基本块

- **`block_splitting_rules.md`** - 基本块分割规则详解
  - 基本块的定义和分割条件
  - 控制流图（CFG）构建规则
  - 分支、循环等控制结构的处理

### 节点系统

- **`node_id_and_value_tracking.md`** - 节点 ID 和值追踪机制
  - 节点标识符分配策略
  - SSA 形式和值编号
  - 节点生命周期管理

- **`phi_node_deep_dive.md`** - Phi 节点深度剖析
  - Phi 节点的作用和生成
  - SSA 形式中的 Phi 函数
  - 控制流合并点的值合并

### 循环优化

- **`loop_effects_deep_dive.md`** - 循环效果分析
  - 循环不变量检测
  - 循环副作用（side effects）分析
  - 循环优化的基础

### 寄存器分配

- **`live_range_and_register_allocation.md`** - 活跃区间与寄存器分配
  - 活跃区间（Live Range）分析
  - 线性扫描寄存器分配算法
  - 寄存器溢出（Spilling）处理
  - 移动消除（Move Elimination）

## 相关主题

这些文档与以下目录的内容密切相关：

- **`../maglev/`** - Maglev 编译器应用这些核心机制
- **`../turbofan/`** - TurboFan 编译器的高级应用
- **`../optimization/`** - 基于这些机制的优化技术

## 快速导航

**想了解控制流图构建？**
→ 从 `block_splitting_rules.md` 开始

**想了解 SSA 形式？**
→ 阅读 `phi_node_deep_dive.md` 和 `node_id_and_value_tracking.md`

**想了解寄存器分配？**
→ 查看 `live_range_and_register_allocation.md`

**想了解循环优化？**
→ 参考 `loop_effects_deep_dive.md`

## 学习建议

1. **基础顺序**：建议按以下顺序学习
   - block_splitting_rules.md（控制流基础）
   - node_id_and_value_tracking.md（节点系统）
   - phi_node_deep_dive.md（SSA 形式）

2. **实践验证**：配合 `../test-cases/` 中的测试用例验证理解

3. **源码参考**：文档中引用了大量源码位置，建议对照阅读

---

**注意**：这些文档是个人学习笔记，建议以 V8 官方文档和源码为准。
