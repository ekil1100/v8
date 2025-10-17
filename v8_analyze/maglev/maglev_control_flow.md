# Maglev 控制流优化深度分析

**日期**: 2025-10-13
**基于**: V8 主分支 (commit: 5f1d471b6c0)

---

## 目录

2. [核心优化技术](#核心优化技术)
3. [字节码分类与处理](#字节码分类与处理)
4. [关键数据结构](#关键数据结构)
5. [优化实现细节](#优化实现细节)
6. [跨模块依赖](#跨模块依赖)
7. [调试与测试](#调试与测试)
8. [学习路径](#学习路径)

---

## 核心优化技术

1. **分支折叠 (Branch Folding)**: 基于已知类型信息消除不可达分支
2. **CSE (公共子表达式消除)**: 重用重复的比较和测试表达式
3. **循环优化 (Loop Peeling)**: 展开循环第一次迭代
4. **类型驱动优化**: 利用 `KnownNodeAspects` 的类型信息简化控制流

### 1. 分支折叠 (Branch Folding)

**位置**: `src/maglev/maglev-graph-optimizer.cc:252-290`

#### 原理

当编译期可以确定分支条件的布尔值时，将条件分支替换为无条件跳转，消除不可达代码。

#### FoldBranch 调用链（从 Compile 开始）

**完整调用路径**：

```
MaglevCompiler::Compile (src/maglev/maglev-compiler.cc:70)
  ↓
MaglevGraphBuilder::Build (src/maglev/maglev-compiler.cc:102-104)
  ↓ 构建基础 IR 图
[如果启用 v8_flags.maglev_non_eager_inlining]
  ↓
MaglevInliner::Run() (src/maglev/maglev-compiler.cc:109-113)
  ↓ 执行内联优化
MaglevInliner::RunOptimizer() (src/maglev/maglev-inlining.cc:138)
  ↓ 创建图优化器
创建 MaglevGraphOptimizer (src/maglev/maglev-inlining.cc:140)
  ↓
GraphMultiProcessor::ProcessGraph (src/maglev/maglev-inlining.cc:146)
  ↓ 遍历图中所有基本块和节点
遍历各个节点，调用对应的 Visit 方法
  ↓
MaglevGraphOptimizer::VisitBranchIfInt32Compare (src/maglev/maglev-graph-optimizer.cc:2327)
  ↓ 尝试折叠 Int32 比较分支
reducer_.TryFoldInt32CompareOperation (src/maglev/maglev-graph-optimizer.cc:2329)
  ↓ 如果编译时可以确定比较结果
[如果折叠成功，返回布尔值]
  ↓
MaglevGraphOptimizer::FoldBranch (src/maglev/maglev-graph-optimizer.cc:252)
  ↓ 执行分支折叠
返回 ProcessResult::kRevisit (触发重新访问该基本块)
```

**关键触发条件**：

1. **编译阶段**：在 `MaglevCompiler::Compile` 构建完基础图后
2. **标志检查**：需要启用 `--maglev-non-eager-inlining` 标志
3. **内联优化**：在 `MaglevInliner::RunOptimizer()` 阶段
4. **常量折叠**：当 `reducer_.TryFoldInt32CompareOperation` 能够在编译时确定分支条件的值

**调用频率**：

- 每个函数编译时最多执行一次（在内联优化阶段）
- 每个可折叠的条件分支触发一次 FoldBranch

**相关的其他 Visit 方法**（也可能调用 FoldBranch）：

- `VisitBranchIfUint32Compare` (src/maglev/maglev-graph-optimizer.cc:2337)
- `VisitBranchIfFloat64Compare` (待实现，标记为 TODO)
- 其他基于类型的分支节点（目前标记为 `// TODO(b/424157317): Optimize.`）

**注意事项**：

- FoldBranch 只在优化阶段被调用，不在图构建阶段
- 需要 `KnownNodeAspects` 提供类型信息才能有效折叠
- 折叠后会标记图可能有不可达块（`set_may_have_unreachable_blocks(true)`）
- 后续的 `RemoveUnreachableBlocks()` 会清理被折叠的死代码块

#### 逐行代码解释

```cpp
// 函数签名：
// - 参数 1 `current`: 当前包含分支的基本块
// - 参数 2 `branch_node`: 要被折叠的分支节点（条件分支）
// - 参数 3 `if_true`: true 表示条件恒为真，false 表示条件恒为假
// - 返回值: 新创建的无条件跳转节点
Jump* MaglevGraphOptimizer::FoldBranch(BasicBlock* current,
                                       BranchControlNode* branch_node,
                                       bool if_true) {
  // 确定跳转目标块
  // - 如果 `if_true=true`，目标是原分支的 true 分支
  // - 如果 `if_true=false`，目标是原分支的 false 分支
  BasicBlock* target =
      if_true ? branch_node->if_true() : branch_node->if_false();

  // 确定不可达块（将被消除的分支）
  // - 与 `target` 相反的那个分支
  // - 这个块在此路径下永远不会被执行
  BasicBlock* unreachable_block =
      if_true ? branch_node->if_false() : branch_node->if_true();

  // Remove predecessor from unreachable block.
  // 清理不可达块的前驱信息（简单情况）
  // - 检查不可达块是否有状态（合并点状态）
  // - `has_state()` 为 false 表示这个块只有一个前驱
  // - 直接将其前驱设为 null，断开连接
  if (!unreachable_block->has_state()) {
    unreachable_block->set_predecessor(nullptr);
  } else {
    // 复杂情况处理（多个前驱）
    // - 从后向前遍历所有前驱（避免删除时索引混乱）
    // - 不可达块可能从多个路径可达（例如循环）
    // - 只移除 `current` 这个前驱
    // - 调用 `state()->RemovePredecessorAt()` 更新 SSA 的 Phi 节点
    // - 其他前驱保留（因为它们可能仍然可达该块）
    for (int i = unreachable_block->predecessor_count() - 1; i >= 0; i--) {
      if (unreachable_block->predecessor_at(i) == current) {
        unreachable_block->state()->RemovePredecessorAt(i);
      }
    }
  }

  // Update control node.
  // 关键步骤：替换控制节点
  // - 将分支节点（Branch）就地替换为跳转节点（Jump）
  // - `OverwriteWith<Jump>()` 复用原节点的内存位置，避免重新分配和更新所有引用
  // - 设置跳转目标为之前确定的目标块
  Jump* new_control_node = branch_node->OverwriteWith<Jump>();
  new_control_node->set_target(target);

  // Cache predecessor id from the target in the unconditional jump.
  // 计算前驱 ID
  // - 前驱 ID 用于目标块中 Phi 节点确定来自哪个路径的值
  // - 如果目标块没有状态，说明只有一个前驱，ID 固定为 0
  int predecessor_id;
  if (!target->has_state()) {
    predecessor_id = 0;
  } else {
    // 多前驱情况
    // - 遍历目标块的所有前驱
    // - 找到 `current` 在前驱列表中的索引
    // - 这个索引就是前驱 ID（用于 Phi 节点取值）
    // - 将前驱 ID 存入 Jump 节点（缓存优化，避免目标块每次都查找前驱索引）
    for (int i = target->predecessor_count() - 1; i >= 0; i--) {
      if (target->predecessor_at(i) == current) {
        predecessor_id = i;
      }
    }
  }
  new_control_node->set_predecessor_id(predecessor_id);

  // 标记图可能有不可达块
  // - 通知后续 Pass 需要清理死代码
  // - 触发死代码消除（Dead Code Elimination）
  reducer_.graph()->set_may_have_unreachable_blocks(true);

  // 返回新创建的 Jump 节点
  return new_control_node;
}
```

**整体流程总结**：

1. **确定目标和不可达块**
2. **清理不可达块的前驱信息**
   - 单前驱：直接断开
   - 多前驱：只移除当前前驱
3. **替换控制节点**：Branch → Jump
4. **计算并缓存前驱 ID**：用于目标块的 Phi 节点
5. **标记需要清理**：延迟死代码消除
6. **返回新节点**

**关键优化点**：

- ✅ **就地替换**：`OverwriteWith` 避免重新分配
- ✅ **前驱 ID 缓存**：避免重复查找
- ✅ **延迟清理**：只标记不可达块，由后续 Pass 真正删除

#### 优化前后对比

```
优化前：
  [BasicBlock A]
     ↓
  [BranchIfInt32Compare: 5 < 10]
     ├─ true  → [Block B] ✓
     └─ false → [Block C] ✗ (死代码)

  FoldBranch 后：
  [BasicBlock A]
     ↓
  [Jump] ← 节点已经改变！
     ↓
  [Block B]

  [Block C] ← 不可达，会被消除

返回 kRevisit 让优化器：
  - 重新处理修改后的 Jump 节点
  - 可能触发更多优化（比如内联简单的 Jump）
  - 确保后续 pass 看到一致的图状态
```

#### 优化示例

**JavaScript 代码**:

```javascript
function test(x) {
  if (typeof x === "number") {
    return x + 1;
  }
  return 0;
}
```

**未优化的 IR** (假设 x 的类型已知为 Number):

```
CheckType x, Number
Branch [typeof x === 'number']
  IfTrue: BasicBlock#2
  IfFalse: BasicBlock#3
```

**优化后的 IR**:

```
// 分支折叠后
Jump BasicBlock#2  // 直接跳转到 true 分支
// BasicBlock#3 被标记为不可达
```

---

### 2. 公共子表达式消除 (CSE)

**位置**: `src/maglev/maglev-known-node-aspects.h:552-605`

#### 原理

通过哈希表缓存表达式节点，避免重复计算相同的比较或测试操作。

#### 核心数据结构

**位置**: `src/maglev/maglev-known-node-aspects.h:669-672`

```cpp
struct AvailableExpression {
  NodeBase* node;           // 缓存的表达式节点
  uint32_t effect_epoch;    // 副作用时代戳
};

ZoneMap<uint32_t, AvailableExpression> available_expressions_;
```

#### FindExpression 调用链（从 Compile 开始）

**完整调用路径**：

```
MaglevCompiler::Compile (src/maglev/maglev-compiler.cc:70)
  ↓
MaglevGraphBuilder::Build (src/maglev/maglev-compiler.cc:102-104)
  ↓ 构建基础 IR 图，访问字节码
MaglevGraphBuilder::VisitXxx (例如 VisitTestEqual, VisitTestLessThan 等)
  ↓ 构建各种节点
MaglevReducer::AddNewNode / AddNewNodeNoInputConversion (src/maglev/maglev-reducer-inl.h:106-156)
  ↓ 如果 v8_flags.maglev_cse 开启且节点参与 CSE
  ↓ [检查: Node::participate_in_cse(opcode) && ReducerBaseWithKNA]
MaglevReducer::AddNewNodeOrGetEquivalent (src/maglev/maglev-reducer-inl.h:202-256)
  ↓ 计算哈希值
  ↓ cse::fast_hash_combine(opcode, args..., inputs)
KnownNodeAspects::FindExpression (src/maglev/maglev-known-node-aspects.h:553-595)
  ↓ 查找缓存的等价表达式
[如果找到] 返回缓存的节点（CSE 命中）
[如果未找到] 返回 nullptr，调用者创建新节点并通过 AddExpression 缓存
```

**关键触发条件**：

1. **编译阶段**：在图构建阶段（`MaglevGraphBuilder::Build`）
2. **标志检查**：需要启用 `--maglev-cse` 标志（默认启用）
3. **节点类型**：节点必须标记为参与 CSE（`Node::participate_in_cse(opcode) == true`）
4. **基类要求**：Reducer 基类必须支持 `KnownNodeAspects`（`ReducerBaseWithKNA<BaseT>`）

**哪些节点参与 CSE**：

根据 `src/maglev/maglev-ir.h` 中的定义，以下节点类型参与 CSE：

- 所有比较操作：`TaggedEqual`, `TestEqual`, `TestLessThan` 等
- 类型测试：`TestUndetectable`, `TestTypeOf` 等
- 纯数学运算：`Int32Add`, `Float64Multiply` 等
- 不参与的：有副作用的操作（函数调用、属性访问等）

**调用频率**：

- 每次创建可 CSE 的节点时调用一次 FindExpression
- 在典型函数中可能调用数十到数百次
- CSE 命中率取决于代码模式（重复计算越多，命中率越高）

**性能优化点**：

- ✅ **哈希表查找**：O(1) 平均复杂度
- ✅ **早期退出**：哈希未找到时立即返回 nullptr
- ✅ **副作用检查**：通过 effect_epoch 快速判断缓存有效性
- ✅ **输入比较延迟**：只有在所有其他检查通过后才比较输入

---

#### CSE 查找逻辑

**位置**: `src/maglev/maglev-known-node-aspects.h:553-595`

```cpp
template <typename NodeT, typename... Args>
NodeT* FindExpression(uint32_t hash,
                      std::array<ValueNode*, NodeT::kInputCount>& inputs,
                      Args&&... args) {
  auto it = available_expressions_.find(hash);
  if (it == available_expressions_.end()) return nullptr;

  static constexpr Opcode op = Node::opcode_of<NodeT>;
  auto candidate = it->second.node;

  // 检查节点是否已被移除
  if (candidate->Is<Identity>()) {
    available_expressions_.erase(it);
    return nullptr;
  }

  // 验证节点类型和输入数量
  const bool sanity_check =
      candidate->Is<NodeT>() &&
      static_cast<size_t>(candidate->input_count()) == inputs.size();

  // 检查副作用时代戳 (effect epoch)
  const bool epoch_check = !Node::needs_epoch_check(op) ||
                           effect_epoch_ <= it->second.effect_epoch;

  if (sanity_check && epoch_check) {
    // 比较操作数
    if (static_cast<NodeT*>(candidate)->options() ==
        std::forward_as_tuple(std::forward<Args>(args)...)) {
      int i = 0;
      for (const auto& inp : inputs) {
        if (inp != candidate->input(i).node()) break;
        i++;
      }
      if (static_cast<size_t>(i) == inputs.size()) {
        return static_cast<NodeT*>(candidate);  // 找到匹配的表达式
      }
    }
  }

  if (!epoch_check) {
    available_expressions_.erase(it);  // 过期表达式
  }
  return nullptr;
}
```

#### FindExpression 源码与逐行注释

```cpp
// 模板参数 NodeT: 要查找的节点类型（如 TestEqual, Int32Add）
// 模板参数 Args: 节点构造参数（如比较操作的 Operation 类型）
// 参数 hash: 表达式的哈希值（由 cse::fast_hash_combine 计算）
// 参数 inputs: 节点的输入数组（操作数）
// 参数 args: 节点的其他选项（转发给 options() 方法）
// 返回值: 如果找到等价表达式返回缓存的节点，否则返回 nullptr
template <typename NodeT, typename... Args>
NodeT* FindExpression(uint32_t hash,
                      std::array<ValueNode*, NodeT::kInputCount>& inputs,
                      Args&&... args) {

  // 【步骤 1: 哈希查找 - O(1) 时间复杂度】
  // 在 available_expressions_ 哈希表中查找给定哈希值
  // 类型: ZoneMap<uint32_t, AvailableExpression>
  auto it = available_expressions_.find(hash);

  // 早期退出优化: 如果哈希不存在，立即返回 nullptr（最常见的情况）
  // 这是 CSE 的第一道防线
  if (it == available_expressions_.end()) return nullptr;

  // 【步骤 2: 获取节点操作码】
  // 编译时常量，获取 NodeT 对应的操作码
  // 例如: TestEqual → Opcode::kTestEqual
  // 用于后续的副作用检查
  static constexpr Opcode op = Node::opcode_of<NodeT>;

  // 【步骤 3: 提取候选节点】
  // it->second 是 AvailableExpression 结构体，包含:
  //   - node: 缓存的表达式节点
  //   - effect_epoch: 该节点创建时的副作用时代戳
  auto candidate = it->second.node;

  // 【步骤 4: 死节点检测】
  // Identity 节点是被删除节点的占位符
  // 为什么会出现: 节点被优化器移除但仍在哈希表中
  // 设计理由: 避免在每次图修改时更新哈希表（懒惰删除）
  if (candidate->Is<Identity>()) {
    available_expressions_.erase(it);  // 清理操作: 从哈希表中删除这个过期条目
    return nullptr;
  }

  // 【步骤 5: 类型和输入数量验证】
  // 类型检查: candidate->Is<NodeT>() 确保候选节点类型匹配
  //   例如: 查找 TestEqual 时，候选必须也是 TestEqual
  // 输入数量检查: 确保操作数数量匹配
  //   例如: 二元操作必须有 2 个输入
  // 为什么需要: 哈希冲突可能导致不同节点有相同哈希
  const bool sanity_check =
      candidate->Is<NodeT>() &&
      static_cast<size_t>(candidate->input_count()) == inputs.size();
  // Debug 模式下还会验证节点属性一致性（这里省略了 DCHECK）

  // 【步骤 6: 副作用时代戳检查 - 核心优化正确性保证】
  // 条件 1: !Node::needs_epoch_check(op)
  //   - 如果节点是纯操作（无副作用），无需检查时代戳
  //   - 例如: Int32Add, TestEqual 等不依赖外部状态
  // 条件 2: effect_epoch_ <= it->second.effect_epoch
  //   - 检查当前副作用时代戳是否晚于缓存节点的时代戳
  //   - 如果当前 epoch 更大，说明中间发生了副作用操作
  //
  // 时代戳机制:
  //   - effect_epoch_: 全局计数器，从 0 开始
  //   - 每次有副作用的操作（函数调用、属性写入）发生时递增
  //   - 纯操作的 epoch 设为 kEffectEpochForPureInstructions (UINT32_MAX)
  //
  // epoch_check 失败的含义:
  //   - 缓存的表达式已经过期（中间发生了可能影响结果的副作用）
  //   - 必须重新计算，不能使用缓存
  //
  // 示例: function bad_cse() {
  //         let a = obj.x;  // epoch = 0, 读取 obj.x
  //         obj.x = 10;     // epoch++ = 1, 写入 (副作用)
  //         let b = obj.x;  // epoch = 1, 不能重用之前的 obj.x!
  //       }
  const bool epoch_check = !Node::needs_epoch_check(op) ||
                           effect_epoch_ <= it->second.effect_epoch;

  // 【步骤 7: 进入深度匹配】
  // 只有在类型、输入数量和副作用检查都通过后才进行昂贵的比较
  // 性能优化: 避免不必要的输入比较（O(n) 操作）
  if (sanity_check && epoch_check) {

    // 【步骤 7.1: 节点选项比较】
    // options() 返回节点的配置参数元组
    // 例如: TestEqual 的 options() 可能返回 std::tuple<Operation>
    // 作用: 确保节点的语义选项相同
    // 示例: TestEqual 和 TestStrictEqual 有不同的 Operation 类型
    //
    // 为什么需要这个检查:
    //   v1 = TestEqual(x, y, Operation::kEqual)
    //   v2 = TestEqual(x, y, Operation::kStrictEqual)
    //   这两个节点哈希可能相同，但语义不同
    if (static_cast<NodeT*>(candidate)->options() ==
        std::forward_as_tuple(std::forward<Args>(args)...)) {

      // 【步骤 7.2: 输入节点逐一比较】
      // 循环目的: 检查所有输入是否完全匹配
      // 指针比较: inp != candidate->input(i).node()
      //   - SSA 形式中，相同值必然是同一个 ValueNode 指针
      //   - 无需比较值，只需比较指针
      int i = 0;
      for (const auto& inp : inputs) {
        if (inp != candidate->input(i).node()) break;  // 早期退出: 一旦发现不匹配立即 break
        i++;
      }

      // 成功条件: i == inputs.size() 说明所有输入都匹配
      if (static_cast<size_t>(i) == inputs.size()) {
        // 返回缓存节点: CSE 命中！重用之前的计算结果
        // CSE 命中示例:
        //   v1 = TestEqual(x, y)  // 第一次: 创建新节点，缓存到哈希表
        //   v2 = TestEqual(x, y)  // 第二次: FindExpression 返回 v1（CSE 命中）
        return static_cast<NodeT*>(candidate);
      }
    }
  }

  // 【步骤 8: 清理过期缓存】
  // 如果 epoch 检查失败，说明缓存已过期
  // 从哈希表中删除这个条目，避免未来的错误匹配
  // 懒惰清理策略: 只在查找时清理，不在每次副作用时遍历整个表
  if (!epoch_check) {
    available_expressions_.erase(it);
  }

  // 【CSE 未命中】
  // 返回 nullptr 通知调用者需要创建新节点
  // 调用者（AddNewNodeOrGetEquivalent）会:
  //   1. 创建新的 NodeT 实例
  //   2. 通过 AddExpression(hash, node) 将其加入缓存
  //   3. 返回新节点
  return nullptr;
}
```

---

#### FindExpression 完整执行流程总结

**快速路径（最常见）**：

1. 哈希查找 → 未找到 → 返回 nullptr（创建新节点）

**缓存命中路径**：

1. 哈希查找 → 找到候选
2. 死节点检测 → 通过
3. 类型和输入数量检查 → 通过
4. 副作用时代戳检查 → 通过
5. 节点选项比较 → 匹配
6. 输入节点逐一比较 → 全部匹配
7. 返回缓存节点（CSE 成功！）

**失败路径**：

- 任何检查失败 → 返回 nullptr
- 如果是 epoch 失败 → 额外清理过期缓存

**性能关键点**：

- ✅ 哈希表查找：O(1)
- ✅ 早期退出：大部分情况在前几步就确定结果
- ✅ 懒惰清理：避免全局遍历
- ✅ 指针比较：无需深度值比较

#### 副作用时代戳机制

- `effect_epoch_`: 全局计数器，每次有副作用的操作（如函数调用）发生时递增
- 纯操作的 epoch 设为 `kEffectEpochForPureInstructions` (UINT32_MAX)
- 比较表达式的 epoch 和当前 epoch，判断缓存是否有效

#### CSE 优化示例

**JavaScript 代码**:

```javascript
function compare(x, y) {
  if (x < y) {
    console.log(x < y); // 重复比较
  }
}
```

**未优化的 IR**:

```
v1 = TestLessThan x, y
Branch v1
  IfTrue:
    v2 = TestLessThan x, y  // 重复计算
    Call console.log, v2
```

**CSE 优化后**:

```
v1 = TestLessThan x, y
Branch v1
  IfTrue:
    Call console.log, v1  // 重用 v1
```

#### AddNewNodeOrGetEquivalent - CSE 的核心实现

**位置**: `src/maglev/maglev-reducer-inl.h:202-256`

这是 **Maglev CSE 的统一节点创建入口**，负责"先查找缓存，未命中再创建"的逻辑。

##### 函数签名

```cpp
template <typename NodeT, typename... Args>
NodeT* AddNewNodeOrGetEquivalent(
    bool convert_inputs,
    std::initializer_list<ValueNode*> raw_inputs,
    Args&&... args) {
```

**参数说明**：

- `NodeT`: 要创建的节点类型（如 `TestEqual`, `Int32Add`）
- `convert_inputs`: 是否需要类型转换输入（true=转换，false=直接使用）
- `raw_inputs`: 原始输入节点列表
- `args`: 转发给节点构造函数的其他参数

---

##### 源码与逐行注释

```cpp
template <typename NodeT, typename... Args>
NodeT* AddNewNodeOrGetEquivalent(
    bool convert_inputs,
    std::initializer_list<ValueNode*> raw_inputs,
    Args&&... args) {

  // 【前置检查 - 编译时和运行时验证】
  DCHECK(v8_flags.maglev_cse);                  // 运行时断言: 确保 CSE 标志已启用
  static constexpr Opcode op = Node::opcode_of<NodeT>;  // 编译时获取节点的操作码
  static_assert(Node::participate_in_cse(op));  // 静态断言: 确保该节点类型参与 CSE
                                                 // 只有纯操作或可安全缓存的操作才能参与 CSE
                                                 // 有副作用的操作（如函数调用）不参与

  // 【类型系统验证 - 编译时】
  // 获取 NodeT::options() 的返回类型
  using options_result =
      std::invoke_result_t<decltype(&NodeT::options), const NodeT>;
  // 验证 options() 返回的元组类型与构造参数匹配
  // 目的: 确保 CSE 可以通过 options() 比较节点的配置参数
  // 示例: TestEqual 的 options() 返回 std::tuple<Operation>
  //       auto options() const { return std::tuple{operation_}; }
  static_assert(std::is_assignable_v<options_result, std::tuple<Args...>>,
                "Instruction participating in CSE needs options() returning "
                "a tuple matching the constructor arguments");

  // 【输入约束检查】
  static_assert(IsFixedInputNode<NodeT>());    // 确保节点有固定数量的输入（不是可变输入）
  static_assert(NodeT::kInputCount <= 3);      // 限制最多 3 个输入（性能优化，避免大数组）
                                                // 大部分操作是 1-2 个输入（一元/二元操作）
                                                // 少数操作是 3 个输入

  // 【步骤 1: 输入转换和标准化】
  // 创建固定大小的输入数组，类型: std::array，避免动态分配
  std::array<ValueNode*, NodeT::kInputCount> inputs;

  // 如果节点有输入，开始处理
  if constexpr (NodeT::kInputCount > 0) {
    int i = 0;
    // ShouldRecordUseReprHint: 决定是否记录使用表示提示（用于后续优化）
    // 帮助 Phi 表示选择器决定最优的值表示
    constexpr UseReprHintRecording hint = ShouldRecordUseReprHint<NodeT>();

    // 遍历每个输入节点
    for (ValueNode* raw_input : raw_inputs) {
      if (convert_inputs) {
        // convert_inputs = true: 调用 ConvertInputTo 进行类型转换
        // 示例: Smi → Int32, Tagged → Float64
        // 确保输入类型匹配节点期望的类型（NodeT::kInputTypes[i]）
        inputs[i] = ConvertInputTo<hint>(raw_input, NodeT::kInputTypes[i]);
      } else {
        // convert_inputs = false: 验证输入类型已经正确（运行时检查）
        CHECK(ValueRepresentationIs(
            raw_input->properties().value_representation(),
            NodeT::kInputTypes[i]));
        inputs[i] = raw_input;  // 直接使用原始输入
      }
      i++;
    }

    // 【交换律标准化 - CSE 命中率优化】
    // 检查节点是否满足交换律
    // 交换律操作: 加法、乘法、按位与/或/异或、相等比较
    // 非交换律: 减法、除法、小于比较
    if constexpr (IsCommutativeNode(Node::opcode_of<NodeT>)) {
      static_assert(NodeT::kInputCount == 2);  // 交换律操作必须有 2 个输入

      // 标准化输入顺序:
      // 规则 1: 常量总是放在右边（inputs[1]）
      //   例如: Add(5, x) → Add(x, 5)
      // 规则 2: 如果都不是常量，按指针地址排序
      //   例如: Add(b, a) → Add(a, b) (假设 a < b)
      //
      // 为什么需要标准化？
      //   没有标准化: v1 = Add(x, 5) → hash1, v2 = Add(5, x) → hash2 (不同)
      //   标准化后: v1 = Add(x, 5) → hash1, v2 = Add(x, 5) → hash1 (相同)
      //
      // 性能影响:
      //   ✅ 提高 CSE 命中率（可能提升 10-20%）
      //   ✅ 减少重复计算
      if ((IsConstantNode(inputs[0]->opcode()) || inputs[0] > inputs[1]) &&
          !IsConstantNode(inputs[1]->opcode())) {
        std:: swap(inputs[0], inputs[1]);
      }
    }
  }

  // 【步骤 2: 计算表达式哈希值】
  // 哈希组合三要素:
  //   1. 操作码 (op): 节点类型，例如 kTestEqual, kInt32Add
  //   2. 选项参数 (args): 节点配置，例如 Operation::kEqual, 比较模式
  //   3. 输入节点 (inputs): 操作数，使用指针地址计算哈希
  //
  // 哈希计算示例:
  //   TestEqual(x, y, Operation::kStrictEqual)
  //   hash = fast_hash_combine(
  //       fast_hash_combine(hash(kTestEqual), hash(kStrictEqual)),
  //       hash(x) ^ hash(y)
  //   )
  //
  // 哈希函数特性:
  //   - 快速: 基于 Boost 的哈希组合（位移和异或）
  //   - 分布均匀: 减少冲突
  //   - 确定性: 相同输入总是产生相同哈希
  uint32_t hash = static_cast<uint32_t>(cse::fast_hash_combine(
      cse::fast_hash_combine(base::hash_value(op), std::forward<Args>(args)...),
      inputs));

  // 【步骤 3: 查找缓存的等价表达式】
  // 调用 FindExpression（之前详细解释过的函数）:
  //   - 在 available_expressions_ 哈希表中查找
  //   - 进行类型检查、副作用检查、输入比较
  NodeT* node = known_node_aspects().template FindExpression<NodeT>(
      hash, inputs, std::forward<Args>(args)...);

  // CSE 命中（快速路径）:
  //   - FindExpression 返回非空节点
  //   - 立即返回缓存的节点，无需创建新节点
  //   - 性能提升: 避免节点分配、初始化、图添加等开销
  //
  // 流程: hash → FindExpression
  //               ↓ 找到
  //             [返回缓存节点] ← ✅ CSE 成功，提前退出
  if (node) return node;

  // 【步骤 4: 创建新节点 - CSE 未命中】
  // 分配新节点:
  //   - NodeBase::New: 在 Zone 分配器中分配内存
  //   - Zone 是 V8 的快速内存分配器（批量释放）
  //   - 调用 NodeT 的构造函数，传递参数
  node =
      NodeBase::New<NodeT>(zone(), inputs.size(), std::forward<Args>(args)...);

  // 设置输入节点:
  //   - SetNodeInputsNoConversion: 无需转换，因为步骤 1 已处理
  //   - 将 inputs 数组连接到节点的输入边
  //
  // 节点结构示例:
  //   TestEqual 节点
  //     ├─ opcode: kTestEqual
  //     ├─ options: {Operation::kEqual}
  //     ├─ input[0] → x
  //     └─ input[1] → y
  SetNodeInputsNoConversion(node, inputs);

  // 【调试验证】
  // Debug 模式下验证节点的 options() 返回值与构造参数一致
  // 确保 options() 方法实现正确
  // Release 模式下会被编译器移除
  DCHECK_EQ(node->options(), std::tuple{std::forward<Args>(args)...});

  // 【步骤 5: 缓存新节点】
  // 添加到 CSE 哈希表:
  //   available_expressions_[hash] = {
  //       .node = node,
  //       .effect_epoch = current_effect_epoch_
  //   };
  //
  // 作用:
  //   - 后续遇到相同表达式时，FindExpression 可以找到这个节点
  //   - 记录创建时的副作用时代戳，用于缓存有效性检查
  //
  // 缓存生命周期（一直有效，直到）:
  //   1. 发生副作用，effect_epoch 增加导致过期
  //   2. 节点被删除，变成 Identity 占位符
  //   3. 基本块结束，缓存被清空
  known_node_aspects().AddExpression(hash, node);

  // 【步骤 6: 附加元数据并添加到图】
  // AttachExtraInfoAndAddToGraph 执行的操作:
  //   1. 附加 Deopt 信息（如果节点可能反优化）
  //      - Eager deopt: 检查失败时立即反优化
  //      - Lazy deopt: 调用返回后可能反优化
  //   2. 附加异常处理信息（如果节点可能抛出异常）
  //   3. 添加到当前基本块（将节点插入到基本块的节点列表）
  //   4. 注册到图标签器（用于调试和可视化）
  //   5. 标记副作用（如果节点有写操作，递增 effect_epoch_）
  //   6. 返回节点
  //
  // 最终结果:
  //   - 节点已完全初始化
  //   - 节点已连接到图中
  //   - 节点已缓存（可被 CSE 重用）
  return AttachExtraInfoAndAddToGraph(node);
}
```

---

##### 完整执行流程总结

**快速路径（CSE 命中 - 最优情况）**：

```
1. 输入标准化（交换律）
2. 计算哈希
3. FindExpression → 找到缓存节点 ✅
4. 立即返回（跳过节点创建）
```

**时间复杂度**：O(1) 哈希查找 + O(n) 输入比较（n ≤ 3）

---

**慢路径（CSE 未命中 - 需要创建节点）**：

```
1. 输入标准化（交换律）
2. 计算哈希
3. FindExpression → 未找到
4. 创建新节点（内存分配）
5. 设置输入边
6. 缓存节点（AddExpression）
7. 添加到图（附加元数据）
8. 返回新节点
```

**时间复杂度**：O(1) 哈希查找 + O(1) 节点创建 + O(1) 缓存插入

---

##### 调用链回顾

```
MaglevGraphBuilder::VisitTestEqual()           // 字节码处理
  ↓
MaglevReducer::AddNewNode({lhs, rhs}, args)    // 通用节点创建接口
  ↓ [检查: CSE 启用 && 节点参与 CSE]
MaglevReducer::AddNewNodeOrGetEquivalent(...)  // 本函数 ← 我们在这里
  ↓ [查找缓存]
KnownNodeAspects::FindExpression(...)
  ↓ [如果找到]
返回缓存节点 ✅
  ↓ [如果未找到]
创建新节点 → 缓存 → 添加到图 → 返回 ✅
```

---

##### 性能优化技巧总结

| 优化技术         | 作用                   | 性能提升        |
| ---------------- | ---------------------- | --------------- |
| **交换律标准化** | 提高 CSE 命中率        | 10-20%          |
| **早期退出**     | CSE 命中时避免节点创建 | 50-70% (命中时) |
| **哈希表缓存**   | O(1) 查找时间          | 极快            |
| **输入预转换**   | 一次转换，多次使用     | 减少重复转换    |
| **懒惰清理**     | 避免遍历清理           | 减少维护开销    |

---

##### 典型应用场景

**场景 1: 重复比较**

```javascript
function test(x, y) {
  if (x === y) {
    return x === y ? 1 : 0; // 第二个比较被 CSE
  }
}
```

编译结果：

```cpp
v1 = AddNewNodeOrGetEquivalent<TestEqualStrict>({x, y})  // 创建
v2 = AddNewNodeOrGetEquivalent<TestEqualStrict>({x, y})  // CSE 命中 → 返回 v1
// v1 和 v2 是同一个节点！
```

---

**场景 2: 交换律优化**

```javascript
function add(a, b) {
  let x = a + 10;
  let y = 10 + a; // 标准化后可以 CSE
}
```

编译结果：

```cpp
// 第一次
v1 = AddNewNodeOrGetEquivalent<Int32Add>({a, 10})
  → 标准化: {a, 10} (10 是常量，放右边)
  → 创建节点

// 第二次
v2 = AddNewNodeOrGetEquivalent<Int32Add>({10, a})
  → 标准化: {a, 10} (交换顺序！)
  → FindExpression 找到 v1
  → 返回 v1 (CSE 命中)
```

---

**场景 3: 副作用阻止 CSE**

```javascript
function bad(obj) {
  let a = obj.x; // 读取 obj.x
  obj.x = 10; // 写入 (副作用)
  let b = obj.x; // 不能 CSE，epoch 已增加
}
```

编译结果：

```cpp
v1 = LoadNamed(obj, "x")          // epoch = 0, 缓存
StoreNamed(obj, "x", 10)          // epoch++，有副作用
v2 = LoadNamed(obj, "x")          // epoch = 1, epoch_check 失败
// v2 不能重用 v1（正确！因为 obj.x 的值已改变）
```

---

### 3. 循环优化 (Loop Peeling)

**位置**: `src/maglev/maglev-graph-builder.h:120-121`

#### 原理

将循环的第一次迭代复制到循环外执行，使得循环内的优化有更精确的类型信息。

#### 实现步骤

```cpp
void MaglevGraphBuilder::PeelLoop();        // 触发循环剥离
void MaglevGraphBuilder::BuildLoopForPeeling();  // 构建剥离版本
```

#### 优化效果

**原始循环**:

```javascript
for (let i = 0; i < arr.length; i++) {
  arr[i] = arr[i] * 2; // 第一次迭代时 i 已知为 0
}
```

**剥离后**:

```
// 第一次迭代 (peeled)
arr[0] = arr[0] * 2;

// 循环体 (剩余迭代)
for (let i = 1; i < arr.length; i++) {
  arr[i] = arr[i] * 2;
}
```

**优势**:

1. 第一次迭代可以完全内联和常量折叠
2. 循环内的 Phi 节点有更精确的类型
3. 减少循环内的类型检查

#### PeelLoop 调用链（从 Compile 开始）

**完整调用路径**：

```
MaglevCompiler::Compile (src/maglev/maglev-compiler.cc:70)
  ↓
MaglevGraphBuilder::Build (src/maglev/maglev-compiler.cc:102-104)
  ↓ 构建基础 IR 图，遍历字节码
MaglevGraphBuilder::BuildBody (src/maglev/maglev-graph-builder.cc:13995-14010)
  ↓ 遍历字节码构建图
VisitSingleBytecode() 遇到 JumpLoop 字节码
  ↓ 检查是否需要剥离循环
  ↓ [条件: loop_headers_to_peel_.Contains(loop_header)]
MaglevGraphBuilder::PeelLoop() (src/maglev/maglev-graph-builder.cc:14496-14512)
  ↓ 启动循环剥离
  ↓ 循环调用 BuildLoopForPeeling()
MaglevGraphBuilder::BuildLoopForPeeling() (src/maglev/maglev-graph-builder.cc:14533-14643)
  ↓ 构建剥离后的循环体
  ↓ 重置状态，准备构建实际循环
```

**触发条件**：

1. 循环被标记为需要剥离（`loop_headers_to_peel_.Contains(loop_header)`）
2. 在图构建阶段遇到 `JumpLoop` 字节码
3. 允许循环剥离（`allow_loop_peeling_ == true`）

#### 逐行代码解释

##### PeelLoop 函数

**位置**: `src/maglev/maglev-graph-builder.cc:14496-14512`

```cpp
// 函数功能：启动循环剥离流程，复制循环的第一次（或多次）迭代
void MaglevGraphBuilder::PeelLoop() {
  // 获取当前循环头的字节码偏移量
  int loop_header = iterator_.current_offset();

  // 确认这个循环确实被标记为需要剥离
  DCHECK(loop_headers_to_peel_.Contains(loop_header));
  DCHECK(!in_peeled_iteration());

  // 设置剥离迭代次数
  // - v8_flags.maglev_optimistic_peeled_loops 为 true 时剥离 2 次迭代
  // - 否则只剥离 1 次迭代
  peeled_iteration_count_ = v8_flags.maglev_optimistic_peeled_loops ? 2 : 1;

  // 标记至少有一个循环被剥离（影响后续优化决策）
  any_peeled_loop_ = true;

  // 禁止嵌套循环剥离（只剥离最内层循环）
  allow_loop_peeling_ = false;

  TRACE("  * Begin loop peeling....");

  // 循环处理所有剥离的迭代
  // - 每次调用 BuildLoopForPeeling() 处理一次迭代
  // - peeled_iteration_count_ 在每次迭代后递减
  while (in_peeled_iteration()) {
    BuildLoopForPeeling();
  }

  // 发出实际的（未剥离的）循环
  // - 如果 iterator 仍然指向循环头，说明需要构建真正的循环
  // - 这是剥离完成后的正常循环体
  if (loop_header == iterator_.current_offset()) {
    BuildLoopForPeeling();
  }

  // 恢复循环剥离能力（用于其他循环）
  allow_loop_peeling_ = true;
}
```

##### BuildLoopForPeeling 函数

**位置**: `src/maglev/maglev-graph-builder.cc:14533-14643`

```cpp
// 函数功能：构建循环的剥离版本或最终版本
void MaglevGraphBuilder::BuildLoopForPeeling() {
  // 获取循环头偏移量
  int loop_header = iterator_.current_offset();
  DCHECK(loop_headers_to_peel_.Contains(loop_header));

  // 判断是否需要跟踪剥离迭代的副作用
  // - 仅在乐观剥离模式下且是第二次剥离时启用
  // - 用于更精确的别名分析和优化
  bool track_peeled_effects =
      v8_flags.maglev_optimistic_peeled_loops && peeled_iteration_count_ == 2;
  if (track_peeled_effects) {
    BeginLoopEffects(loop_header);
  }

#ifdef DEBUG
  bool was_in_peeled_iteration = in_peeled_iteration();
#endif  // DEBUG

  // 遍历循环体中的所有字节码，直到遇到 JumpLoop
  // - 对于剥离迭代，这会生成展开的代码
  // - 对于实际循环，这会生成正常的循环体
  while (iterator_.current_bytecode() != interpreter::Bytecode::kJumpLoop) {
    local_isolate_->heap()->Safepoint();

    // 访问单个字节码并构建对应的 IR 节点
    // - 如果返回 DoneWithAbort，标记字节码为死代码
    if (VisitSingleBytecode().IsDoneWithAbort()) {
      MarkBytecodeDead();
    }
    iterator_.Advance();
  }

  // 处理 JumpLoop 字节码（循环回边）
  if (VisitSingleBytecode().IsDoneWithAbort()) {
    MarkBytecodeDead();
  }

  DCHECK_EQ(was_in_peeled_iteration, in_peeled_iteration());

  // 如果已经完成所有剥离迭代，直接返回
  if (!in_peeled_iteration()) {
    return;
  }

  // 如果剥离的迭代被合并或 JumpLoop 已死，完成清理工作
  // - TryMergeLoop 可能会合并简单的循环
  // - 清理前驱偏移量和剥离目标
  if (!current_block()) {
    decremented_predecessor_offsets_.clear();
    KillPeeledLoopTargets(peeled_iteration_count_);
    peeled_iteration_count_ = 0;
    if (track_peeled_effects) {
      EndLoopEffects(loop_header);
    }
    return;
  }

  // 递减剥离迭代计数器（准备下一次迭代）
  peeled_iteration_count_--;

  // 重置图构建状态，准备重新处理循环体
  // 这样可以用不同的类型信息重新构建循环

  // 1. 重置异常处理表索引到循环之前的位置
  HandlerTable table(*bytecode().object());
  while (next_handler_table_index_ > 0) {
    next_handler_table_index_--;
    int start = table.GetRangeStart(next_handler_table_index_);
    if (start < loop_header) break;
  }

  // 2. 重新创建 catch 处理块的合并状态
  // - 保留异常处理器（它们不属于循环优化范畴）
  // - 清除非循环的合并状态（它们将被重新创建）
  for (int offset = loop_header; offset <= iterator_.current_offset();
       ++offset) {
    if (auto& merge_state = merge_states_[offset]) {
      if (merge_state->is_exception_handler()) {
        // 异常处理器需要重新创建，保留原有信息
        merge_state = MergePointInterpreterFrameState::NewForCatchBlock(
            *compilation_unit_, merge_state->frame_state().liveness(), offset,
            merge_state->exception_handler_was_used(),
            merge_state->catch_block_context_register(), graph_);
      } else {
        // 只剥离最内层循环，因此非异常处理器的合并状态清空
        DCHECK(!merge_state->is_loop());
        merge_state = nullptr;
      }
    }
    // 重置跳转目标引用
    new (&jump_targets_[offset]) BasicBlockRef();
  }

  // 3. 恢复前驱计数（就像循环体未被访问过一样）
  // - 在剥离迭代期间，前驱计数被减少
  // - 现在需要恢复，以便正确构建实际循环
  for (int offset : decremented_predecessor_offsets_) {
    DCHECK_GE(offset, loop_header);
    if (offset <= iterator_.current_offset()) {
      UpdatePredecessorCount(offset, 1);
    }
  }
  decremented_predecessor_offsets_.clear();

  DCHECK(current_block());

  // 4. 初始化实际循环头的前驱计数为 2
  // - 一个来自循环前的代码（进入循环）
  // - 一个来自 JumpLoop（回边）
  InitializePredecessorCount(loop_header, 2);

  // 5. 创建循环合并状态
  // - 标记为 has_been_peeled = true，影响后续优化
  // - 使用当前帧状态和活性信息
  merge_states_[loop_header] = MergePointInterpreterFrameState::NewForLoop(
      current_interpreter_frame_, graph_, *compilation_unit_, loop_header, 2,
      GetInLivenessFor(loop_header),
      &bytecode_analysis_.GetLoopInfoFor(loop_header),
      /* has_been_peeled */ true);

  // 6. 完成当前块，创建跳转到实际循环头的 Jump 节点
  BasicBlock* block = FinishBlock<Jump>({}, &jump_targets_[loop_header]);

  // 继续构建实际的循环...
  // （省略部分代码：重置字节码迭代器并准备构建真正的循环）
}
```

**关键设计点**：

1. **双阶段构建**：

   - 第一阶段：构建剥离的迭代（展开的代码）
   - 第二阶段：构建实际的循环（带有更精确的类型信息）

2. **状态重置**：

   - 异常处理表重置
   - 合并状态清除
   - 前驱计数恢复
   - 这样可以用不同的优化信息重新构建循环

3. **乐观剥离**：

   - 标志 `v8_flags.maglev_optimistic_peeled_loops` 允许剥离 2 次迭代
   - 更多的剥离提供更精确的类型信息，但增加代码大小

4. **副作用跟踪**：
   - `BeginLoopEffects` / `EndLoopEffects` 用于跟踪内存副作用
   - 帮助别名分析和后续优化

---

### 4. 类型驱动的控制流优化

#### 利用 `NodeType` 简化分支

**示例 1: TestUndetectable**

**位置**: `src/maglev/maglev-graph-builder.cc:3546-3587`

```cpp
ValueNode* MaglevGraphBuilder::BuildTestUndetectable(ValueNode* value) {
  // 1. Float64 特殊处理
  if (value->properties().value_representation() == ValueRepresentation::kHoleyFloat64) {
#ifdef V8_ENABLE_UNDEFINED_DOUBLE
    return AddNewNodeNoInputConversion<HoleyFloat64IsUndefinedOrHole>({value});
#else
    return AddNewNodeNoInputConversion<HoleyFloat64IsHole>({value});
#endif
  }

  // 2. 非 Tagged 类型直接返回 false
  if (value->properties().value_representation() != ValueRepresentation::kTagged) {
    return GetBooleanConstant(false);
  }

  // 3. 常量折叠
  if (auto maybe_constant = TryGetConstant(value)) {
    auto map = maybe_constant.value().map(broker());
    return GetBooleanConstant(map.is_undetectable());
  }

  // 4. Smi 检查
  NodeType node_type;
  if (CheckType(value, NodeType::kSmi, &node_type)) {
    return GetBooleanConstant(false);
  }

  // 5. 基于已知 Map 优化
  if (auto possible_maps = known_node_aspects().TryGetPossibleMaps(value)) {
    DCHECK_GT(possible_maps->size(), 0);
    bool first_is_undetectable = possible_maps->at(0).is_undetectable();
    bool all_the_same_value =
        std::all_of(possible_maps->begin(), possible_maps->end(),
                    [first_is_undetectable](compiler::MapRef map) {
                      bool is_undetectable = map.is_undetectable();
                      return (first_is_undetectable && is_undetectable) ||
                             (!first_is_undetectable && !is_undetectable);
                    });
    if (all_the_same_value) {
      return GetBooleanConstant(first_is_undetectable);
    }
  }

  // 6. 无法优化，生成运行时检查
  enum CheckType type = GetCheckType(node_type);
  return AddNewNodeNoInputConversion<TestUndetectable>({value}, type);
}
```

#### BuildTestUndetectable 调用链（从 Compile 开始）

**完整调用路径**：

```
MaglevCompiler::Compile (src/maglev/maglev-compiler.cc:70)
  ↓
MaglevGraphBuilder::Build (src/maglev/maglev-compiler.cc:102-104)
  ↓ 构建基础 IR 图，遍历字节码
MaglevGraphBuilder::BuildBody (src/maglev/maglev-graph-builder.cc:13995-14010)
  ↓ 遇到测试类字节码
MaglevGraphBuilder::VisitTestUndetectable() (src/maglev/maglev-graph-builder.cc:12924-12927)
  ↓ 处理 TestUndetectable 字节码
  ↓ 调用通用的不可检测对象测试构建器
MaglevGraphBuilder::BuildTestUndetectable() (src/maglev/maglev-graph-builder.cc:3546-3587)
  ↓ 根据类型信息决定优化策略
  ↓ [分支1: Float64] → HoleyFloat64IsUndefinedOrHole/HoleyFloat64IsHole
  ↓ [分支2: 非Tagged] → GetBooleanConstant(false)
  ↓ [分支3: 常量] → 常量折叠
  ↓ [分支4: Smi] → GetBooleanConstant(false)
  ↓ [分支5: 已知Maps] → 可能常量折叠
  ↓ [分支6: 默认] → TestUndetectable 节点
```

**触发条件**：

1. JavaScript 代码使用 `== null` 或 `== undefined`（非严格相等）
2. 字节码生成 `TestUndetectable` 指令
3. 在图构建阶段遇到该字节码

#### 逐行代码解释

**位置**: `src/maglev/maglev-graph-builder.cc:3546-3587`

```cpp
// 函数功能：构建测试对象是否为不可检测类型（null, undefined, document.all）
// 返回一个布尔值节点，表示测试结果
ValueNode* MaglevGraphBuilder::BuildTestUndetectable(ValueNode* value) {
  // 1. Float64 特殊处理
  // - HoleyFloat64 是 V8 中带"洞"的浮点数表示
  // - "洞"表示未初始化的数组元素或 undefined
  if (value->properties().value_representation() ==
      ValueRepresentation::kHoleyFloat64) {
#ifdef V8_ENABLE_UNDEFINED_DOUBLE
    // V8_ENABLE_UNDEFINED_DOUBLE: 特殊编译选项
    // - 启用时，undefined 在 Float64 中有特殊编码
    // - 生成节点检查是 undefined 还是 hole
    return AddNewNodeNoInputConversion<HoleyFloat64IsUndefinedOrHole>({value});
#else
    // 未启用特殊编码时，只检查 hole
    return AddNewNodeNoInputConversion<HoleyFloat64IsHole>({value});
#endif  // V8_ENABLE_UNDEFINED_DOUBLE
  }

  // 2. 非 Tagged 类型直接返回 false
  // - Smi、Int32、Float64 等非对象类型不可能是不可检测对象
  // - 编译期确定结果，无需生成运行时检查
  else if (value->properties().value_representation() !=
           ValueRepresentation::kTagged) {
    return GetBooleanConstant(false);
  }

  // 3. 常量折叠
  // - 如果值在编译期已知，直接查询其 Map 的属性
  if (auto maybe_constant = TryGetConstant(value)) {
    auto map = maybe_constant.value().map(broker());
    // Map 有 is_undetectable 位，指示对象是否为不可检测类型
    // - null, undefined: 不可检测
    // - document.all: 历史原因，也是不可检测对象
    return GetBooleanConstant(map.is_undetectable());
  }

  // 4. Smi 检查
  // - Smi（小整数）不是对象，因此不可能是不可检测对象
  // - node_type 用于后续的类型检查优化
  NodeType node_type;
  if (CheckType(value, NodeType::kSmi, &node_type)) {
    return GetBooleanConstant(false);
  }

  // 5. 基于已知 Map 优化
  // - KnownNodeAspects 跟踪节点可能的所有 Map
  // - 如果所有可能的 Map 都具有相同的 is_undetectable 属性，
  //   就可以在编译期确定结果
  if (auto possible_maps = known_node_aspects().TryGetPossibleMaps(value)) {
    // 检查所有可能的 Map 是否具有相同的 undetectable 值
    DCHECK_GT(possible_maps->size(), 0);
    bool first_is_undetectable = possible_maps->at(0).is_undetectable();

    // 使用 std::all_of 检查所有 Map
    bool all_the_same_value =
        std::all_of(possible_maps->begin(), possible_maps->end(),
                    [first_is_undetectable](compiler::MapRef map) {
                      bool is_undetectable = map.is_undetectable();
                      // 所有 Map 要么都是 undetectable，要么都不是
                      return (first_is_undetectable && is_undetectable) ||
                             (!first_is_undetectable && !is_undetectable);
                    });

    // 如果所有可能的 Map 都一致，返回常量
    if (all_the_same_value) {
      return GetBooleanConstant(first_is_undetectable);
    }
    // 否则，不同 Map 有不同结果，无法折叠为常量
  }

  // 6. 无法优化，生成运行时检查
  // - GetCheckType 根据 node_type 生成适当的类型检查
  // - TestUndetectable 节点在运行时检查对象的 Map
  enum CheckType type = GetCheckType(node_type);
  return AddNewNodeNoInputConversion<TestUndetectable>({value}, type);
}
```

**优化层级（从强到弱）**：

1. **表示类型优化**: Float64/非 Tagged → 专用节点或常量
2. **常量折叠**: 编译期确定结果 → `RootConstant(true/false)`
3. **类型特化**: Smi 检查 → 常量 false
4. **Map 推断**: 所有可能 Map 一致 → 常量折叠
5. **运行时检查**: 无法静态优化 → 生成 `TestUndetectable` 节点

**关键优化点**：

- ✅ **多层级优化策略**：从表示类型到 Map 推断，逐级尝试
- ✅ **零成本抽象**：编译期可确定的情况下，生成常量，无运行时开销
- ✅ **类型信息利用**：充分利用 KnownNodeAspects 提供的类型信息

---

## 字节码分类与处理

### 跳转指令处理矩阵

| 字节码            | 条件               | 目标偏移 | 优化机会         | 核心文件位置                    |
| ----------------- | ------------------ | -------- | ---------------- | ------------------------------- |
| `Jump`            | 无条件             | 立即数   | 死代码消除       | `maglev-graph-builder.cc`       |
| `JumpLoop`        | 无条件回边         | 立即数   | Loop peeling     | `maglev-graph-builder.h:120`    |
| `JumpIfTrue`      | 累加器为真         | 立即数   | 分支折叠         | `maglev-graph-optimizer.cc:252` |
| `JumpIfFalse`     | 累加器为假         | 立即数   | 分支折叠         | 同上                            |
| `JumpIfNull`      | 累加器为 null      | 立即数   | TaggedEqual 优化 | `maglev-graph-builder.cc:3626`  |
| `JumpIfUndefined` | 累加器为 undefined | 立即数   | TaggedEqual 优化 | `maglev-graph-builder.cc:3632`  |

### 比较字节码优化策略

#### TestEqual vs TestEqualStrict

**位置**: `src/maglev/maglev-graph-builder.cc:12771-12788`

```cpp
ReduceResult MaglevGraphBuilder::VisitTestEqual() {
  return VisitCompareOperation<Operation::kEqual>();  // 需要类型转换
}

ReduceResult MaglevGraphBuilder::VisitTestEqualStrict() {
  return VisitCompareOperation<Operation::kStrictEqual>();  // 无类型转换
}
```

**优化差异**:

- `TestEqualStrict`: 可以利用 `TaggedEqual` 快速路径
- `TestEqual`: 需要考虑隐式类型转换，优化空间较小

#### TestReferenceEqual 特殊优化

**位置**: `src/maglev/maglev-graph-builder.cc:3539-3544`

```cpp
ReduceResult MaglevGraphBuilder::VisitTestReferenceEqual() {
  ValueNode* lhs = LoadRegister(0);
  ValueNode* rhs = GetAccumulator();
  SetAccumulator(BuildTaggedEqual(lhs, rhs));
  return ReduceResult::Done();
}
```

**BuildTaggedEqual 优化**:

**位置**: `src/maglev/maglev-graph-builder.cc:3513-3531`

```cpp
ValueNode* MaglevGraphBuilder::BuildTaggedEqual(ValueNode* lhs, ValueNode* rhs) {
  ValueNode* tagged_lhs = GetTaggedValue(lhs);
  ValueNode* tagged_rhs = GetTaggedValue(rhs);

  // 1. 相同节点 → true
  if (tagged_lhs == tagged_rhs) {
    return GetBooleanConstant(true);
  }

  // 2. 不相交类型 → false
  if (HaveDisjointTypes(tagged_lhs, tagged_rhs)) {
    return GetBooleanConstant(false);
  }

  // 3. 不同常量节点 → false
  if (IsConstantNode(tagged_lhs->opcode()) && !tagged_lhs->Is<Constant>() &&
      tagged_lhs->opcode() == tagged_rhs->opcode()) {
    return GetBooleanConstant(false);
  }

  // 4. 生成运行时检查
  return AddNewNodeNoInputConversion<TaggedEqual>({tagged_lhs, tagged_rhs});
}
```

#### BuildTaggedEqual 调用链（从 Compile 开始）

**完整调用路径**：

```
MaglevCompiler::Compile (src/maglev/maglev-compiler.cc:70)
  ↓
MaglevGraphBuilder::Build (src/maglev/maglev-compiler.cc:102-104)
  ↓ 构建基础 IR 图，遍历字节码
MaglevGraphBuilder::BuildBody (src/maglev/maglev-graph-builder.cc:13995-14010)
  ↓ 遇到引用相等测试或严格相等比较
MaglevGraphBuilder::VisitTestReferenceEqual() (src/maglev/maglev-graph-builder.cc:3539-3544)
  或
MaglevGraphBuilder::VisitCompareOperation<Operation::kStrictEqual>()
  ↓ 处理引用相等或严格相等字节码
  ↓ 调用通用的 Tagged 相等构建器
MaglevGraphBuilder::BuildTaggedEqual() (src/maglev/maglev-graph-builder.cc:3513-3531)
  ↓ 根据节点信息决定优化策略
  ↓ [分支1: 相同节点] → GetBooleanConstant(true)
  ↓ [分支2: 不相交类型] → GetBooleanConstant(false)
  ↓ [分支3: 不同常量] → GetBooleanConstant(false)
  ↓ [分支4: 默认] → TaggedEqual 节点
```

**触发条件**：

1. JavaScript 代码使用 `===` 严格相等运算符
2. JavaScript 代码使用 TestReferenceEqual（编译器内部优化）
3. 字节码生成 `TestReferenceEqual` 或 `TestEqualStrict` 指令
4. 在图构建阶段遇到该字节码

#### 逐行代码解释

**位置**: `src/maglev/maglev-graph-builder.cc:3513-3531`

```cpp
// 函数功能：构建 Tagged 指针相等性测试
// - Tagged 指针是 V8 中统一的值表示（Smi 或堆对象指针）
// - 实现 JavaScript 的 === 运算符语义
// 返回一个布尔值节点，表示两个值是否相等
ValueNode* MaglevGraphBuilder::BuildTaggedEqual(ValueNode* lhs, ValueNode* rhs) {
  // 确保两个输入都是 Tagged 表示
  // - GetTaggedValue 将其他表示（如 Int32、Float64）转换为 Tagged
  // - 这样可以统一处理所有类型的相等比较
  ValueNode* tagged_lhs = GetTaggedValue(lhs);
  ValueNode* tagged_rhs = GetTaggedValue(rhs);

  // 优化 1: 相同节点 → true
  // - SSA 形式保证相同节点指针表示同一个值
  // - 这是最强的优化：编译期确定为 true，零运行时开销
  // 例如：x === x 总是 true
  if (tagged_lhs == tagged_rhs) {
    return GetBooleanConstant(true);
  }

  // 优化 2: 不相交类型 → false
  // - 利用类型信息判断两个值是否可能相等
  // - 例如：Smi 和 HeapString 类型不相交，不可能相等
  // - 例如：不同的原始类型（Number vs String）不可能相等
  if (HaveDisjointTypes(tagged_lhs, tagged_rhs)) {
    return GetBooleanConstant(false);
  }

  // 优化 3: 不同常量节点 → false
  // - IsConstantNode 检查是否为各种常量节点（RootConstant, SmiConstant 等）
  // - !tagged_lhs->Is<Constant>() 排除 HeapObjectRef 常量（它们不是规范化的）
  // - 相同 opcode 表示相同类型的常量
  // - 规范化保证：相同常量使用同一个节点，因此不同节点指针表示不同常量
  // 例如：SmiConstant(1) 和 SmiConstant(2) 是不同的节点
  if (IsConstantNode(tagged_lhs->opcode()) && !tagged_lhs->Is<Constant>() &&
      tagged_lhs->opcode() == tagged_rhs->opcode()) {
    return GetBooleanConstant(false);
  }

  // 优化 4: 无法静态确定，生成运行时检查
  // - TaggedEqual 节点在运行时比较两个 Tagged 指针
  // - 对于 Smi，直接比较指针值
  // - 对于对象，比较对象地址（引用相等）
  return AddNewNodeNoInputConversion<TaggedEqual>({tagged_lhs, tagged_rhs});
}
```

**优化层级（从强到弱）**：

1. **节点同一性**: 相同 SSA 节点 → 常量 true
2. **类型不相交**: 基于 NodeType 分析 → 常量 false
3. **常量规范化**: 不同常量节点 → 常量 false
4. **运行时检查**: 无法静态优化 → 生成 `TaggedEqual` 节点

**关键优化点**：

- ✅ **SSA 利用**：相同节点指针 = 相同值，直接返回 true
- ✅ **类型信息利用**：HaveDisjointTypes 避免不必要的运行时比较
- ✅ **常量规范化**：利用 V8 的常量池机制，不同节点 = 不同常量
- ✅ **零成本抽象**：可静态确定的相等比较无运行时开销

**相关优化函数**：

```cpp
// HaveDisjointTypes 实现（简化版）
bool HaveDisjointTypes(ValueNode* lhs, ValueNode* rhs) {
  NodeType lhs_type = known_node_aspects().GetNodeType(lhs);
  NodeType rhs_type = known_node_aspects().GetNodeType(rhs);
  // 例如：Smi & String = 0（空集，不相交）
  return (lhs_type & rhs_type) == NodeType::kNone;
}

// IsConstantNode 检查（部分 opcodes）
bool IsConstantNode(Opcode opcode) {
  return opcode == Opcode::kSmiConstant ||
         opcode == Opcode::kRootConstant ||
         opcode == Opcode::kInt32Constant ||
         opcode == Opcode::kFloat64Constant;
}
```
