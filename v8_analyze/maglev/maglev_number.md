# Maglev 数值运算与类型系统分析 (Person 1)

## 任务概述

基于 @maglev_analyse_plan.md 中的任务分配，Person 1 负责 Maglev 编译器中的数值运算与类型系统优化，包含约 40 个字节码的处理。

### 责任范围
- **算术运算**: Add, Sub, Mul, Div, Mod, Exp (及 Smi 变体)
- **位运算**: BitwiseAnd/Or/Xor, ShiftLeft/Right/RightLogical (及 Smi 变体)
- **一元运算**: Inc, Dec, Negate, BitwiseNot
- **类型转换**: ToNumber, ToNumeric, ToBoolean, ToString, ToName, ToObject
- **常量折叠**: TryFoldInt32/Float64Operation
- **表示转换**: AlternativeNodes 系统

---

## 核心架构

### 1. 字节码到 IR 的转换流程

```
字节码 (Bytecode)
    ↓
VisitBinaryOperation<Operation>  [maglev-graph-builder.cc:2514-2603]
    ↓
根据 FeedbackHint 选择路径:
    ├─ kSignedSmall → BuildInt32BinaryOperationNode
    ├─ kNumber → BuildFloat64BinaryOperationNodeForToNumber
    ├─ kString/kBigInt → BuildGenericBinaryOperationNode
    └─ kNone → EmitUnconditionalDeopt
    ↓
优化 (GraphOptimizer + Reducer)
    ├─ 常量折叠 (TryFoldInt32BinaryOperation)
    ├─ 类型特化 (BinaryOperationHint)
    ├─ 表示转换 (AlternativeNodes)
    └─ CSE (公共子表达式消除)
    ↓
IR 节点 (Int32Add, Float64Add, GenericAdd, etc.)
```

**关键文件**:
- `src/maglev/maglev-graph-builder.cc:2178-2758` - 字节码处理
- `src/maglev/maglev-graph-builder.cc:7720-7841` - 算术运算字节码
- `src/maglev/maglev-graph-builder.cc:13078-13182` - 类型转换

---

## 核心优化技术

### 2. 类型反馈驱动的特化 (Feedback-Driven Specialization)

#### 2.1 BinaryOperationHint 类型层次

```cpp
// src/maglev/maglev-graph-builder.cc:2157-2174
NodeType BinopHintToNodeTypeAndConversionType(BinaryOperationHint hint) {
  switch (hint) {
    case kSignedSmall:           // Smi 快速路径
    case kSignedSmallInputs:     // Smi 输入，可能溢出到 HeapNumber
    case kAdditiveSafeInteger:   // 加法安全整数
    case kNumber:                // 通用数字
    case kNumberOrOddball:       // 数字或 oddball (undefined, null, etc.)
    case kString:                // 字符串操作
    case kBigInt:                // BigInt 操作
    case kAny:                   // 通用操作
  }
}
```

**实现位置**: `maglev-graph-builder.cc:2514-2603`

#### 2.2 特化路径选择

```cpp
template <Operation kOperation>
ReduceResult MaglevGraphBuilder::VisitBinaryOperation() {
  FeedbackNexus nexus = FeedbackNexusForOperand(1);
  BinaryOperationHint feedback_hint = nexus.GetBinaryOperationFeedback();

  switch (feedback_hint) {
    case BinaryOperationHint::kSignedSmall:
      // 使用 Int32 算术，结果必须在 Smi 范围内
      return BuildInt32BinaryOperationNode<kOperation>();

    case BinaryOperationHint::kNumber:
      // 使用 Float64 算术
      return BuildFloat64BinaryOperationNodeForToNumber<kOperation>(
          NodeType::kNumber);

    case BinaryOperationHint::kString:
      // 字符串连接
      return BuildGenericBinaryOperationNode<kOperation>();

    case BinaryOperationHint::kNone:
      // 没有反馈信息，触发 deopt
      return EmitUnconditionalDeopt(
          DeoptimizeReason::kInsufficientTypeFeedbackForBinaryOperation);
  }
}
```

**关键洞察**:
- Feedback 是性能的核心驱动力
- Smi 路径最快（整数运算 + 无堆分配）
- Float64 路径次之
- 通用路径最慢（需要调用 runtime）

---

### 3. 常量折叠 (Constant Folding)

#### 3.1 Int32 常量折叠

**实现位置**: `maglev-reducer-inl.h:1204-1414`

```cpp
template <Operation kOperation>
MaybeReduceResult TryFoldInt32BinaryOperation(int32_t left, int32_t right) {
  switch (kOperation) {
    case Operation::kAdd:
      if (base::bits::SignedAddOverflow32(left, right, &result)) {
        return {};  // 溢出，无法折叠
      }
      return GetInt32Constant(result);

    case Operation::kBitwiseAnd:
      return GetInt32Constant(left & right);

    case Operation::kShiftLeft:
      return GetInt32Constant(left << (static_cast<uint32_t>(right) % 32));
  }
}
```

**支持的操作**:
- 算术: Add, Subtract, Multiply (检查溢出)
- 位运算: BitwiseAnd, BitwiseOr, BitwiseXor
- 移位: ShiftLeft, ShiftRight, ShiftRightLogical
- 一元: BitwiseNot, Negate, Increment, Decrement

#### 3.2 Float64 常量折叠

**实现位置**: `maglev-reducer-inl.h:1490-1542`

```cpp
template <Operation kOperation>
MaybeReduceResult TryFoldFloat64BinaryOperationForToNumber(
    TaggedToFloat64ConversionType conversion_type,
    ValueNode* left, double cst_right) {

  auto cst_left = TryGetFloat64Constant(left, conversion_type);
  if (!cst_left.has_value()) return {};

  switch (kOperation) {
    case Operation::kAdd:
      return GetNumberConstant(cst_left.value() + cst_right);
    case Operation::kExponentiate:
      return GetNumberConstant(math::pow(cst_left.value(), cst_right));
  }
}
```

**特殊处理**:
- NaN 传播
- 正零/负零区分
- Infinity 处理

#### 3.3 身份元素优化 (Identity Element Optimization)

**实现位置**: `maglev-reducer-inl.h:1251-1275`

```cpp
// 检测身份元素并直接返回输入
if (cst_right == Int32Identity<kOperation>()) {
  // 例如: x + 0, x * 1, x | 0
  EnsureInt32(left);  // 确保类型正确
  if (left->properties().is_conversion()) {
    return left->input(0).node();  // 消除转换节点
  }
  return left;
}
```

**身份元素**:
- `x + 0 = x`
- `x * 1 = x`
- `x | 0 = x` (常用于整数转换)
- `x & -1 = x`

---

### 4. AlternativeNodes 系统 (表示转换优化)

#### 4.1 核心数据结构

**位置**: `maglev-known-node-aspects.h:46-101`

```cpp
class AlternativeNodes {
  enum Kind {
    kTagged,                        // Tagged 表示 (Smi/HeapObject)
    kInt32,                         // 32位整数表示
    kTruncatedInt32ToNumber,        // 截断的 Int32 (用于 ToInt32)
    kFloat64,                       // 64位浮点表示
    kCheckedValue                   // 经过类型检查的值
  };

  std::array<ValueNode*, kNumberOfAlternatives> store_;

  // 访问 API
  ValueNode* tagged();
  ValueNode* int32();
  ValueNode* float64();
  ValueNode* set_tagged(ValueNode* val);
  // ...
};
```

**设计理念**:
- 同一个值可以有多种表示形式
- 避免重复的类型转换
- 延迟转换到真正需要的时候

#### 4.2 表示转换流程

**Tagged → Int32** (`maglev-reducer-inl.h:607-666`):
```cpp
ValueNode* GetInt32(ValueNode* value, bool can_be_heap_number) {
  if (representation == ValueRepresentation::kInt32) return value;

  // 检查是否已有 Int32 alternative
  NodeInfo* node_info = GetOrCreateInfoFor(value);
  if (ValueNode* alt = node_info->alternative().int32()) {
    return alt;  // 重用已存在的转换
  }

  // 创建新的转换并缓存
  switch (representation) {
    case ValueRepresentation::kTagged:
      if (can_be_heap_number) {
        return alternative.set_int32(
            AddNewNodeNoInputConversion<CheckedNumberToInt32>({value}));
      }
      return alternative.set_int32(BuildSmiUntag(value));

    case ValueRepresentation::kFloat64:
      return alternative.set_int32(
          AddNewNodeNoInputConversion<CheckedHoleyFloat64ToInt32>({value}));
  }
}
```

**Int32 → Tagged** (`maglev-reducer-inl.h:506-605`):
```cpp
ValueNode* GetTaggedValue(ValueNode* value) {
  if (representation == ValueRepresentation::kTagged) return value;

  NodeInfo* node_info = GetOrCreateInfoFor(value);
  if (ValueNode* alt = node_info->alternative().tagged()) {
    return alt;
  }

  switch (representation) {
    case ValueRepresentation::kInt32:
      if (NodeTypeIsSmi(node_info->type())) {
        // 安全的 Smi tagging (无需检查)
        return alternative.set_tagged(
            AddNewNodeNoInputConversion<UnsafeSmiTagInt32>({value}));
      }
      // 可能分配 HeapNumber
      return alternative.set_tagged(
          AddNewNodeNoInputConversion<Int32ToNumber>({value}));
  }
}
```

**优化案例**:
```javascript
function example(x) {
  let y = x | 0;     // 转换为 Int32
  let z = y + 1;     // Int32 算术
  return z;          // 转换回 Tagged
}
// 只执行一次 Tagged→Int32 和 Int32→Tagged 转换
```

---

### 5. 类型系统与 NodeType

#### 5.1 NodeType 层次

**位置**: `maglev-ir.h` (推断)

```cpp
enum class NodeType {
  kUnknown,
  kSmi,                    // 小整数 (31/32 bits)
  kHeapNumber,             // 堆分配的数字
  kNumber,                 // Smi | HeapNumber
  kBoolean,
  kNull,
  kUndefined,
  kNumberOrOddball,        // Number | Boolean | Null | Undefined
  kString,
  kInternalizedString,
  kSymbol,
  kJSReceiver,
  // ...
};
```

#### 5.2 类型推断与窄化

**KnownNodeAspects** (`maglev-known-node-aspects.h:172-669`):

```cpp
class KnownNodeAspects {
  // 存储每个节点的类型信息
  ZoneMap<ValueNode*, NodeInfo> node_infos_;

  // 类型检查
  bool CheckType(ValueNode* node, NodeType type, NodeType* old = nullptr);

  // 类型窄化 (Narrowing)
  bool EnsureType(ValueNode* node, NodeType type, NodeType* old = nullptr) {
    NodeInfo* known_info = GetOrCreateInfoFor(node);
    if (NodeTypeIs(known_info->type(), type)) return true;
    known_info->IntersectType(type);  // 类型交集
    return false;
  }

  // 类型推断
  NodeType GetType(ValueNode* node) const;
};
```

**类型推断示例** (`maglev-graph-builder.cc:13093-13131`):
```cpp
// ToBoolean 优化
ReduceResult BuildToBoolean(ValueNode* value, bool flip) {
  NodeInfo* node_info = known_node_aspects().TryGetInfoFor(value);
  if (node_info) {
    // 优先使用 Int32 alternative (避免解 tagging)
    if (ValueNode* as_int32 = node_info->alternative().int32()) {
      return AddNewNode<Int32ToBoolean>({as_int32}, flip);
    }
    if (ValueNode* as_float64 = node_info->alternative().float64()) {
      return AddNewNode<Float64ToBoolean>({as_float64}, flip);
    }
  }

  // 基于类型的特化
  if (CheckType(value, NodeType::kString)) {
    // 字符串: 只有空串为 falsy
    ValueNode* empty = GetRootConstant(RootIndex::kempty_string);
    return AddNewNode<TaggedNotEqual>({value, empty});
  }
  if (CheckType(value, NodeType::kSmi)) {
    // Smi: 只有 0 为 falsy
    return AddNewNode<TaggedNotEqual>({value, GetSmiConstant(0)});
  }

  // 通用 ToBoolean
  return AddNewNode<ToBoolean>({value});
}
```

---

### 6. Deoptimization 策略

#### 6.1 推测性优化 (Speculative Optimization)

```cpp
// 基于 feedback 的推测
if (feedback_hint == BinaryOperationHint::kSignedSmall) {
  // 假设输入是 Smi，生成 Int32 路径
  ValueNode* left_int32 = GetInt32(left);
  ValueNode* right_int32 = GetInt32(right);
  ValueNode* result = AddNewNode<Int32AddWithOverflow>({left_int32, right_int32});

  // 如果假设失败，会触发 deopt:
  // 1. CheckedSmiUntag 失败 (输入不是 Smi)
  // 2. Int32AddWithOverflow 溢出
}
```

#### 6.2 Deopt 类型

1. **Eager Deopt**: 执行前检查
   - `CheckedSmiUntag`: 检查是否为 Smi
   - `CheckedNumberToInt32`: 检查数字到整数转换
   - `CheckInt32Condition`: 检查整数条件

2. **Lazy Deopt**: 执行后检查
   - `Int32AddWithOverflow`: 溢出时 deopt
   - 调用 C++ runtime 后检查异常

3. **Unconditional Deopt**: 无条件 deopt
   - 反馈信息不足
   - 类型检查失败（编译时已知）

---

## 重要 IR 节点

### 7. 算术运算节点

#### 7.1 Int32 算术

| 节点 | 输入 | 输出 | 特性 |
|------|------|------|------|
| `Int32Add` | Int32, Int32 | Int32 | 不检查溢出 (截断语义) |
| `Int32AddWithOverflow` | Int32, Int32 | Int32 | 溢出时 deopt |
| `Int32Multiply` | Int32, Int32 | Int32 | 不检查溢出 |
| `Int32Divide` | Int32, Int32 | Int32 | 除零/溢出时 deopt |
| `Int32Modulus` | Int32, Int32 | Int32 | 除零时 deopt |
| `Int32Negate` | Int32 | Int32 | |
| `Int32IncrementWithOverflow` | Int32 | Int32 | 溢出时 deopt |

#### 7.2 Float64 算术

| 节点 | 输入 | 输出 | 特性 |
|------|------|------|------|
| `Float64Add` | Float64, Float64 | Float64 | IEEE 754 语义 |
| `Float64Subtract` | Float64, Float64 | Float64 | |
| `Float64Multiply` | Float64, Float64 | Float64 | |
| `Float64Divide` | Float64, Float64 | Float64 | |
| `Float64Modulus` | Float64, Float64 | Float64 | C++ fmod 语义 |
| `Float64Exponentiate` | Float64, Float64 | Float64 | pow() |
| `Float64Negate` | Float64 | Float64 | |

#### 7.3 位运算节点

| 节点 | 输入 | 输出 | 特性 |
|------|------|------|------|
| `Int32BitwiseAnd` | Int32, Int32 | Int32 | |
| `Int32BitwiseOr` | Int32, Int32 | Int32 | |
| `Int32BitwiseXor` | Int32, Int32 | Int32 | |
| `Int32BitwiseNot` | Int32 | Int32 | ~x |
| `Int32ShiftLeft` | Int32, Int32 | Int32 | x << (y % 32) |
| `Int32ShiftRight` | Int32, Int32 | Int32 | 算术右移 |
| `Int32ShiftRightLogical` | Int32, Int32 | Uint32 | 逻辑右移 |

---

### 8. 类型转换节点

#### 8.1 Tagging/Untagging

| 节点 | 输入 | 输出 | Deopt | 说明 |
|------|------|------|-------|------|
| `CheckedSmiUntag` | Tagged | Int32 | Yes | 检查 Smi 并解 tag |
| `UnsafeSmiUntag` | Tagged | Int32 | No | 假设是 Smi (已检查) |
| `UnsafeSmiTagInt32` | Int32 | Tagged | No | 假设在 Smi 范围内 |
| `Int32ToNumber` | Int32 | Tagged | No | 可能分配 HeapNumber |
| `CheckedSmiTagInt32` | Int32 | Tagged | Yes | 检查 Smi 范围 |
| `CheckedSmiTagFloat64` | Float64 | Tagged | Yes | Float64→Smi，检查整数 |

#### 8.2 数值转换

| 节点 | 输入 | 输出 | Deopt | 说明 |
|------|------|------|-------|------|
| `CheckedNumberToInt32` | Tagged | Int32 | Yes | Number→Int32，精确转换 |
| `TruncateNumberToInt32` | Tagged | Int32 | No | ToInt32 语义 (截断) |
| `CheckedNumberToFloat64` | Tagged | Float64 | Yes | Number→Float64 |
| `UncheckedNumberToFloat64` | Tagged | Float64 | No | 假设是 Number |
| `ChangeInt32ToFloat64` | Int32 | Float64 | No | 精确转换 |
| `TruncateFloat64ToInt32` | Float64 | Int32 | No | IEEE 754 ToInt32 |
| `CheckedHoleyFloat64ToInt32` | Float64 | Int32 | Yes | 检查整数 + 非 NaN |

#### 8.3 ToNumber/ToBoolean

| 节点 | 输入 | 输出 | 说明 |
|------|------|------|------|
| `ToNumber` | Tagged | Tagged | 调用 ToNumber abstract op |
| `ToNumeric` | Tagged | Tagged | ToNumber 或 ToBigInt |
| `ToBoolean` | Tagged | Tagged | JavaScript ToBoolean |
| `Int32ToBoolean` | Int32 | Boolean | x != 0 |
| `Float64ToBoolean` | Float64 | Boolean | x != 0 && !isNaN(x) |
| `ToBooleanLogicalNot` | Tagged | Boolean | !ToBoolean(x) |

---

## 优化示例

### 9. 完整优化流程示例

#### 示例 1: 简单加法

**JavaScript**:
```javascript
function add(a, b) {
  return a + b;
}
```

**Feedback**: `kSignedSmall` (两个参数都是 Smi)

**Maglev IR 生成** (`maglev-graph-builder.cc:7773-7774`):
```cpp
ReduceResult MaglevGraphBuilder::VisitAdd() {
  return VisitBinaryOperation<Operation::kAdd>();
}
```

**展开**:
```
1. LoadRegister(0) → a (Tagged)
2. LoadRegister(1) → b (Tagged)
3. FeedbackNexus → kSignedSmall
4. GetInt32(a) → a_int32
   ├─ CheckedSmiUntag(a)
   └─ 缓存到 alternative.int32()
5. GetInt32(b) → b_int32
   ├─ CheckedSmiUntag(b)
   └─ 缓存到 alternative.int32()
6. Int32AddWithOverflow(a_int32, b_int32) → result_int32
7. GetTaggedValue(result_int32) → result
   └─ Int32ToNumber(result_int32)
8. Return result
```

**优化后**:
- 只有 2 个 deopt 点 (CheckedSmiUntag)
- Int32 算术 (无堆分配)
- 如果结果溢出，Int32AddWithOverflow deopt

---

#### 示例 2: 循环累加

**JavaScript**:
```javascript
function sum(arr) {
  let total = 0;
  for (let i = 0; i < arr.length; i++) {
    total = total + arr[i];  // 关键行
  }
  return total;
}
```

**Feedback**: `kSignedSmall` → `kNumber` (溢出到 Float64)

**第一次编译** (假设 Smi):
```
1. total 初始为 0 (Smi)
2. 循环:
   a. GetInt32(total) → total_int32 (UnsafeSmiUntag, no deopt)
   b. GetInt32(arr[i]) → elem_int32 (CheckedSmiUntag, may deopt)
   c. Int32AddWithOverflow(total_int32, elem_int32) → new_total_int32
   d. Int32ToNumber(new_total_int32) → new_total (may allocate)
```

**溢出后重新编译** (feedback 更新为 kNumber):
```
1. total 可能是 Smi 或 HeapNumber
2. 循环:
   a. GetFloat64ForToNumber(total) → total_f64
   b. GetFloat64ForToNumber(arr[i]) → elem_f64
   c. Float64Add(total_f64, elem_f64) → new_total_f64
   d. Float64ToTagged(new_total_f64) → new_total
```

**AlternativeNodes 优化**:
- `total` 同时维护 Tagged 和 Float64 表示
- 循环内复用 Float64 alternative，避免重复转换

---

#### 示例 3: 位运算截断

**JavaScript**:
```javascript
function toInt32(x) {
  return x | 0;
}
```

**优化**:
```
1. LoadAccumulator() → x (可能是任意值)
2. GetTruncatedInt32ForToNumber(x) → x_int32
   ├─ 如果 x 是 Smi: UnsafeSmiUntag
   ├─ 如果 x 是 Number: TruncateNumberToInt32
   └─ 如果 x 是 Oddball: 常量折叠 (undefined→0, etc.)
3. Int32BitwiseOr(x_int32, 0) → result_int32
   └─ 常量折叠: 身份元素优化，返回 x_int32
4. Int32ToNumber(result_int32) → result
```

**最终**:
- `x | 0` 简化为类型转换节点
- 无实际位运算代码

---

## 关键数据结构

### 10. KnownNodeAspects 详解

**位置**: `maglev-known-node-aspects.h:217-669`

```cpp
class KnownNodeAspects {
 private:
  // 节点类型信息
  ZoneMap<ValueNode*, NodeInfo> node_infos_;

  // CSE 哈希表
  ZoneMap<uint32_t, AvailableExpression> available_expressions_;

  // 虚拟对象 (逃逸分析)
  VirtualObjectList virtual_objects_;

  // 副作用计数器 (用于失效 CSE)
  uint32_t effect_epoch_;

  // 是否存在不稳定的 Map
  bool any_map_for_any_node_is_unstable_;
};
```

**关键方法**:
1. `GetOrCreateInfoFor(node)`: 获取节点信息
2. `ClearUnstableMaps()`: 副作用后清除不稳定 map
3. `increment_effect_epoch()`: 标记副作用发生
4. `FindExpression(hash, inputs, args)`: CSE 查找

---

### 11. NodeInfo 详解

**位置**: `maglev-known-node-aspects.h:20-170`

```cpp
class NodeInfo {
 private:
  NodeType type_;                      // 当前类型
  bool any_map_is_unstable_;           // Map 稳定性
  bool possible_maps_are_known_;       // 是否知道可能的 Map
  PossibleMaps possible_maps_;         // 可能的 Map 集合
  AlternativeNodes alternative_;       // 不同表示

 public:
  // 类型操作
  NodeType IntersectType(NodeType other);
  NodeType UnionType(NodeType other);

  // Map 操作
  void SetPossibleMaps(const PossibleMaps& maps, ...);
  void ClearUnstableMaps();

  // Alternative 访问
  const AlternativeNodes& alternative() const;
};
```

---

## 性能考量

### 12. 优化决策权衡

#### 12.1 Smi vs Float64

| 方面 | Smi | Float64 |
|------|-----|---------|
| 运算速度 | 快 (整数 ALU) | 中等 (FPU) |
| 内存分配 | 无 | 可能需要 (结果 boxing) |
| 表示范围 | ±2^30 (32位) / ±2^31 (64位) | ±1.7e308 |
| 精度 | 精确整数 | IEEE 754 (53位有效数字) |
| Deopt 风险 | 高 (溢出) | 低 |

**策略**:
- 短循环/小数值: 使用 Smi
- 长循环/大数值: 使用 Float64
- 根据 feedback 动态调整

#### 12.2 常量折叠 vs CSE

| 场景 | 常量折叠 | CSE |
|------|----------|-----|
| `x + 2 + 3` | ✅ 折叠为 `x + 5` | ❌ |
| `f() + f()` | ❌ | ✅ (如果 f 无副作用) |
| `(x * 2) + (x * 2)` | ❌ | ✅ 重用 `x * 2` |
| 编译时开销 | 低 | 中等 (哈希表) |

**策略**:
- 常量折叠优先 (便宜且有效)
- CSE 用于消除重复计算

---

## 调试与测试

### 13. 调试标志

```bash
# 跟踪图构建
out/x64.debug/d8 --trace-maglev-graph-building script.js

# 打印 IR 图
out/x64.debug/d8 --print-maglev-graph script.js

# 跟踪优化/反优化
out/x64.debug/d8 --trace-opt --trace-deopt script.js

# 启用测试函数
out/x64.debug/d8 --allow-natives-syntax test.js
```

### 14. 测试用例位置

- **cctest**: `test/cctest/test-maglev-*.cc`
- **mjsunit**: `test/mjsunit/maglev/`
- **unittests**: `test/unittests/maglev/`

### 15. 关键测试场景

1. **常量折叠**:
   - 整数溢出边界
   - Float64 特殊值 (NaN, Infinity, -0)
   - 位运算移位量

2. **类型转换**:
   - Smi ↔ HeapNumber
   - Tagged ↔ Int32/Float64
   - ToBoolean 边界情况

3. **Deopt 正确性**:
   - 溢出触发 deopt
   - 类型不匹配 deopt
   - 保证 deopt 后状态正确

---

## 与其他模块的交互

### 16. 与 Person 2 (对象创建) 的交互

**场景**: 数组字面量中的数值
```javascript
let arr = [1, 2, 3];  // Person 2: CreateArrayLiteral
let sum = arr[0] + arr[1];  // Person 1: Add 优化
```

**协作点**:
- Person 2 创建数组时记录元素类型 (Smi/HeapNumber)
- Person 1 利用这些信息选择 Int32 或 Float64 路径

### 17. 与 Person 3 (控制流) 的交互

**场景**: 条件分支中的数值比较
```javascript
if (x > 0) {  // Person 3: 分支
  return x * 2;  // Person 1: Multiply
}
```

**协作点**:
- Person 3 的分支折叠依赖 Person 1 的常量折叠结果
- Person 1 的类型推断影响 Person 3 的 dead code elimination

**示例**:
```javascript
if (x === 5) {
  return x * 2;  // Person 1 知道 x === 5，折叠为常量 10
}
```

---

## 代码位置索引

### 18. 关键函数位置

| 功能 | 文件 | 行号 |
|------|------|------|
| VisitBinaryOperation | maglev-graph-builder.cc | 2514-2603 |
| VisitUnaryOperation | maglev-graph-builder.cc | 2178-2212 |
| BuildInt32BinaryOperationNode | maglev-graph-builder.cc | 2035-2087 |
| BuildFloat64BinaryOperationNode | maglev-graph-builder.cc | 2143-2153 |
| TryFoldInt32BinaryOperation | maglev-reducer-inl.h | 1237-1414 |
| TryFoldFloat64BinaryOperation | maglev-reducer-inl.h | 1490-1542 |
| GetInt32 | maglev-reducer-inl.h | 607-666 |
| GetFloat64 | maglev-reducer-inl.h | 868-967 |
| GetTaggedValue | maglev-reducer-inl.h | 506-605 |
| GetTruncatedInt32ForToNumber | maglev-reducer-inl.h | 762-865 |
| AlternativeNodes | maglev-known-node-aspects.h | 46-101 |
| NodeInfo | maglev-known-node-aspects.h | 20-170 |
| KnownNodeAspects | maglev-known-node-aspects.h | 172-669 |
| BinopHintToNodeType | maglev-graph-builder.cc | 2157-2174 |
| BuildToBoolean | maglev-graph-builder.cc | 13078-13131 |
| VisitAdd | maglev-graph-builder.cc | 7773 |
| VisitSubtract | maglev-graph-builder.cc | ~7780 |
| VisitMultiply | maglev-graph-builder.cc | ~7787 |
| VisitToNumber | maglev-graph-builder.cc | 13263 |
| TryFoldInt32Operation | maglev-graph-optimizer.cc | 210-249 |

---

## 未来工作方向

### 19. 可能的改进

1. **更激进的常量折叠**:
   - 支持 Divide/Modulus 常量折叠
   - 传播常量范围信息 (Range Analysis)

2. **更智能的类型推断**:
   - 循环归纳变量分析
   - 跨函数类型推断 (Inlining 后)

3. **减少 Deopt**:
   - 基于 profiling 的 Smi 范围检查消除
   - Float64 路径的早期选择 (避免 Smi 尝试)

4. **SIMD 支持**:
   - 向量化数值运算 (当前未实现)

---

## 总结

### 20. 核心要点

1. **Feedback 驱动**: 所有优化都基于运行时 feedback
2. **多层级特化**: Smi → Float64 → Generic
3. **表示转换优化**: AlternativeNodes 避免重复转换
4. **常量折叠**: 编译时计算提升性能
5. **类型系统**: NodeType + KnownNodeAspects 支撑所有优化

### 21. 学习路径建议

1. **Week 1-2**: 理解 GraphBuilder 和 Feedback 机制
   - 阅读 `VisitBinaryOperation` 和 `BinaryOperationHint`
   - 调试简单加法/乘法的编译过程

2. **Week 3-4**: 深入 Reducer 和常量折叠
   - 学习 `TryFoldInt32BinaryOperation`
   - 实现新的 peephole 优化

3. **Week 5-6**: 掌握 AlternativeNodes 和类型系统
   - 理解 `GetInt32`/`GetTaggedValue` 流程
   - 优化表示转换策略

4. **Week 7+**: 跨模块协作和高级优化
   - 与 Person 2/3 讨论依赖关系
   - 研究 CSE 和 Range Analysis

---

**版本**: v1.0
**日期**: 2025-10-11
**基于**: V8 主分支 (commit: 180d742)
**作者**: AI 分析 (基于 maglev_analyse_plan.md)
