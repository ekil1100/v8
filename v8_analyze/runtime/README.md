# 运行时机制 (Runtime Mechanisms)

本目录包含 V8 运行时执行相关的深入分析文档，涵盖栈帧、作用域、异常处理、中断机制等核心运行时主题。

## 文档列表

### 栈帧与调用约定

- **`stack_frame_layout.md`** - 栈帧布局详解
  - V8 各类栈帧的内存布局
  - 调用约定和参数传递
  - 帧指针（FP）和栈指针（SP）管理
  - 不同编译层级的栈帧差异

- **`function_entry_stack_check.md`** - 函数入口栈检查
  - 栈溢出检查机制
  - 栈限制（Stack Limit）的实现
  - 递归调用的保护机制

### 作用域系统

- **`scope_info_deep_dive.md`** - ScopeInfo 深度剖析
  - 作用域信息的存储结构
  - 变量查找和闭包实现
  - Context 和 ScopeInfo 的关系
  - 词法作用域的运行时表示

### 中断与预算

- **`interrupt_budget_deep_dive.md`** - 中断预算机制详解
  - 中断预算（Interrupt Budget）的作用
  - 分层编译的触发条件
  - OSR（On-Stack Replacement）时机
  - 热点代码检测

### 异常处理

- **`exception_handler_mapping.md`** - 异常处理器映射
  - Try-Catch-Finally 的实现
  - 异常处理表（Handler Table）
  - 异常传播机制
  - 栈展开（Stack Unwinding）

- **`pending_message_deep_dive.md`** - 待处理消息机制
  - PendingMessage 的作用
  - 错误消息的延迟处理
  - 异常上下文保存

## 相关主题

这些运行时机制在以下场景中被广泛使用：

- **`../maglev/`** - Maglev 编译的代码需要遵循这些运行时约定
- **`../framestate/`** - FrameState 依赖栈帧和作用域信息
- **`../optimization/`** - 反优化需要恢复运行时状态

## 快速导航

**想了解函数调用机制？**
→ 从 `stack_frame_layout.md` 开始

**想了解作用域和闭包？**
→ 阅读 `scope_info_deep_dive.md`

**想了解异常如何工作？**
→ 查看 `exception_handler_mapping.md` 和 `pending_message_deep_dive.md`

**想了解编译触发机制？**
→ 参考 `interrupt_budget_deep_dive.md`

**想了解栈溢出检测？**
→ 查看 `function_entry_stack_check.md`

## 学习建议

1. **基础顺序**：建议按以下顺序学习
   - stack_frame_layout.md（运行时基础）
   - scope_info_deep_dive.md（作用域系统）
   - exception_handler_mapping.md（异常处理）

2. **调试实践**：使用 `--trace-opt`、`--trace-deopt` 等标志观察运行时行为

3. **结合编译器**：理解运行时约束有助于理解编译器的代码生成

## 关键概念

- **栈帧（Stack Frame）**：函数调用的运行时状态
- **Context**：作用域链的运行时表示
- **中断预算**：控制编译层级转换的计数器
- **Handler Table**：异常处理器的索引表

---

**注意**：这些文档是个人学习笔记，建议以 V8 官方文档和源码为准。
