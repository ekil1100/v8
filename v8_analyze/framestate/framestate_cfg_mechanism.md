# FrameState 在控制流图（CFG）中的工作机制

## 你的问题是对的！

**问题：** "整个编译过程只有一个 `current_interpreter_frame_`，编译生成的不是图吗？怎么可能只有一个 frame，每次更新都复制？"

**答案：** 我之前的描述确实有误导性！实际机制要复杂得多，也更巧妙。

---

## 核心机制：一个工作帧 + 数组存储合并点

### 数据结构

```cpp
// src/maglev/maglev-graph-builder.cc:1135-1141
class MaglevGraphBuilder {
 private:
  // ✅ 一个工作帧 - 用于当前遍历路径
  InterpreterFrameState current_interpreter_frame_;

  // ✅ 数组 - 存储每个字节码偏移的合并点状态
  MergePointInterpreterFrameState** merge_states_;
  //                                  ↑
  //                                  数组大小 = bytecode().length() + 1
};

// 初始化
merge_states_(zone()->AllocateArray<MergePointInterpreterFrameState*>(
    bytecode().length() + 1))
```

### 关键点

1. **`current_interpreter_frame_`**：工作状态，随着当前遍历路径更新
2. **`merge_states_[offset]`**：每个字节码偏移对应一个合并点状态（如果该偏移是控制流汇聚点）

---

## 工作流程

### 1️⃣ 线性路径（无分支）

```cpp
// 简单的顺序执行
void VisitLdar() {
  ValueNode* value = current_interpreter_frame_.get(reg);  // ← 读取工作帧
  SetAccumulator(value);
}

void VisitStar() {
  ValueNode* accumulator = GetAccumulator();
  current_interpreter_frame_.set(reg, accumulator);        // ← 更新工作帧
}
```

**特点：** 直接读写 `current_interpreter_frame_`，无需复制或合并。

---

### 2️⃣ 遇到跳转（创建或合并到合并点）

```cpp
// src/maglev/maglev-graph-builder.cc:14743-14749
ReduceResult MaglevGraphBuilder::VisitJump() {
  BasicBlock* block =
      FinishBlock<Jump>({}, &jump_targets_[iterator_.GetJumpTargetOffset()]);
  MergeIntoFrameState(block, iterator_.GetJumpTargetOffset());  // ← 关键！
  return ReduceResult::Done();
}
```

#### MergeIntoFrameState 逻辑

```cpp
// src/maglev/maglev-graph-builder.cc:14786-14805
void MaglevGraphBuilder::MergeIntoFrameState(BasicBlock* predecessor,
                                             int target) {
  if (merge_states_[target] == nullptr) {
    // 第一次到达这个目标偏移
    // ✅ 从 current_interpreter_frame_ 创建新的合并点状态
    merge_states_[target] = MergePointInterpreterFrameState::New(
        *compilation_unit_,
        current_interpreter_frame_,  // ← 从当前工作帧创建快照
        target,
        predecessor_count(target),
        predecessor,
        liveness);
  } else {
    // 已经存在合并点（说明有多条路径汇聚）
    // ✅ 将 current_interpreter_frame_ 合并进去
    merge_states_[target]->Merge(
        this,
        current_interpreter_frame_,  // ← 合并当前工作帧
        predecessor);
  }
}
```

---

### 3️⃣ 条件分支（两条路径）

```cpp
// src/maglev/maglev-graph-builder.cc:15213-15217
ReduceResult MaglevGraphBuilder::VisitJumpIfTrue() {
  auto branch_builder = CreateBranchBuilder(BranchType::kBranchIfTrue);
  BuildBranchIfTrue(branch_builder, GetAccumulator());
  return ReduceResult::Done();
}

// BranchBuilder 处理两个分支
// src/maglev/maglev-graph-builder.cc:652-675
void BranchBuilder::StartFallthroughBlock(BasicBlock* predecessor) {
  switch (mode()) {
    case kBytecodeJumpTarget: {
      auto& data = data_.bytecode_target;

      // ← 分支 1：合并到跳转目标
      builder_->MergeIntoFrameState(predecessor, data.jump_target_offset);

      // ← 分支 2：继续执行 fallthrough
      builder_->StartFallthroughBlock(data.fallthrough_offset, predecessor);
      break;
    }
  }
}
```

**关键：**
- 当前的 `current_interpreter_frame_` 会被**分别**合并到两个不同的目标
- 跳转目标：`merge_states_[jump_target_offset]`
- Fallthrough：`merge_states_[fallthrough_offset]`

---

### 4️⃣ 开始新块（从合并点恢复状态）

```cpp
// src/maglev/maglev-graph-builder.cc:16076-16084
void MaglevGraphBuilder::ProcessMergePoint(int offset,
                                           bool preserve_known_node_aspects) {
  // ✅ 从 merge_state 拷贝到 current_interpreter_frame_
  MergePointInterpreterFrameState& merge_state = *merge_states_[offset];
  current_interpreter_frame_.CopyFrom(
      *compilation_unit_,
      merge_state,                  // ← 从合并点恢复
      preserve_known_node_aspects,
      zone());

  ProcessMergePointPredecessors(merge_state, jump_targets_[offset]);
}
```

**关键：**
- 当到达一个合并点时，从 `merge_states_[offset]` 恢复 `current_interpreter_frame_`
- 此后继续用 `current_interpreter_frame_` 作为工作帧

---

## 完整示例：if-else 语句

### JavaScript 代码

```javascript
function foo(x) {
  let y = 0;
  if (x > 0) {
    y = x + 1;  // 分支 1
  } else {
    y = x - 1;  // 分支 2
  }
  return y;     // 合并点
}
```

### 字节码（简化）

```
 0: LdaZero        [r0 = 0]
 2: Star r0        [y = 0]
 4: Ldar a0        [acc = x]
 6: TestGreaterThan [r1], [0]
 8: JumpIfFalse @18

// 分支 1 (true)
10: Ldar a0
12: Inc [1]
14: Star r0        [y = x + 1]
16: Jump @24

// 分支 2 (false)
18: Ldar a0
20: Dec [1]
22: Star r0        [y = x - 1]

// 合并点
24: Ldar r0        [acc = y]
26: Return
```

### FrameState 流程

```
偏移 0-8（线性路径）:
  current_interpreter_frame_ = {r0: Constant(0), acc: x}

偏移 8 (JumpIfFalse @18):
  ├─ if (merge_states_[18] == null)
  │    merge_states_[18] = new MergeState(current_interpreter_frame_)
  │    // 第一次创建分支 2 的合并点
  │
  └─ StartFallthroughBlock:
       继续执行分支 1，current_interpreter_frame_ 不变

偏移 10-14（分支 1）:
  current_interpreter_frame_ = {r0: Add(x, 1), acc: Add(x, 1)}

偏移 16 (Jump @24):
  ├─ if (merge_states_[24] == null)
  │    merge_states_[24] = new MergeState(current_interpreter_frame_)
  │    // 第一次创建合并点，快照分支 1 的状态
  │
  └─ 分支 1 结束

------ 回到分支 2 ------

偏移 18 (从 merge_states_[18] 恢复):
  ProcessMergePoint(18):
    current_interpreter_frame_.CopyFrom(merge_states_[18])
    // 恢复到 {r0: Constant(0), acc: x}

偏移 18-22（分支 2）:
  current_interpreter_frame_ = {r0: Sub(x, 1), acc: Sub(x, 1)}

偏移 24 (合并点):
  MergeIntoFrameState(24):
    merge_states_[24]->Merge(current_interpreter_frame_)
    // 将分支 2 的状态合并进去
    // 现在 merge_states_[24] 包含两个前驱的状态

偏移 24 (开始新块):
  ProcessMergePoint(24):
    current_interpreter_frame_.CopyFrom(merge_states_[24])
    // 恢复合并后的状态
    // r0 = Phi(Add(x, 1), Sub(x, 1))
```

---

## Merge 操作（创建 Phi 节点）

### MergePointInterpreterFrameState::Merge

```cpp
// src/maglev/maglev-interpreter-frame-state.h:316-322
void Merge(MaglevGraphBuilder* graph_builder,
           InterpreterFrameState& unmerged,
           BasicBlock* predecessor);
```

**关键逻辑：**
1. 对每个寄存器，比较 `merge_state` 中的值和 `unmerged` 中的值
2. 如果值相同，保持不变
3. 如果值不同，创建 **Phi 节点**

### 示例

```cpp
// 合并点 offset 24
// 前驱 1: r0 = Add(x, 1)
// 前驱 2: r0 = Sub(x, 1)

merge_states_[24]->Merge(graph_builder, current_interpreter_frame_, predecessor);

// 创建 Phi 节点
Phi* phi = new Phi({Add(x, 1), Sub(x, 1)});
merge_states_[24]->frame_state_.r0 = phi;
```

---

## 为什么不是"每次都复制"？

### 误解

> "每处理一条字节码就复制 `current_interpreter_frame_`"

### 实际情况

1. **线性路径：** 直接更新 `current_interpreter_frame_`，无复制
2. **遇到跳转：**
   - 第一次：从 `current_interpreter_frame_` 创建 `merge_states_[target]`
   - 后续：**合并**（Merge）到 `merge_states_[target]`，创建 Phi 节点
3. **从合并点恢复：** `CopyFrom` merge_states_[offset] 到 `current_interpreter_frame_`

**关键：**
- 复制只发生在合并点的**创建**和**恢复**时
- 线性路径没有复制
- 多路径汇聚时是**合并**（Merge），不是简单复制

---

## 内存布局

```
MaglevGraphBuilder:
┌─────────────────────────────────────────────────────────────┐
│ current_interpreter_frame_: InterpreterFrameState           │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ frame_: RegisterFrameArray<ValueNode*>                  │ │
│ │   [param0][param1]...[r0][r1]...                        │ │
│ │ known_node_aspects_: KnownNodeAspects*                  │ │
│ └─────────────────────────────────────────────────────────┘ │
│                                                             │
│ merge_states_: MergePointInterpreterFrameState**            │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ [0]  → null                                             │ │
│ │ [8]  → null                                             │ │
│ │ [18] → MergePointInterpreterFrameState* (分支 2)         │ │
│ │ [24] → MergePointInterpreterFrameState* (合并点)         │ │
│ │ ...                                                     │ │
│ │ [bytecode_length] → null                                │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘

merge_states_[24] (合并点):
┌─────────────────────────────────────────────────────────────┐
│ MergePointInterpreterFrameState                             │
│ ┌─────────────────────────────────────────────────────────┐ │
│ │ frame_state_: CompactInterpreterFrameState              │ │
│ │   r0 → Phi* (inputs: Add(x,1), Sub(x,1))                │ │
│ │   acc → Phi* (...)                                      │ │
│ │                                                         │ │
│ │ predecessor_count_: 2                                   │ │
│ │ predecessors_: [BasicBlock* block1, BasicBlock* block2] │ │
│ │                                                         │ │
│ │ phis_: Phi::List                                        │ │
│ │   → Phi(r0, inputs=[Add(x,1), Sub(x,1)])               │ │
│ │   → Phi(acc, ...)                                       │ │
│ └─────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
```

---

## 循环的特殊处理

### 循环头是特殊的合并点

```javascript
function loop(n) {
  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += i;
  }
  return sum;
}
```

### 字节码（简化）

```
 0: LdaZero
 2: Star r0        [sum = 0]
 4: LdaZero
 6: Star r1        [i = 0]

// 循环头（合并点）
 8: Ldar r1        [acc = i]
10: TestLessThan a0, [0]
12: JumpIfFalse @24

// 循环体
14: Ldar r0
16: Add r1, [1]
18: Star r0        [sum += i]
20: Inc r1, [2]
22: JumpLoop @8    // ← 回边（backedge）

// 循环后
24: Ldar r0
26: Return
```

### FrameState 流程

```
偏移 8（循环头，第一次）:
  merge_states_[8] = NewForLoop(
      current_interpreter_frame_,
      predecessor_count = 2)  // ← 注意：2个前驱（入口 + 回边）

  // 第一次创建时，先用入口状态创建占位 Phi
  // r0 → Phi(Constant(0), ???)  // 回边值暂时未知
  // r1 → Phi(Constant(0), ???)

偏移 14-18（循环体）:
  current_interpreter_frame_ 更新

偏移 22 (JumpLoop @8):
  merge_states_[8]->MergeLoop(current_interpreter_frame_)
  // 更新 Phi 节点的第二个输入（回边值）
  // r0 → Phi(Constant(0), Add(Phi(r0), i))
  // r1 → Phi(Constant(0), Inc(Phi(r1)))
```

**关键：**
- 循环头的 Phi 节点在第一次遇到时创建，但第二个输入是占位符
- JumpLoop 时，用回边的值更新 Phi 节点的第二个输入

---

## 代码引用汇总

### 核心数据结构

```
src/maglev/maglev-graph-builder.cc:1135
  merge_states_ 数组分配

src/maglev/maglev-interpreter-frame-state.h:34-103
  InterpreterFrameState 定义

src/maglev/maglev-interpreter-frame-state.h:291-642
  MergePointInterpreterFrameState 定义
```

### 跳转处理

```
src/maglev/maglev-graph-builder.cc:14743-14749
  VisitJump - 无条件跳转

src/maglev/maglev-graph-builder.cc:14786-14805
  MergeIntoFrameState - 创建或合并到合并点

src/maglev/maglev-graph-builder.cc:15213-15217
  VisitJumpIfTrue - 条件跳转
```

### 合并点处理

```
src/maglev/maglev-graph-builder.cc:16076-16084
  ProcessMergePoint - 从合并点恢复当前帧

src/maglev/maglev-graph-builder.cc:16086-16136
  ProcessMergePointPredecessors - 处理合并点前驱

src/maglev/maglev-interpreter-frame-state.h:111-137
  InterpreterFrameState::CopyFrom - 从合并点拷贝状态
```

### Phi 节点创建

```
src/maglev/maglev-interpreter-frame-state.h:316-322
  MergePointInterpreterFrameState::Merge

src/maglev/maglev-interpreter-frame-state.h:564-574
  MergeValue - 合并单个值（可能创建 Phi）
```

---

## 总结

### 纠正之前的误导

❌ **错误描述：** "整个编译过程只有一个 `current_interpreter_frame_`，每处理一条字节码就更新它。"

✅ **正确理解：**

1. **一个工作帧：** `current_interpreter_frame_` 用于当前遍历路径
2. **数组存储合并点：** `merge_states_[offset]` 存储每个控制流汇聚点的状态
3. **线性路径：** 直接更新工作帧，无复制
4. **遇到跳转：** 合并到 `merge_states_[target]`
5. **到达合并点：** 从 `merge_states_[offset]` 恢复工作帧
6. **多路径汇聚：** 创建 Phi 节点合并不同前驱的值

### 为什么这样设计？

1. **性能：** 线性路径无需复制，只在控制流汇聚时才需要 Phi 节点
2. **正确性：** SSA 形式要求每个变量只有一次赋值，Phi 节点处理多定义点
3. **内存效率：** 只在真正的合并点才分配 MergePointInterpreterFrameState

### 图的遍历方式

V8 使用**深度优先遍历**（DFS）构建控制流图：
- 遇到跳转时，先记录跳转目标（MergeIntoFrameState）
- 继续处理当前路径（fallthrough）
- 当所有前驱都处理完后，才处理合并点（ProcessMergePoint）

**关键：** 不是"只有一个帧并复制"，而是"一个工作帧 + 数组存储合并点 + Phi 节点合并"！
