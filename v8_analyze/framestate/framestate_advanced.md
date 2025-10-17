# FrameState 深度解析：生命周期、复用与 GC 安全性

## 目录

1. [FrameState 的三个层次](#1-framestate-的三个层次)
2. [DeoptFrame 的创建时机与复用](#2-deoptframe-的创建时机与复用)
3. [DeoptInfo 与寄存器分配](#3-deoptinfo-与寄存器分配)
4. [Deoptimization 与 GC 的关系](#4-deoptimization-与-gc-的关系)
5. [完整示例：从字节码到 Deopt](#5-完整示例从字节码到-deopt)

---

## 1. FrameState 的三个层次

### 1.1 回答：FrameState 是每个字节码一个吗？

**❌ 不是每个字节码一个！** 让我们理清三个概念：

#### InterpreterFrameState - 唯一的工作状态

```cpp
// src/maglev/maglev-graph-builder.h:1992
class MaglevGraphBuilder {
 private:
  InterpreterFrameState current_interpreter_frame_;  // ← 唯一实例！
};
```

**特点：**
- **唯一性**：整个编译过程只有一个 `current_interpreter_frame_`
- **可变性**：每处理一条字节码就更新它
- **不是快照**：只是编译器的"工作内存"

**生命周期：**
```
构造 MaglevGraphBuilder
    ↓
current_interpreter_frame_ 初始化
    ↓
for each bytecode:
    current_interpreter_frame_.get(reg)      // 读取
    current_interpreter_frame_.set(reg, val)  // 更新
    ↓
BuildGraph() 完成
```

#### DeoptFrame - 按需创建的快照

```cpp
// src/maglev/maglev-graph-builder.h:1976
class MaglevGraphBuilder {
 private:
  DeoptFrame* latest_checkpointed_frame_ = nullptr;  // ← 缓存当前快照
};
```

**创建时机：**
```cpp
// src/maglev/maglev-graph-builder.cc:1535
DeoptFrame* MaglevGraphBuilder::GetLatestCheckpointedFrame() {
  if (!latest_checkpointed_frame_) {  // ← 检查缓存
    // 创建快照
    latest_checkpointed_frame_ = zone()->New<InterpretedDeoptFrame>(
        *compilation_unit_,
        zone()->New<CompactInterpreterFrameState>(
            *compilation_unit_, GetInLiveness(), current_interpreter_frame_),
        // ↑ 从 current_interpreter_frame_ 快照
        GetClosure(),
        current_interpreter_frame_.virtual_objects().head(),
        BytecodeOffset(iterator_.current_offset()),
        GetCurrentSourcePosition(),
        GetCallerDeoptFrame());
  }
  return latest_checkpointed_frame_;  // ← 返回缓存
}
```

**特点：**
- **懒创建**：只在需要 deopt 支持的节点处创建
- **可复用**：同一字节码偏移的多个节点共享同一个 DeoptFrame
- **不可变**：一旦创建，内容不变

#### MergePointInterpreterFrameState - 控制流汇合点

```cpp
// src/maglev/maglev-interpreter-frame-state.h:291
class MergePointInterpreterFrameState {
 private:
  CompactInterpreterFrameState frame_state_;  // ← 包含紧凑帧状态
  Phi::List phis_;                            // ← Phi 节点
  BasicBlock** predecessors_;                 // ← 前驱列表
};
```

**特点：**
- **只在合并点**：if-else 汇合、循环头、异常处理器
- **包含 CompactInterpreterFrameState**：不是替代关系
- **管理 Phi 节点**：合并不同路径的值

### 1.2 三者关系图

```
┌──────────────────────────────────────────────────────────────┐
│ MaglevGraphBuilder                                           │
│                                                               │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ InterpreterFrameState current_interpreter_frame_       │   │
│ │ ┌────────────────────────────────────────────────────┐ │   │
│ │ │ RegisterFrameArray frame_                          │ │   │
│ │ │ [param0, param1, ..., r0, r1, ..., acc]           │ │   │
│ │ │ 每条字节码都更新这个数组                             │ │   │
│ │ └────────────────────────────────────────────────────┘ │   │
│ │ KnownNodeAspects* known_node_aspects_                  │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ DeoptFrame* latest_checkpointed_frame_  ← 缓存的快照         │
│        │                                                      │
│        ↓ 创建时机                                             │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ 当节点需要 deopt 支持时：                               │   │
│ │   CheckedSmiUntag                                       │   │
│ │   Int32AddWithOverflow                                  │   │
│ │   LoadField (可能触发 deopt)                            │   │
│ │   ...                                                   │   │
│ └────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────┐
│ MergePointInterpreterFrameState (控制流汇合点)               │
│                                                               │
│ CompactInterpreterFrameState frame_state_                    │
│ ┌────────────────────────────────────────────────────────┐   │
│ │ ValueNode** live_registers_and_accumulator_            │   │
│ │ [param0, param1, r0, acc]  ← 只存储活跃的               │   │
│ └────────────────────────────────────────────────────────┘   │
│                                                               │
│ Phi::List phis_  ← 合并点创建的 Phi 节点                     │
│ BasicBlock** predecessors_  ← 前驱块列表                     │
│ KnownNodeAspects* known_node_aspects_  ← 合并后的优化信息    │
└──────────────────────────────────────────────────────────────┘
```

---

## 2. DeoptFrame 的创建时机与复用

### 2.1 创建时机

#### 何时创建 DeoptFrame？

只在以下情况创建：

1. **Eager Deopt 节点**（立即反优化）
   ```cpp
   CheckedSmiUntag(value)  // 检查是否为 Smi，不是则立即 deopt
   CheckMaps(object, maps) // 检查对象 Map，不匹配则 deopt
   CheckedFloat64Unbox(value)  // 检查是否为 HeapNumber
   ```

2. **Lazy Deopt 节点**（延迟反优化）
   ```cpp
   CallRuntime(...)  // 调用可能触发 deopt 的 runtime 函数
   CallBuiltin(...)  // 调用 builtin
   LoadField(...) with feedback  // 带反馈的属性加载
   ```

3. **Checkpoint 节点**（检查点）
   ```cpp
   FunctionEntryStackCheck  // 函数入口栈检查
   ```

#### 实际代码位置

```cpp
// src/maglev/maglev-graph-builder.cc:1535-1563
DeoptFrame* MaglevGraphBuilder::GetLatestCheckpointedFrame() {
  if (in_prologue_) {
    return GetDeoptFrameForEntryStackCheck();  // Prologue 特殊处理
  }

  if (!latest_checkpointed_frame_) {  // ← 缓存检查
    // === 第一步：快照虚拟对象 ===
    current_interpreter_frame_.virtual_objects().Snapshot();

    // === 第二步：创建 DeoptFrame ===
    latest_checkpointed_frame_ = zone()->New<InterpretedDeoptFrame>(
        *compilation_unit_,
        // 创建紧凑的帧状态快照
        zone()->New<CompactInterpreterFrameState>(
            *compilation_unit_,
            GetInLiveness(),
            current_interpreter_frame_),  // ← 从当前状态快照
        GetClosure(),
        current_interpreter_frame_.virtual_objects().head(),
        BytecodeOffset(iterator_.current_offset()),  // ← 字节码偏移
        GetCurrentSourcePosition(),
        GetCallerDeoptFrame());

    // === 第三步：标记所有值为 deopt use ===
    latest_checkpointed_frame_->as_interpreted().frame_state()->ForEachValue(
        *compilation_unit_,
        [&](ValueNode* node, interpreter::Register) {
          AddDeoptUse(node);  // ← 防止节点被 DCE 删除
        });

    // === 第四步：处理 EagerDeoptFrameScope（如果存在）===
    const EagerDeoptFrameScope* deopt_scope = current_eager_deopt_scope_;
    if (deopt_scope != nullptr) {
      // 包装 builtin continuation frame
      latest_checkpointed_frame_ = zone()->New<DeoptFrame>(
          deopt_scope->data(),
          RecursivelyWrapDeoptFrameWithContinuations(...));
    }
  }
  return latest_checkpointed_frame_;  // ← 返回缓存或新创建的
}
```

### 2.2 Deopt Use 机制详解

#### 什么是 Deopt Use？

**Deopt Use** 是一种引用计数机制，用于防止 Dead Code Elimination (DCE) 过早删除 DeoptFrame 中引用的节点。

#### use_count_ 追踪

**源代码位置：** `src/maglev/maglev-ir.h:2872-2884, 3027`

```cpp
class ValueNode : public Node {
 public:
  int use_count() const {
    DCHECK(!unused_inputs_were_visited());
    return use_count_;
  }

  bool is_used() const { return use_count_ > 0; }

  bool unused_inputs_were_visited() const { return use_count_ == -1; }

  void add_use() {
    // Make sure a saturated use count won't overflow.
    DCHECK_LT(use_count_, kMaxInt);
    use_count_++;
  }

  inline void remove_use();

 protected:
  explicit ValueNode(uint64_t bitfield) : Node(bitfield), use_count_(0) {}
  int use_count_;  // ← 引用计数器
};
```

#### AddDeoptUse 实现

**源代码位置：** `src/maglev/maglev-graph-builder.cc:16897-16912`

```cpp
void MaglevGraphBuilder::AddDeoptUse(ValueNode* node) {
  if (node == nullptr) return;
  DCHECK(!node->Is<VirtualObject>());

  if (InlinedAllocation* alloc = node->TryCast<InlinedAllocation>()) {
    VirtualObject* vobject =
        current_interpreter_frame_.virtual_objects().FindAllocatedWith(alloc);
    if (vobject) {
      AddDeoptUse(vobject);
      AddNonEscapingUses(alloc, 1);
    }
    alloc->add_use();  // ← 增加引用计数
  } else {
    node->add_use();   // ← 增加引用计数！
  }
}
```

#### DCE 如何检查 use_count？

**源代码位置：** `src/maglev/maglev-post-hoc-optimizations-processors.h:527-529`

```cpp
class DeadNodeSweepingProcessor {
  template <typename NodeT>
  ProcessResult Process(NodeT* node, const ProcessingState& state) {
    if constexpr (IsValueNode(Node::opcode_of<NodeT>) &&
                  (!NodeT::kProperties.is_required_when_unused() ||
                   std::is_same_v<ArgumentsElements, NodeT>)) {
      if (!node->is_used()) {  // ← 检查 use_count_ > 0
        return ProcessResult::kRemove;  // ← 删除未使用的节点
      }
      return ProcessResult::kContinue;
    }
    // ...
  }
};
```

**执行时机：** Post-hoc optimization 阶段，在寄存器分配之前。

#### 为什么需要 AddDeoptUse？

**问题：** 如果节点被 DCE 删除，DeoptFrame 引用会消失吗？

**答案：❌ 不会！**

**原因：**
1. `AddDeoptUse(node)` 增加了 `node->use_count_`
2. DCE 检查 `!node->is_used()` (即 `use_count_ == 0`)
3. 只要 DeoptFrame 引用了节点，`use_count_ > 0`，DCE 就不会删除它

**示例：**

```
初始状态：
  ValueNode* smi_value = ...;
  smi_value->use_count_ = 0;  // 没有其他地方使用

创建 DeoptFrame：
  AddDeoptUse(smi_value);
  → smi_value->use_count_ = 1;  // ← 现在有 deopt use！

DCE 检查：
  if (!smi_value->is_used()) {  // use_count_ == 1，条件为 false
    remove(smi_value);  // ← 不会执行
  }
```

#### 为什么不连 DeoptFrame 一起删？

**答案：DeoptFrame 是反优化的关键数据，不能删除！**

**原因：**

1. **运行时需要：** 当优化代码触发 deopt 时（如类型检查失败），需要 DeoptFrame 重建解释器帧
2. **安全保证：** 所有可能 deopt 的节点都必须有 DeoptFrame，否则无法回退到解释器
3. **生命周期不同：**
   - **节点**：编译时的 IR，可能被优化掉
   - **DeoptFrame**：运行时的救生索，必须保留到代码生成阶段

### 2.3 复用机制

#### 何时复用 DeoptFrame？

**场景：同一字节码偏移的多个节点**

**核心概念：** 一条字节码可能生成多个 IR 节点，这些节点共享同一个 DeoptFrame。

**JavaScript 代码示例：**

```javascript
function add(x, y) {
  return x + y;  // offset 5
}
```

**字节码（简化）：**

```
offset  bytecode
0       LdaSmi [0]
5       Add r0, [0]    ← 一条字节码
10      Return
```

**IR 节点（offset 5 生成多个节点）：**

字节码 `Add r0, [0]` 展开成：

```cpp
// 所有这些节点都对应字节码 offset 5！

// 1. 检查左操作数是否是 Smi
ValueNode* left_check = CheckedSmiUntag(left);

// 2. 检查右操作数是否是 Smi
ValueNode* right_check = CheckedSmiUntag(right);

// 3. 执行 int32 加法（带溢出检查）
ValueNode* int32_result = Int32AddWithOverflow(left_check, right_check);

// 4. 转回 Smi
ValueNode* smi_result = Int32ToNumber(int32_result);
```

**关键点：** 这 4 个节点都属于 **字节码 offset 5**！

**复用流程：**

```cpp
// 字节码 offset 5: Add r0, [0]

// ========== 第一个节点 ==========
ValueNode* left_check = AddNewNode<CheckedSmiUntag>(left);
    ↓
调用 GetLatestCheckpointedFrame()
    ↓
latest_checkpointed_frame_ == null  ← 缓存为空
    ↓
创建 DeoptFrame_5 (bytecode_offset = 5, 包含 x, y, r0 的状态)
    ↓
返回 DeoptFrame_5
    ↓
left_check->set_eager_deopt_info(DeoptFrame_5)

// ========== 第二个节点（复用 DeoptFrame）==========
ValueNode* right_check = AddNewNode<CheckedSmiUntag>(right);
    ↓
调用 GetLatestCheckpointedFrame()
    ↓
latest_checkpointed_frame_ != null  ← 缓存命中！
    ↓
直接返回 DeoptFrame_5  ← 复用！
    ↓
right_check->set_eager_deopt_info(DeoptFrame_5)

// ========== 第三个节点（继续复用）==========
ValueNode* int32_add = AddNewNode<Int32AddWithOverflow>(left_check, right_check);
    ↓
调用 GetLatestCheckpointedFrame()
    ↓
返回 DeoptFrame_5  ← 继续复用！
    ↓
int32_add->set_eager_deopt_info(DeoptFrame_5)
```

#### 何时清除缓存？

**1. 字节码边界**

```cpp
// src/maglev/maglev-graph-builder.h:2053
void MarkNodeContextEffects() {
  latest_checkpointed_frame_ = nullptr;  // ← 清除缓存
  // ...
}
```

**2. 副作用操作**

```cpp
// src/maglev/maglev-graph-builder.h:2073-2076
if constexpr (NodeT::kProperties.can_write() ||
             (NodeT::kProperties.can_throw() ||
              NodeT::kProperties.can_allocate())) {
  ClearCurrentAllocationBlock();
  // latest_checkpointed_frame_ 也会被清除
}
```

**3. 内联调用边界**

```cpp
// src/maglev/maglev-graph-builder.cc:8466
latest_checkpointed_frame_ = nullptr;
ClearCurrentAllocationBlock();
```

### 2.4 复用示例（更正版）

```javascript
function complexAdd(a, b, c) {
  let x = a + b;    // 偏移 5
  let y = x + c;    // 偏移 10
  return y + 100;   // 偏移 15
}
```

**Maglev 编译过程：**

```
偏移 5 (a + b):
  latest_checkpointed_frame_ == null
  ↓
  创建 DeoptFrame_5 (包含 a, b, c 的状态)
  ↓
  n1 = CheckedSmiUntag(a) → deopt_info = DeoptFrame_5
  n2 = CheckedSmiUntag(b) → deopt_info = DeoptFrame_5  ← 复用！
  n3 = Int32AddWithOverflow(n1, n2) → deopt_info = DeoptFrame_5  ← 复用！

偏移 10 (x + c):
  latest_checkpointed_frame_ = null  ← 字节码边界清除
  ↓
  创建 DeoptFrame_10 (包含 x, c 的状态)  ← 注意：只有 x, c，没有 y
  ↓
  n4 = CheckedSmiUntag(x) → deopt_info = DeoptFrame_10
  n5 = CheckedSmiUntag(c) → deopt_info = DeoptFrame_10  ← 复用！
  n6 = Int32AddWithOverflow(n4, n5) → deopt_info = DeoptFrame_10  ← 复用！

偏移 15 (y + 100):
  latest_checkpointed_frame_ = null  ← 字节码边界清除
  ↓
  创建 DeoptFrame_15 (包含 y 的状态)
  ↓
  n7 = CheckedSmiUntag(y) → deopt_info = DeoptFrame_15
  n8 = Int32Constant(100)
  n9 = Int32AddWithOverflow(n7, n8) → deopt_info = DeoptFrame_15  ← 复用！
```

**内存效率：**
```
不复用：9 个节点 × 3 个 DeoptFrame = 27 个引用
复用：3 个 DeoptFrame × 每个被多个节点共享 = 高效！
```

---

## 3. DeoptInfo 与寄存器分配

### 3.1 DeoptInfo 的结构

```cpp
// src/maglev/maglev-ir.h:2079-2121
class DeoptInfo {
 protected:
  DeoptInfo(Zone* zone, DeoptFrame* top_frame,
            compiler::FeedbackSource feedback_to_update);

 public:
  DeoptFrame& top_frame() { return *top_frame_; }

  // === 关键：InputLocation 数组 ===
  bool has_input_locations() const { return input_locations_ != nullptr; }
  InputLocation* input_locations() const {
    DCHECK_NOT_NULL(input_locations_);
    return input_locations_;
  }

  void AllocateInputLocations(Zone* zone, size_t count) {
    input_locations_ = zone->AllocateArray<InputLocation>(count);
  }

 private:
  DeoptFrame* top_frame_;                      // DeoptFrame
  compiler::FeedbackSource feedback_to_update_;  // 反馈更新
  InputLocation* input_locations_ = nullptr;   // ← 值的物理位置！
  int deopt_index_ = -1;                       // Deopt 表索引
};
```

### 3.2 InputLocation：值的物理位置

```cpp
// src/compiler/backend/instruction.h (Turbofan 共享)
class InputLocation {
 public:
  enum class Kind {
    kRegister,      // 寄存器
    kStackSlot,     // 栈槽
    kConstant,      // 常量
    kUnknown        // 未知（编译时）
  };

  static InputLocation FromRegister(Register reg);
  static InputLocation FromDoubleRegister(DoubleRegister reg);
  static InputLocation FromStackSlot(int index);
  static InputLocation FromConstant(int index);

  Kind kind() const;
  int index() const;  // 寄存器编号或栈槽索引
};
```

### 3.3 值在寄存器还是栈上？

**编译时：ValueNode（IR 层面）**

```cpp
// 编译时，值是 ValueNode 指针
DeoptFrame {
  CompactInterpreterFrameState {
    ValueNode** live_registers_and_accumulator_;
    // [0] → n5: CheckedSmiUntag  (ValueNode*)
    // [1] → n8: Int32Constant    (ValueNode*)
    // [2] → n10: Int32Add        (ValueNode*)
  }
}
```

**代码生成后：InputLocation（机器层面）**

```cpp
// 寄存器分配后，记录物理位置
DeoptInfo {
  InputLocation* input_locations_;
  // [0] → InputLocation::FromRegister(rax)    // n5 在 rax
  // [1] → InputLocation::FromConstant(100)     // n8 是常量
  // [2] → InputLocation::FromStackSlot(-16)    // n10 在栈上 rbp-16
}
```

### 3.4 寄存器分配流程

```
IR 构建阶段：
┌────────────────────────────────────┐
│ DeoptFrame                         │
│   CompactInterpreterFrameState     │
│     ValueNode*[] = [n5, n8, n10]   │  ← IR 节点指针
└────────────────────────────────────┘

                ↓ 寄存器分配（Register Allocation）

代码生成阶段：
┌────────────────────────────────────┐
│ DeoptInfo                          │
│   InputLocation[] = [              │
│     Register(rax),                 │  ← 物理寄存器
│     Constant(100),                 │  ← 常量
│     StackSlot(-16)                 │  ← 栈槽
│   ]                                │
└────────────────────────────────────┘
```

### 3.5 实际示例

```javascript
function example(a, b) {
  let x = a | 0;
  let y = b | 0;
  return x + y;
}
```

**IR 阶段：**

```
n1 = Parameter(a)
n2 = Parameter(b)
n3 = CheckedSmiUntag(n1)
n4 = CheckedSmiUntag(n2)
n5 = Int32AddWithOverflow(n3, n4)

DeoptFrame at offset 5:
  frame_state = [n1, n2, n3, n4]  ← ValueNode 指针
```

**寄存器分配后：**

```
n1 → Parameter slot (stack)
n2 → Parameter slot (stack)
n3 → rax  ← 分配到寄存器
n4 → rcx  ← 分配到寄存器
n5 → rdx  ← 分配到寄存器

DeoptInfo:
  input_locations = [
    StackSlot(rbp+16),  // n1 (参数在栈上)
    StackSlot(rbp+8),   // n2 (参数在栈上)
    Register(rax),      // n3
    Register(rcx)       // n4
  ]
```

**机器码生成：**

```asm
; 函数入口
mov rax, [rbp+16]  ; 加载 a
mov rcx, [rbp+8]   ; 加载 b

; CheckedSmiUntag(a)
test rax, 1        ; 检查是否为 Smi
jz deopt_label     ; 不是 Smi → deopt
sar rax, 1         ; Untag: rax = a >> 1

; CheckedSmiUntag(b)
test rcx, 1
jz deopt_label
sar rcx, 1

; Int32AddWithOverflow(rax, rcx)
add rax, rcx
jo deopt_label     ; 溢出 → deopt

; 继续执行...

deopt_label:
  ; Deopt 入口，需要恢复栈帧
  ; 从 InputLocation 读取值：
  ; - n1: [rbp+16]
  ; - n2: [rbp+8]
  ; - n3: rax
  ; - n4: rcx
  call Deoptimizer::DeoptimizeFunction
```

### 3.6 为什么需要 InputLocation？

**问题：Deopt 时值在哪里？**

```javascript
function test(x) {
  let a = x | 0;       // a 可能在寄存器 rax
  let b = a + 1;       // b 可能在寄存器 rcx
  let c = b * 2;       // c 可能被溢出到栈上
  return c + 100;      // deopt 点
}

// 如果 deopt 发生，需要恢复 a, b, c 的值
// 但此时它们分别在：
//   a → rax (寄存器)
//   b → rcx (寄存器)
//   c → [rbp-16] (栈槽)
```

**解决方案：InputLocation 记录每个值的位置**

```cpp
DeoptInfo {
  InputLocation* input_locations_ = [
    InputLocation::FromRegister(rax),      // a
    InputLocation::FromRegister(rcx),      // b
    InputLocation::FromStackSlot(-16)      // c
  ];
}
```

---

## 4. Deoptimization 与 GC 的关系

### 4.1 GC 在 Deopt 期间被禁用！

**核心机制：在整个 Deopt 过程中，GC 被完全禁止。**

#### 源代码证据

**位置 1：** `src/deoptimizer/deoptimizer.cc:287-294`

```cpp
size_t Deoptimizer::DeleteForWasm(Isolate* isolate) {
  // The deoptimizer disallows garbage collections.
  DCHECK(!AllowGarbageCollection::IsAllowed());  // ← GC 被禁用
  Deoptimizer* deoptimizer = Deoptimizer::Grab(isolate);
  int output_count = deoptimizer->output_count();
  delete deoptimizer;
  // Now garbage collections are allowed again.
  DCHECK(AllowGarbageCollection::IsAllowed());  // ← Deopt 结束后才允许 GC
  return output_count;
}
```

**位置 2：** `src/deoptimizer/deoptimizer.cc:630-633`

```cpp
Deoptimizer::Deoptimizer(...) {
  // ... 省略前面的代码 ...

  DCHECK_NE(from, kNullAddress);

#ifdef DEBUG
  DCHECK(AllowGarbageCollection::IsAllowed());  // ← Deopt 开始前 GC 是允许的
  disallow_garbage_collection_ = new DisallowGarbageCollection();  // ← 禁用 GC！
#endif  // DEBUG

  // ... Deopt 处理代码 ...
}
```

**位置 3：** `src/deoptimizer/deoptimizer.h:313`

```cpp
class Deoptimizer : public Malloced {
  // ...

#ifdef DEBUG
  DisallowGarbageCollection* disallow_garbage_collection_;  // ← GC 禁用对象
#endif  // DEBUG

  // ...
};
```

### 4.2 为什么禁用 GC？

**原因：** Deopt 过程中有大量裸指针（raw pointers）操作，GC 可能导致这些指针失效。

#### 危险场景（如果允许 GC）

```cpp
// 假设 GC 在 deopt 期间发生...

// 1. 从寄存器读取对象指针
Address obj_ptr = ReadRegister(kAccumulatorRegister);  // 0x1234abcd

// 2. GC 发生！对象被移动
//    [GC 将对象从 0x1234abcd 移到 0x5678ef01]

// 3. 使用旧指针写入栈
stack_slot[0] = obj_ptr;  // 0x1234abcd ← 已失效！💥
```

### 4.3 MaterializeHeapObjects - 统一的对象实体化

**源代码位置：** `src/deoptimizer/deoptimizer.cc:2956-2994`

```cpp
void Deoptimizer::MaterializeHeapObjects() {
  translated_state_.Prepare(static_cast<Address>(stack_fp_));

  if (v8_flags.deopt_every_n_times > 0) {
    // Doing a GC here will find problems with the deoptimized frames.
    isolate_->heap()->CollectAllGarbage(GCFlag::kNoFlags,
                                        GarbageCollectionReason::kTesting);
    // ↑ 注意：这是 DEBUG 模式下的测试，用于验证 GC 安全性
  }

  // 遍历所有需要实体化的值
  for (auto& materialization : values_to_materialize_) {
    DirectHandle<Object> value = materialization.value_->GetValue();
    //                           ↑ 使用 Handle，GC 安全

    if (verbose_tracing_enabled()) {
      PrintF(trace_scope()->file(),
             "Materialization [" V8PRIxPTR_FMT "] <- " V8PRIxPTR_FMT " ;  ",
             static_cast<intptr_t>(materialization.output_slot_address_),
             (*value).ptr());
      ShortPrint(*value, trace_scope()->file());
      PrintF(trace_scope()->file(), "\n");
    }

    // 写入输出帧
    *(reinterpret_cast<Address*>(materialization.output_slot_address_)) =
        (*value).ptr();
  }

  // 处理 feedback vector
  for (auto& fbv_materialization : feedback_vector_to_materialize_) {
    DirectHandle<Object> closure = fbv_materialization.value_->GetValue();
    DCHECK(IsJSFunction(*closure));
    Tagged<Object> feedback_vector =
        Cast<JSFunction>(*closure)->raw_feedback_cell()->value();
    CHECK(IsFeedbackVector(feedback_vector));
    *(reinterpret_cast<Address*>(fbv_materialization.output_slot_address_)) =
        feedback_vector.ptr();
  }

  translated_state_.VerifyMaterializedObjects();

  isolate_->materialized_object_store()->Remove(
      static_cast<Address>(stack_fp_));
}
```

### 4.4 TranslatedState - 从 DeoptInfo 到实际对象

**源代码位置：** `src/deoptimizer/deoptimizer.h:299-305`

```cpp
class Deoptimizer : public Malloced {
  // ...

  TranslatedState translated_state_;  // ← 翻译状态
  struct ValueToMaterialize {
    Address output_slot_address_;     // ← 目标栈位置
    TranslatedFrame::iterator value_; // ← 值的迭代器
  };
  std::vector<ValueToMaterialize> values_to_materialize_;  // ← 待实体化的值

  // ...
};
```

### 4.5 完整的 GC 安全流程

```
1. 优化代码触发 deopt
   ↓
2. Deoptimizer::New() 创建 Deoptimizer 对象
   ↓
3. 在构造函数中：disallow_garbage_collection_ = new DisallowGarbageCollection()
   ↓ [GC 被禁用]
   ↓
4. 从 DeoptInfo 读取 InputLocation（寄存器/栈位置）
   ↓
5. 读取寄存器和栈中的原始值（raw pointers 和 Smi）
   ↓
6. MaterializeHeapObjects()
   │  ├─> 使用 Handle<Object> 包装所有对象指针（GC 安全）
   │  └─> 写入输出帧栈位置
   ↓
7. ComputeOutputFrames() 构建解释器帧
   ↓
8. delete deoptimizer
   ↓ [DisallowGarbageCollection 析构，GC 重新允许]
   ↓
9. 返回解释器
```

### 4.6 为什么 MaterializeHeapObjects 使用 Handle？

**Handle 的作用：** 即使 GC 发生，Handle 中的指针会被 GC 自动更新。

```cpp
// 如果没有 Handle（假设）：
Address raw_ptr = translate_value();  // 0x1234abcd
// [假设 GC 发生，对象移动]
stack[0] = raw_ptr;  // 0x1234abcd ← 已失效！

// 使用 Handle（实际）：
DirectHandle<Object> handle = translate_value();
// [即使 GC 发生，Handle 内部指针会被 GC 更新]
stack[0] = (*handle).ptr();  // ← 总是有效！
```

**但在 Deoptimizer 中，整个过程禁用 GC，所以更安全！**

---

## 5. 完整示例：从字节码到 Deopt

让我们通过一个完整的例子串联所有概念。

### 5.1 JavaScript 源代码

```javascript
function compute(x, y) {
  let a = x | 0;   // 确保 x 是整数
  let b = y | 0;   // 确保 y 是整数
  let c = a + b;   // 整数加法
  let d = c * 2;   // 整数乘法
  return d;
}

// 预热
%PrepareFunctionForOptimization(compute);
compute(5, 10);
compute(10, 20);

// 强制 Maglev 编译
%OptimizeMaglevOnNextCall(compute);
let result = compute(15, 20);  // ✅ 优化路径
console.log(result);  // 70

// 触发 deopt
compute(5, 3.14);  // ❌ y 不是 Smi → Deopt
```

### 5.2 字节码

```
Bytecode:
  0: Ldar a0           ; 加载参数 x 到累加器
  2: BitwiseOr [0]     ; x | 0
  4: Star0             ; 存储到 r0 (a)
  5: Ldar a1           ; 加载参数 y 到累加器
  7: BitwiseOr [1]     ; y | 0
  9: Star1             ; 存储到 r1 (b)
 10: Ldar r0           ; 加载 a
 12: Add r1, [2]       ; a + b
 14: Star2             ; 存储到 r2 (c)
 15: Ldar r2           ; 加载 c
 17: MulSmi [2], [3]   ; c * 2
 19: Return            ; 返回
```

### 5.3 Maglev IR 构建

```
=== Prologue ===
n1: InitialValue(x)        // param0
n2: InitialValue(y)        // param1
n3: FunctionEntryStackCheck

=== Bytecode 0-4: a = x | 0 ===
current_interpreter_frame_:
  param0 = n1, param1 = n2, r0 = ?, r1 = ?, r2 = ?, acc = ?

n4: CheckedSmiUntag(n1)     // 检查 x 是 Smi → 可能 deopt
    ↓ GetLatestCheckpointedFrame()
    latest_checkpointed_frame_ = null
    ↓ 创建 DeoptFrame_0:
        frame_state = [n1, n2]  // param0, param1
        bytecode_offset = 0

n5: Int32BitwiseOr(n4, 0)
n6: Int32ToNumber(n5)       // 转回 Smi

current_interpreter_frame_:
  param0 = n1, param1 = n2, r0 = n6, acc = n6

latest_checkpointed_frame_ = null  ← 字节码边界清除

=== Bytecode 5-9: b = y | 0 ===
n7: CheckedSmiUntag(n2)     // 检查 y 是 Smi → 可能 deopt
    ↓ GetLatestCheckpointedFrame()
    latest_checkpointed_frame_ = null
    ↓ 创建 DeoptFrame_5:
        frame_state = [n1, n2, n6]  // param0, param1, r0
        bytecode_offset = 5

n8: Int32BitwiseOr(n7, 0)
n9: Int32ToNumber(n8)

current_interpreter_frame_:
  param0 = n1, param1 = n2, r0 = n6, r1 = n9, acc = n9

latest_checkpointed_frame_ = null  ← 清除

=== Bytecode 10-14: c = a + b ===
n10: CheckedSmiUntag(n6)    // r0 → int32
    ↓ GetLatestCheckpointedFrame()
    latest_checkpointed_frame_ = null
    ↓ 创建 DeoptFrame_10:
        frame_state = [n1, n2, n6, n9]  // ← 注意：只有 a, b，没有 c
        bytecode_offset = 10

n11: CheckedSmiUntag(n9)    // r1 → int32
    ↓ GetLatestCheckpointedFrame()
    ↑ latest_checkpointed_frame_ != null
    ↑ 复用 DeoptFrame_10  ← 复用！

n12: Int32AddWithOverflow(n10, n11)  // 可能溢出 → deopt
    ↓ deopt_info = DeoptFrame_10  ← 复用！

n13: Int32ToNumber(n12)

current_interpreter_frame_:
  param0 = n1, param1 = n2, r0 = n6, r1 = n9, r2 = n13, acc = n13

latest_checkpointed_frame_ = null  ← 清除

=== Bytecode 15-19: return c * 2 ===
n14: CheckedSmiUntag(n13)
    ↓ 创建 DeoptFrame_15

n15: Int32Constant(2)
n16: Int32MulWithOverflow(n14, n15)
    ↓ deopt_info = DeoptFrame_15  ← 复用

n17: Int32ToNumber(n16)
n18: Return(n17)
```

### 5.4 寄存器分配

```
寄存器分配结果：
n1: stack(rbp+24)   // param0 (x)
n2: stack(rbp+16)   // param1 (y)
n4: rax             // CheckedSmiUntag(x)
n5: rax             // BitwiseOr (复用 rax)
n6: rax             // Int32ToNumber (复用 rax)
n7: rcx             // CheckedSmiUntag(y)
n8: rcx             // BitwiseOr (复用 rcx)
n9: rcx             // Int32ToNumber (复用 rcx)
n10: rax            // CheckedSmiUntag(n6)
n11: rcx            // CheckedSmiUntag(n9)
n12: rax            // Int32Add (复用 rax)
n13: rax            // Int32ToNumber (复用 rax)
n14: rax            // CheckedSmiUntag(n13)
n15: immediate(2)   // 常量
n16: rax            // Int32Mul (复用 rax)
n17: rax            // Int32ToNumber (复用 rax)

InputLocation 分配：
DeoptFrame_0:
  input_locations = [
    StackSlot(rbp+24),  // n1 (x)
    StackSlot(rbp+16)   // n2 (y)
  ]

DeoptFrame_5:
  input_locations = [
    StackSlot(rbp+24),  // n1 (x)
    StackSlot(rbp+16),  // n2 (y)
    Register(rax)       // n6 (a)
  ]

DeoptFrame_10:
  input_locations = [
    StackSlot(rbp+24),  // n1 (x)
    StackSlot(rbp+16),  // n2 (y)
    Register(rax),      // n6 (a)
    Register(rcx)       // n9 (b)
  ]

DeoptFrame_15:
  input_locations = [
    StackSlot(rbp+24),  // n1 (x)
    StackSlot(rbp+16),  // n2 (y)
    Register(rax),      // n6 (a)
    Register(rcx),      // n9 (b)
    Register(rax)       // n13 (c) - 覆盖了 a，但 deopt 时 a 不再需要
  ]
```

### 5.5 机器码生成

```asm
; 函数入口
push rbp
mov rbp, rsp
sub rsp, 8  ; 栈帧

; FunctionEntryStackCheck
cmp rsp, [r13 + kStackLimitOffset]
jb stack_overflow_deopt

; === a = x | 0 (offset 0) ===
mov rax, [rbp+24]     ; 加载 x (n1)

; CheckedSmiUntag(x) - n4
test rax, 1           ; 检查 Smi 标签位
jz deopt_offset_0     ; 不是 Smi → deopt
sar rax, 1            ; Untag: rax = x >> 1

; BitwiseOr(rax, 0) - n5
or rax, 0             ; 实际无操作

; Int32ToNumber(rax) - n6
lea rax, [rax*2]      ; Tag: rax = (rax << 1) | 0

; === b = y | 0 (offset 5) ===
mov rcx, [rbp+16]     ; 加载 y (n2)

; CheckedSmiUntag(y) - n7
test rcx, 1
jz deopt_offset_5     ; ← Deopt 点！
sar rcx, 1

; BitwiseOr(rcx, 0) - n8
or rcx, 0

; Int32ToNumber(rcx) - n9
lea rcx, [rcx*2]

; === c = a + b (offset 10) ===
; CheckedSmiUntag(a) - n10
test rax, 1
jz deopt_offset_10
sar rax, 1

; CheckedSmiUntag(b) - n11
test rcx, 1
jz deopt_offset_10    ; ← 复用同一 deopt label
sar rcx, 1

; Int32AddWithOverflow(rax, rcx) - n12
add rax, rcx
jo deopt_offset_10    ; ← 溢出 deopt

; Int32ToNumber(rax) - n13
lea rax, [rax*2]

; === return c * 2 (offset 15) ===
; CheckedSmiUntag(c) - n14
test rax, 1
jz deopt_offset_15
sar rax, 1

; Int32MulWithOverflow(rax, 2) - n16
imul rax, rax, 2
jo deopt_offset_15    ; ← 溢出 deopt

; Int32ToNumber(rax) - n17
lea rax, [rax*2]

; Return
mov rsp, rbp
pop rbp
ret

; === Deopt 标签 ===
deopt_offset_0:
  ; 保存寄存器状态
  ; input_locations = [stack(rbp+24), stack(rbp+16)]
  mov rdi, deopt_info_0
  call Builtin::kDeoptimize

deopt_offset_5:
  ; input_locations = [stack(rbp+24), stack(rbp+16), rax]
  mov rdi, deopt_info_5
  call Builtin::kDeoptimize

deopt_offset_10:
  ; input_locations = [stack(rbp+24), stack(rbp+16), rax, rcx]
  mov rdi, deopt_info_10
  call Builtin::kDeoptimize

deopt_offset_15:
  ; input_locations = [stack(rbp+24), stack(rbp+16), rax, rcx, rax]
  mov rdi, deopt_info_15
  call Builtin::kDeoptimize
```

### 5.6 Deopt 触发

```javascript
compute(5, 3.14);  // y = 3.14 (HeapNumber, 不是 Smi)
```

**执行流程：**

```
1. 机器码执行到 offset 5:
   mov rcx, [rbp+16]     ; rcx = 3.14 (HeapNumber 指针)
   test rcx, 1           ; 检查 Smi 标签位
   jz deopt_offset_5     ; ← 跳转！HeapNumber 不是 Smi

2. 进入 deopt_offset_5:
   ; 此时寄存器状态：
   ;   rax = 5 (Smi tagged, 0b1010)
   ;   rcx = 0x... (HeapNumber 指针)
   ;   [rbp+24] = 5 (Smi)
   ;   [rbp+16] = 3.14 (HeapNumber)

   mov rdi, deopt_info_5  ; 传递 DeoptInfo
   call Builtin::kDeoptimize

3. Builtin::kDeoptimize 执行：
   a. 禁用 GC:
      disallow_garbage_collection_ = new DisallowGarbageCollection();

   b. 从 DeoptInfo 读取 InputLocation
   c. 恢复值到临时数组：
      - values[0] = ReadStack(rbp+24) = Smi(5)      // x
      - values[1] = ReadStack(rbp+16) = HeapNumber(3.14)  // y
      - values[2] = ReadRegister(rax) = Smi(5)     // a

   d. MaterializeHeapObjects() (GC 仍被禁用)
      - 使用 DirectHandle<Object> 包装所有值

   e. 创建解释器帧：
      - frame.param(0) = values[0]  // x = 5
      - frame.param(1) = values[1]  // y = 3.14
      - frame.register(0) = values[2]  // r0 = 5 (a)

   f. 设置字节码偏移 = 5

   g. 清理并允许 GC:
      delete deoptimizer;  // DisallowGarbageCollection 析构

   h. 跳转到解释器执行 offset 5

4. 解释器继续执行：
   Bytecode 5: Ldar a1      ; acc = 3.14 (HeapNumber)
   Bytecode 7: BitwiseOr    ; 调用 runtime，转换为 3
   Bytecode 9: Star1        ; r1 = 3
   ...
   (继续执行，使用通用路径而非优化的整数快速路径)
```

---

## 总结

### 关键要点

1. **FrameState 不是每个字节码一个**
   - `current_interpreter_frame_` 是唯一的工作状态
   - `DeoptFrame` 是按需创建的快照
   - `MergePointInterpreterFrameState` 只在控制流汇合点

2. **Deopt Use = 引用计数机制**
   - `AddDeoptUse(node)` → `node->use_count_++`
   - DCE 检查 `use_count_ > 0`，有 deopt use 的节点不会被删除
   - DeoptFrame 不能删除，因为运行时需要它来重建解释器帧

3. **DeoptFrame 可以复用**
   - `latest_checkpointed_frame_` 缓存同一字节码偏移的快照
   - 同一字节码的多个节点共享一个 DeoptFrame
   - 字节码边界/副作用操作清除缓存

4. **DeoptInfo 的值在寄存器和栈上**
   - IR 阶段：ValueNode 指针
   - 代码生成后：InputLocation 记录物理位置（寄存器/栈槽/常量）
   - Deopt 时从 InputLocation 恢复值

5. **GC 安全机制**
   - **核心：Deopt 期间完全禁用 GC**
   - `DisallowGarbageCollection` 保证不会有 GC
   - `MaterializeHeapObjects` 使用 DirectHandle 额外保护
   - 整个过程使用 Handle 机制保护对象

### 源代码引用表

| 功能 | 文件 | 行号 |
|------|------|------|
| `use_count_` 定义 | src/maglev/maglev-ir.h | 2872-2884, 3027 |
| `AddDeoptUse` 实现 | src/maglev/maglev-graph-builder.cc | 16897-16912 |
| DeoptFrame 创建 + AddDeoptUse 调用 | src/maglev/maglev-graph-builder.cc | 1535-1563 |
| 缓存清除 | src/maglev/maglev-graph-builder.h | 2053 |
| DCE 实现 | src/maglev/maglev-post-hoc-optimizations-processors.h | 527-529 |
| GC 禁用（构造函数） | src/deoptimizer/deoptimizer.cc | 630-633 |
| GC 禁用（注释） | src/deoptimizer/deoptimizer.cc | 287-294 |
| DisallowGarbageCollection 成员 | src/deoptimizer/deoptimizer.h | 313 |
| MaterializeHeapObjects | src/deoptimizer/deoptimizer.cc | 2956-2994 |
| TranslatedState 定义 | src/deoptimizer/deoptimizer.h | 299-305 |
| InputLocation | src/compiler/backend/instruction.h | - |
| Deoptimizer | src/deoptimizer/deoptimizer.cc | - |
