# FrameState 高级主题（更正版）

## 目录
1. [Deopt Use 机制详解](#1-deopt-use-机制详解)
2. [DeoptInfo 复用：同一字节码偏移的多个节点](#2-deoptinfo-复用同一字节码偏移的多个节点)
3. [示例错误更正](#3-示例错误更正)
4. [GC 安全机制（真实源代码）](#4-gc-安全机制真实源代码)
5. [完整示例（更正版）](#5-完整示例更正版)

---

## 1. Deopt Use 机制详解

### 1.1 什么是 Deopt Use？

**Deopt Use** 是一种引用计数机制，用于防止 Dead Code Elimination (DCE) 过早删除 DeoptFrame 中引用的节点。

### 1.2 核心实现

#### use_count_ 追踪

**源代码位置：** `src/maglev/maglev-ir.h:2872-2884`

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
      // Add an escaping use for the allocation.
      AddNonEscapingUses(alloc, 1);
    }
    alloc->add_use();  // ← 增加引用计数
  } else {
    node->add_use();   // ← 增加引用计数！
  }
}
```

#### 何时调用 AddDeoptUse？

**源代码位置：** `src/maglev/maglev-graph-builder.cc:1549-1552`

```cpp
DeoptFrame* MaglevGraphBuilder::GetLatestCheckpointedFrame() {
  // ... 省略前面的代码 ...

  if (!latest_checkpointed_frame_) {
    // 创建 DeoptFrame
    latest_checkpointed_frame_ = zone()->New<InterpretedDeoptFrame>(
        *compilation_unit_,
        zone()->New<CompactInterpreterFrameState>(
            *compilation_unit_, GetInLiveness(), current_interpreter_frame_),
        GetClosure(),
        current_interpreter_frame_.virtual_objects().head(),
        BytecodeOffset(iterator_.current_offset()),
        GetCurrentSourcePosition(),
        GetCallerDeoptFrame());

    // ← 关键！遍历帧状态中的所有值，增加 deopt use 计数
    latest_checkpointed_frame_->as_interpreted().frame_state()->ForEachValue(
        *compilation_unit_,
        [&](ValueNode* node, interpreter::Register) {
          AddDeoptUse(node);  // ← 调用 AddDeoptUse
        });
    AddDeoptUse(latest_checkpointed_frame_->as_interpreted().closure());
  }

  return latest_checkpointed_frame_;
}
```

### 1.3 DCE 如何检查 use_count？

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

### 1.4 回答子问题

#### 问题 1.1：如果节点被 DCE 删除，DeoptFrame 引用会消失吗？

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

#### 问题 1.2：为什么不连 DeoptFrame 一起删？

**答案：DeoptFrame 是反优化的关键数据，不能删除！**

**原因：**

1. **运行时需要：** 当优化代码触发 deopt 时（如类型检查失败），需要 DeoptFrame 重建解释器帧
2. **安全保证：** 所有可能 deopt 的节点都必须有 DeoptFrame，否则无法回退到解释器
3. **生命周期不同：**
   - **节点**：编译时的 IR，可能被优化掉
   - **DeoptFrame**：运行时的救生索，必须保留到代码生成阶段

**类比：**
```
节点          → 高速公路的车道
DeoptFrame    → 紧急停车带

即使某条车道不用了（DCE），紧急停车带也必须保留（运行时可能需要）
```

### 1.5 完整流程图

```
创建需要 deopt 的节点（如 CheckedSmiUntag）
    ↓
调用 GetLatestCheckpointedFrame()
    ↓
创建 DeoptFrame（如果缓存为空）
    ↓
ForEachValue(..., AddDeoptUse)
    ↓
对每个值：node->add_use()
    ↓
use_count_ 增加
    ↓
DCE 阶段：检查 is_used()
    ↓
use_count_ > 0 → 节点被保留 ✅
```

---

## 2. DeoptInfo 复用：同一字节码偏移的多个节点

### 2.1 什么是"同一字节码偏移的多个节点"？

**核心概念：** 一条字节码可能生成多个 IR 节点，这些节点共享同一个 DeoptFrame。

### 2.2 具体例子

#### JavaScript 代码

```javascript
function add(x, y) {
  return x + y;
}
```

#### 字节码（简化）

```
offset  bytecode
0       LdaSmi [0]
5       Add r0, [0]    ← 一条字节码
10      Return
```

#### IR 节点（offset 5 生成多个节点）

**字节码 `Add r0, [0]` 展开成：**

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

### 2.3 DeoptFrame 复用机制

#### 缓存机制

**源代码位置：** `src/maglev/maglev-graph-builder.cc:1535-1563`

```cpp
DeoptFrame* MaglevGraphBuilder::GetLatestCheckpointedFrame() {
  if (in_prologue_) {
    return GetDeoptFrameForEntryStackCheck();
  }

  if (!latest_checkpointed_frame_) {  // ← 检查缓存
    // 第一次：创建 DeoptFrame
    latest_checkpointed_frame_ = zone()->New<InterpretedDeoptFrame>(
        *compilation_unit_,
        zone()->New<CompactInterpreterFrameState>(
            *compilation_unit_, GetInLiveness(), current_interpreter_frame_),
        GetClosure(),
        current_interpreter_frame_.virtual_objects().head(),
        BytecodeOffset(iterator_.current_offset()),  // ← 当前字节码偏移
        GetCurrentSourcePosition(),
        GetCallerDeoptFrame());

    latest_checkpointed_frame_->as_interpreted().frame_state()->ForEachValue(
        *compilation_unit_,
        [&](ValueNode* node, interpreter::Register) { AddDeoptUse(node); });
    AddDeoptUse(latest_checkpointed_frame_->as_interpreted().closure());
  }

  return latest_checkpointed_frame_;  // ← 后续调用直接返回缓存
}
```

#### 缓存清除时机

**源代码位置：** `src/maglev/maglev-graph-builder.h:2053`

```cpp
void MarkNodeContextEffects() {
  latest_checkpointed_frame_ = nullptr;  // ← 清除缓存
}
```

**何时清除？**
- 处理下一条字节码时
- 遇到可能改变上下文的操作时

### 2.4 具体示例

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

// ========== 下一条字节码（清除缓存）==========
iterator_.Advance();  // 移动到 offset 10
MarkNodeContextEffects();  // 清除缓存
latest_checkpointed_frame_ = nullptr;
```

### 2.5 为什么可以复用？

1. **状态相同：** 同一条字节码的所有节点看到的 InterpreterFrameState 相同
2. **偏移相同：** 都对应同一个 bytecode_offset
3. **反优化目标相同：** 都需要回到同一个字节码位置重新执行

### 2.6 内存优化

**不复用的情况（假设）：**

```
每个节点都创建 DeoptFrame：
  left_check   → DeoptFrame_5a (x, y, r0)
  right_check  → DeoptFrame_5b (x, y, r0)  ← 冗余！
  int32_add    → DeoptFrame_5c (x, y, r0)  ← 冗余！
```

**复用的情况（实际）：**

```
所有节点共享一个 DeoptFrame：
  left_check   → DeoptFrame_5
  right_check  → DeoptFrame_5  ← 共享
  int32_add    → DeoptFrame_5  ← 共享
```

---

## 3. 示例错误更正

### 3.1 原错误

```
偏移 5 (a + b):
  创建 DeoptFrame_5 (包含 a, b, c 的状态)  ← 错误！c 尚未计算
```

### 3.2 更正

**JavaScript 代码：**

```javascript
function foo(x, y) {
  let a = x + 1;  // offset 0-4
  let b = a + 2;  // offset 5-9
  let c = b + 3;  // offset 10-14
  return c;
}
```

**字节码映射：**

```
offset   字节码           寄存器状态
0        LdaSmi [1]       params: [x, y], locals: []
1        Add r0           params: [x, y], locals: [x]
2        Star r0          params: [x, y], locals: [a]  ← a 现在存在
5        LdaSmi [2]       params: [x, y], locals: [a]
6        Add r0           params: [x, y], locals: [a]  ← b 正在计算
7        Star r1          params: [x, y], locals: [a, b]  ← b 现在存在
10       LdaSmi [3]       params: [x, y], locals: [a, b]
11       Add r1           params: [x, y], locals: [a, b]  ← c 正在计算
12       Star r2          params: [x, y], locals: [a, b, c]  ← c 现在存在
15       Ldar r2
16       Return
```

**正确的 DeoptFrame 状态：**

```cpp
// 偏移 0-4 (a = x + 1)
DeoptFrame_0 {
  bytecode_offset: 0,
  state: [param0=x, param1=y]  // a 尚未计算
}

// 偏移 5-9 (b = a + 2)  ← 更正！
DeoptFrame_5 {
  bytecode_offset: 5,
  state: [param0=x, param1=y, r0=a]  // ← 只有 x, y, a
}

// 偏移 10-14 (c = b + 3)
DeoptFrame_10 {
  bytecode_offset: 10,
  state: [param0=x, param1=y, r0=a, r1=b]  // ← 有 x, y, a, b（没有 c）
}
```

---

## 4. GC 安全机制（真实源代码）

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

**源代码位置：** `src/deoptimizer/deoptimizer.h:299`

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

## 5. 完整示例（更正版）

### 5.1 JavaScript 代码

```javascript
function add(x, y) {
  let a = x + 1;  // offset 0-4
  let b = a + 2;  // offset 5-9
  return b;
}
```

### 5.2 字节码

```
offset   bytecode              寄存器状态
0        LdaSmi [1]            [param0=x, param1=y]
1        Add r0                [param0=x, param1=y]
2        Star r0               [param0=x, param1=y, r0=a]
5        LdaSmi [2]            [param0=x, param1=y, r0=a]
6        Add r0                [param0=x, param1=y, r0=a]
7        Star r1               [param0=x, param1=y, r0=a, r1=b]
10       Ldar r1
11       Return
```

### 5.3 IR 构建（Offset 5-9）

```cpp
// ========== 字节码 offset 5: LdaSmi [2] ==========
current_interpreter_frame_.SetAccumulator(ConstantNode(2));

// ========== 字节码 offset 6: Add r0 ==========

// 第一次调用 GetLatestCheckpointedFrame()
ValueNode* left = GetAccumulator();  // Constant(2)
ValueNode* right = GetRegister(0);   // a 的值

// 节点 1: CheckedSmiUntag(left)
ValueNode* left_int32 = AddNewNode<CheckedSmiUntag>(left);
    ↓ 需要 EagerDeoptInfo
    ↓ 调用 GetLatestCheckpointedFrame()
    ↓ latest_checkpointed_frame_ == null  ← 缓存为空
    ↓ 创建 DeoptFrame_6
    ↓     bytecode_offset: 6
    ↓     state: [param0=x, param1=y, r0=a, accumulator=2]  ← 只有 x, y, a
    ↓ ForEachValue([param0, param1, r0, acc], AddDeoptUse)
    ↓     x.use_count_++;     // ← deopt use
    ↓     y.use_count_++;     // ← deopt use
    ↓     a.use_count_++;     // ← deopt use
    ↓     constant_2.use_count_++;  // ← deopt use
    ↓ latest_checkpointed_frame_ = DeoptFrame_6  ← 缓存
    ↓
left_int32->set_eager_deopt_info(DeoptFrame_6)

// 节点 2: CheckedSmiUntag(right) - 复用 DeoptFrame
ValueNode* right_int32 = AddNewNode<CheckedSmiUntag>(right);
    ↓ 需要 EagerDeoptInfo
    ↓ 调用 GetLatestCheckpointedFrame()
    ↓ latest_checkpointed_frame_ != null  ← 缓存命中！
    ↓ 返回 DeoptFrame_6  ← 复用！
    ↓
right_int32->set_eager_deopt_info(DeoptFrame_6)  // ← 共享同一个 DeoptFrame

// 节点 3: Int32AddWithOverflow
ValueNode* result_int32 = AddNewNode<Int32AddWithOverflow>(left_int32, right_int32);
    ↓ 需要 EagerDeoptInfo
    ↓ 调用 GetLatestCheckpointedFrame()
    ↓ 返回 DeoptFrame_6  ← 继续复用！
    ↓
result_int32->set_eager_deopt_info(DeoptFrame_6)

// 节点 4: Int32ToNumber（不需要 deopt info）
ValueNode* result_smi = AddNewNode<Int32ToNumber>(result_int32);

// 更新累加器
current_interpreter_frame_.SetAccumulator(result_smi);
```

### 5.4 DeoptFrame 复用总结

```
offset 6 的所有节点共享一个 DeoptFrame：

left_int32    → DeoptFrame_6 [x, y, a, acc=2]
right_int32   → DeoptFrame_6  ← 共享
result_int32  → DeoptFrame_6  ← 共享
```

### 5.5 DCE 阶段

```cpp
// DeadNodeSweepingProcessor 遍历所有节点

// 检查 left_int32
if (!left_int32->is_used()) {  // use_count_ = 1 (被 result_int32 使用)
  remove(left_int32);  // ← 不执行
}

// 检查 x（参数）
if (!x->is_used()) {  // use_count_ = 2 (normal use + deopt use)
  remove(x);  // ← 不执行
}

// 检查 a
if (!a->is_used()) {  // use_count_ = 2 (用于 Add + deopt use)
  remove(a);  // ← 不执行
}
```

### 5.6 运行时 Deopt

假设在 `right_int32 = CheckedSmiUntag(right)` 时触发 deopt（right 不是 Smi）：

```cpp
// 1. CPU 状态
rax: 0x5678  // constant 2 (Smi)
rbx: 0x1234  // a 的值 (Smi)
rcx: 0xabcd  // x 的值 (Smi)
rdx: 0xef01  // y 的值 (Smi)

// 2. Deoptimizer 启动
Deoptimizer deopt = new Deoptimizer(...);
disallow_garbage_collection_ = new DisallowGarbageCollection();  // ← GC 禁用

// 3. 读取 DeoptFrame_6
DeoptFrame* frame = right_int32->eager_deopt_info()->top_frame();
// frame->bytecode_offset = 6
// frame->frame_state = [param0, param1, r0, acc]

// 4. 从 InputLocation 读取值（GC 仍被禁用）
InputLocation* locs = right_int32->eager_deopt_info()->input_locations();
// locs[0] = kRegister(rcx)  → param0 = 0xabcd
// locs[1] = kRegister(rdx)  → param1 = 0xef01
// locs[2] = kRegister(rbx)  → r0 = 0x1234
// locs[3] = kRegister(rax)  → acc = 0x5678

// 5. MaterializeHeapObjects（GC 仍被禁用）
DirectHandle<Object> param0_obj = Smi::FromInt(0xabcd);
DirectHandle<Object> param1_obj = Smi::FromInt(0xef01);
DirectHandle<Object> r0_obj = Smi::FromInt(0x1234);
DirectHandle<Object> acc_obj = Smi::FromInt(0x5678);

// 6. 写入输出帧（构建解释器帧）
output_frame[0] = (*param0_obj).ptr();  // x
output_frame[1] = (*param1_obj).ptr();  // y
output_frame[2] = (*r0_obj).ptr();      // a
output_frame[3] = (*acc_obj).ptr();     // accumulator

// 7. 清理
delete deopt;  // ← DisallowGarbageCollection 析构，GC 重新允许

// 8. 返回解释器，从 offset 6 重新执行
return to_interpreter(bytecode_offset = 6);
```

---

## 总结

### 关键要点

1. **Deopt Use = 引用计数**
   - `AddDeoptUse(node)` → `node->use_count_++`
   - DCE 检查 `use_count_ > 0`，有 deopt use 的节点不会被删除

2. **DeoptFrame 复用**
   - 同一字节码的多个节点共享一个 DeoptFrame
   - 通过 `latest_checkpointed_frame_` 缓存实现
   - 节省内存，提高性能

3. **GC 安全**
   - **核心机制：Deopt 期间完全禁用 GC**
   - `DisallowGarbageCollection` 保证不会有 GC
   - `MaterializeHeapObjects` 使用 Handle 额外保护

4. **数据结构层次**
   ```
   InterpreterFrameState          ← 图构建时的可变状态
         ↓ 快照
   CompactInterpreterFrameState   ← DeoptFrame 中的压缩状态
         ↓ 运行时读取
   InputLocation[]                ← 寄存器/栈位置
         ↓ MaterializeHeapObjects
   输出帧（解释器栈）             ← 实际对象指针
   ```

### 源代码引用

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
