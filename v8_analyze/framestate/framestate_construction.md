# FrameState 构建流程分析

## 总结

**FrameState 在图构建（Graph Building）阶段就开始构建，并在每个需要反优化的节点处附加。**

---

## 三个关键阶段

### 1️⃣ **初始化阶段**（构造函数）

**时机：** MaglevGraphBuilder 构造时

**代码位置：** `src/maglev/maglev-graph-builder.cc:1137-1141`

```cpp
current_interpreter_frame_(
    *compilation_unit_,
    is_inline() ? caller_details->known_node_aspects
                : compilation_unit_->zone()->New<KnownNodeAspects>(
                      compilation_unit_->zone())),
```

**说明：**
- 创建 `InterpreterFrameState` 对象
- 初始化 `KnownNodeAspects`（节点类型和优化信息）
- 设置初始的虚拟对象列表

---

### 2️⃣ **图构建阶段**（逐字节码构建）

**入口：** `BuildGraph()` → `BuildBody()` → `VisitSingleBytecode()`

**代码位置：** `src/maglev/maglev-graph-builder.cc:15905-15954`

```cpp
void MaglevGraphBuilder::BuildGraph() {
  // ... 省略前置代码 ...

  StartPrologue();

  // 1. 创建参数节点
  for (int i = 0; i < parameter_count(); i++) {
    InitialValue* v = AddNewNodeNoInputConversion<InitialValue>(
        {}, interpreter::Register::FromParameterIndex(i));
    graph()->parameters().push_back(v);
    SetArgument(i, v);  // ← 更新 current_interpreter_frame_
  }

  // 2. 初始化寄存器帧
  BuildRegisterFrameInitialization();

  // 3. 创建入口栈检查（附带 DeoptFrame）
  FunctionEntryStackCheck* function_entry_stack_check =
      NodeBase::New<FunctionEntryStackCheck>(zone(), 0);
  new (function_entry_stack_check->lazy_deopt_info()) LazyDeoptInfo(
      zone(), GetDeoptFrameForEntryStackCheck(),  // ← 第一个 DeoptFrame！
      interpreter::Register::invalid_value(), 0,
      compiler::FeedbackSource());

  // 4. 构建合并状态
  BuildMergeStates();
  EndPrologue();

  // 5. 遍历字节码，逐条构建
  BuildBody();
}
```

**BuildBody 循环：** `src/maglev/maglev-graph-builder.cc:15957-15979`

```cpp
void MaglevGraphBuilder::BuildBody() {
  for (iterator_.SetOffset(entrypoint_); !iterator_.done();
       iterator_.Advance()) {
    // 对每个字节码调用 VisitSingleBytecode()
    if (VisitSingleBytecode().IsDoneWithAbort()) {
      MarkBytecodeDead();
    }
  }
}
```

**VisitSingleBytecode：** `src/maglev/maglev-graph-builder.cc:16250-16260`

```cpp
ReduceResult MaglevGraphBuilder::VisitSingleBytecode() {
  int offset = iterator_.current_offset();
  UpdateSourceAndBytecodePosition(offset);

  // 根据字节码类型分发
  switch (iterator_.current_bytecode()) {
    case Bytecode::kLdar:
      return VisitLdar();
    case Bytecode::kAdd:
      return VisitAdd();
    // ... 其他字节码 ...
  }
}
```

**每个字节码操作都会：**
1. 读取 `current_interpreter_frame_` 的当前状态
2. 创建新的 IR 节点
3. 更新 `current_interpreter_frame_` 的状态

---

### 3️⃣ **DeoptFrame 附加阶段**（创建需要反优化的节点时）

**时机：** 每次创建可能触发反优化的节点时

**代码位置：** `src/maglev/maglev-graph-builder.cc:1535-1563`

```cpp
DeoptFrame* MaglevGraphBuilder::GetLatestCheckpointedFrame() {
  if (in_prologue_) {
    return GetDeoptFrameForEntryStackCheck();
  }

  if (!latest_checkpointed_frame_) {
    // 对虚拟对象做快照
    current_interpreter_frame_.virtual_objects().Snapshot();

    // 创建 InterpretedDeoptFrame
    latest_checkpointed_frame_ = zone()->New<InterpretedDeoptFrame>(
        *compilation_unit_,
        // ← 从 current_interpreter_frame_ 创建 CompactInterpreterFrameState
        zone()->New<CompactInterpreterFrameState>(
            *compilation_unit_,
            GetInLiveness(),
            current_interpreter_frame_),  // ← 当前帧状态快照！
        GetClosure(),
        current_interpreter_frame_.virtual_objects().head(),
        BytecodeOffset(iterator_.current_offset()),  // ← 字节码偏移
        GetCurrentSourcePosition(),
        GetCallerDeoptFrame());

    // 标记所有帧状态中的节点为 deopt use
    latest_checkpointed_frame_->as_interpreted().frame_state()->ForEachValue(
        *compilation_unit_,
        [&](ValueNode* node, interpreter::Register) {
          AddDeoptUse(node);  // ← 防止节点被过早优化掉
        });

    // 处理 eager deopt scope
    const EagerDeoptFrameScope* deopt_scope = current_eager_deopt_scope_;
    if (deopt_scope != nullptr) {
      latest_checkpointed_frame_ = zone()->New<DeoptFrame>(
          deopt_scope->data(),
          RecursivelyWrapDeoptFrameWithContinuations(...));
    }
  }
  return latest_checkpointed_frame_;
}
```

---

## 完整的调用链示例

以 `CheckedSmiUntag` 节点为例：

```
1. VisitAdd()
   └─> current_interpreter_frame_.get(reg)  // 读取当前帧状态
   └─> AddNewNode<CheckedSmiUntag>(value)
       └─> Reducer::AddNode()
           └─> node->set_eager_deopt_info(
                   EagerDeoptInfo(GetLatestCheckpointedFrame()))
                       └─> GetLatestCheckpointedFrame()
                           └─> new InterpretedDeoptFrame(
                                   CompactInterpreterFrameState(
                                       current_interpreter_frame_))
```

---

## 代码引用汇总

### 构造时初始化

```
src/maglev/maglev-graph-builder.cc:1137-1141
```

### 图构建入口

```
src/maglev/maglev-graph-builder.cc:15905 (BuildGraph)
src/maglev/maglev-graph-builder.cc:15957 (BuildBody)
src/maglev/maglev-graph-builder.cc:16250 (VisitSingleBytecode)
```

### DeoptFrame 创建

```
src/maglev/maglev-graph-builder.cc:1535 (GetLatestCheckpointedFrame)
src/maglev/maglev-graph-builder.cc:1541 (InterpretedDeoptFrame 构造)
src/maglev/maglev-graph-builder.cc:1543 (CompactInterpreterFrameState 构造)
```

### 入口栈检查

```
src/maglev/maglev-graph-builder.cc:1667 (GetDeoptFrameForEntryStackCheck)
src/maglev/maglev-graph-builder.cc:15931 (FunctionEntryStackCheck + LazyDeoptInfo)
```

---

## InterpreterFrameState 的维护

`current_interpreter_frame_` 在整个图构建过程中被不断更新：

### 读取操作

```cpp
// VisitLdar - 加载累加器
void MaglevGraphBuilder::VisitLdar() {
  ValueNode* value = current_interpreter_frame_.get(
      iterator_.GetRegisterOperand(0));  // ← 读取寄存器
  SetAccumulator(value);
}
```

### 写入操作

```cpp
// VisitStar - 存储累加器
void MaglevGraphBuilder::VisitStar() {
  ValueNode* accumulator = GetAccumulator();  // ← 读取累加器
  current_interpreter_frame_.set(
      iterator_.GetRegisterOperand(0),
      accumulator);  // ← 更新寄存器
}
```

### 类型推导

```cpp
// VisitAdd - 加法
void MaglevGraphBuilder::VisitAdd() {
  ValueNode* left = GetAccumulator();
  ValueNode* right = GetRegister(0);

  // 查询 KnownNodeAspects（存储在 current_interpreter_frame_ 中）
  NodeInfo* left_info =
      current_interpreter_frame_.known_node_aspects()
          ->GetOrCreateInfoFor(broker(), left);

  // 使用缓存的 int32 表示
  ValueNode* left_int32 = left_info->alternative().int32();
  // ...
}
```

---

## 关键数据结构

### InterpreterFrameState

```cpp
// src/maglev/maglev-interpreter-frame-state.h:34
class InterpreterFrameState {
 private:
  RegisterFrameArray<ValueNode*> frame_;       // 寄存器数组
  KnownNodeAspects* known_node_aspects_;       // 优化信息
};
```

**维护：**
- 每个寄存器的当前值（ValueNode*）
- 累加器的当前值
- 每个节点的已知类型和替代表示

### CompactInterpreterFrameState

```cpp
// src/maglev/maglev-interpreter-frame-state.h:105
class CompactInterpreterFrameState {
 private:
  ValueNode** const live_registers_and_accumulator_;  // 只保存活跃的
  const compiler::BytecodeLivenessState* const liveness_;
};
```

**创建时机：** DeoptFrame 创建时，从 InterpreterFrameState 压缩

**目的：** 节省内存，只保存活跃的寄存器

### InterpretedDeoptFrame

```cpp
// src/maglev/maglev-ir.h
struct InterpretedDeoptFrame {
  MaglevCompilationUnit* unit;
  CompactInterpreterFrameState* frame_state;  // ← 帧状态快照
  ValueNode* closure;
  VirtualObject* last_virtual_object;
  BytecodeOffset bytecode_position;           // ← 字节码偏移
  SourcePosition source_position;
  DeoptFrame* parent;                         // ← 内联调用链
};
```

---

## 时间线总结

```
t0: MaglevGraphBuilder 构造
    └─> current_interpreter_frame_ 初始化

t1: BuildGraph() 开始
    └─> 创建参数节点 (InitialValue)
    └─> 第一个 DeoptFrame (FunctionEntryStackCheck)

t2: BuildBody() 循环
    对每个字节码：
    ├─> VisitSingleBytecode()
    │   ├─> 读取 current_interpreter_frame_
    │   ├─> 创建 IR 节点
    │   └─> 更新 current_interpreter_frame_
    │
    └─> 如果节点需要反优化支持：
        └─> GetLatestCheckpointedFrame()
            └─> new InterpretedDeoptFrame(
                    CompactInterpreterFrameState(
                        current_interpreter_frame_))  ← 快照！

t3: 图构建完成
    所有需要反优化的节点都附带了 DeoptFrame
```

---

## 答案

### FrameState 是在哪个阶段构建的？

**答案：在图构建（Graph Building）阶段，随着字节码逐条处理而构建。**

### 一开始图构建的时候就构建了吗？

**答案：是的！**
1. **初始化：** 构造函数创建 `current_interpreter_frame_`
2. **实时维护：** 每处理一条字节码，更新 `current_interpreter_frame_`
3. **按需快照：** 创建需要反优化的节点时，从 `current_interpreter_frame_` 快照生成 `DeoptFrame`

### 核心流程

```
图构建开始
    ↓
current_interpreter_frame_ 初始化
    ↓
for each bytecode:
    ├─ 读取 current_interpreter_frame_
    ├─ 创建 IR 节点
    ├─ 更新 current_interpreter_frame_
    └─ if (节点需要 deopt):
           └─ 从 current_interpreter_frame_ 创建 DeoptFrame 快照
    ↓
图构建完成
```

**关键点：FrameState 不是事后添加的，而是在图构建过程中实时维护和快照的！**
