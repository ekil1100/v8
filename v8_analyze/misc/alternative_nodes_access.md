# AlternativeNodes 的访问机制

## ❌ 不是遍历查找

```cpp
// 错误理解：遍历数组找匹配的类型
for (int i = 0; i < 5; i++) {
  if (store_[i] != nullptr && is_int32_type(store_[i])) {
    return store_[i];  // 找到 int32 表示
  }
}
```

## ✅ 而是直接索引访问

### 1. 使用枚举定义固定索引

```cpp
enum Kind {
  kTagged = 0,
  kInt32 = 1,
  kTruncatedInt32ToNumber = 2,
  kFloat64 = 3,
  kCheckedValue = 4,
  kNumberOfAlternatives = 5
};

std::array<ValueNode*, 5> store_;  // 固定大小的数组
```

### 2. 通过宏生成访问方法

**宏定义：**
```cpp
#define ALTERNATIVES(V)                                \
  V(tagged, Tagged)                                    \
  V(int32, Int32)                                      \
  V(truncated_int32_to_number, TruncatedInt32ToNumber) \
  V(float64, Float64)                                  \
  V(checked_value, CheckedValue)

#define API(name, Name)                                      \
  ValueNode* name() const {                                  \
    if (!store_[Kind::k##Name]) return nullptr;              \
    return store_[Kind::k##Name]->UnwrapIdentities();        \
  }                                                          \
  ValueNode* set_##name(ValueNode* val) {                    \
    return store_[Kind::k##Name] = val;                      \
  }

  ALTERNATIVES(API)  // 展开成多个方法
#undef API
```

**宏展开后：**
```cpp
// 展开成这些方法：

ValueNode* tagged() const {
  if (!store_[Kind::kTagged]) return nullptr;
  return store_[Kind::kTagged]->UnwrapIdentities();
}
ValueNode* set_tagged(ValueNode* val) {
  return store_[Kind::kTagged] = val;
}

ValueNode* int32() const {
  if (!store_[Kind::kInt32]) return nullptr;     // ← 直接访问 store_[1]
  return store_[Kind::kInt32]->UnwrapIdentities();
}
ValueNode* set_int32(ValueNode* val) {
  return store_[Kind::kInt32] = val;             // ← 直接赋值 store_[1]
}

ValueNode* float64() const {
  if (!store_[Kind::kFloat64]) return nullptr;
  return store_[Kind::kFloat64]->UnwrapIdentities();
}
ValueNode* set_float64(ValueNode* val) {
  return store_[Kind::kFloat64] = val;
}

// ... 其他类型的方法
```

### 3. 使用示例

```cpp
AlternativeNodes alternatives;

// 存储 int32 表示 - O(1) 直接索引
ValueNode* int32_node = CheckedSmiUntag(smi_node);
alternatives.set_int32(int32_node);  // store_[1] = int32_node

// 获取 int32 表示 - O(1) 直接索引
ValueNode* cached = alternatives.int32();  // return store_[1]

if (cached != nullptr) {
  // 直接使用缓存的 int32 表示
  return Int32Add(cached, constant);
} else {
  // 需要新建转换
  ValueNode* new_int32 = CheckedSmiUntag(smi_node);
  alternatives.set_int32(new_int32);
  return Int32Add(new_int32, constant);
}
```

## 性能对比

### 遍历方式（如果采用）
```cpp
// 时间复杂度：O(n)，n = 5
ValueNode* int32() const {
  for (int i = 0; i < kNumberOfAlternatives; i++) {
    if (store_[i] && is_int32_representation(store_[i])) {
      return store_[i];
    }
  }
  return nullptr;
}
```

### 索引方式（实际采用）
```cpp
// 时间复杂度：O(1)
ValueNode* int32() const {
  if (!store_[Kind::kInt32]) return nullptr;
  return store_[Kind::kInt32]->UnwrapIdentities();
}
```

## 完整的内存布局

```
AlternativeNodes 对象：
┌────────────────────────────────────┐
│ store_: std::array<ValueNode*, 5>  │
│ ┌────────────────────────────────┐ │
│ │ [0] kTagged      → nullptr     │ │  或指向 Smi 节点
│ │ [1] kInt32       → 0x1234abcd  │ │  ← 指向 Int32 节点
│ │ [2] kTruncated.. → nullptr     │ │
│ │ [3] kFloat64     → nullptr     │ │
│ │ [4] kCheckedVal  → nullptr     │ │
│ └────────────────────────────────┘ │
└────────────────────────────────────┘

访问时：
alternatives.int32()
    ↓
直接返回 store_[1]
    ↓
0x1234abcd (Int32 节点地址)
```

## 实际编译中的使用

```cpp
// 在 MaglevGraphBuilder 中
void VisitAdd() {
  ValueNode* left = GetAccumulator();   // Smi 表示
  ValueNode* right = GetRegister(0);    // Smi 表示

  // 获取或创建 int32 表示
  NodeInfo* left_info = known_node_aspects_->GetOrCreateInfoFor(broker_, left);
  ValueNode* left_int32 = left_info->alternative().int32();  // ← O(1) 直接访问！

  if (!left_int32) {
    // 第一次使用，需要转换
    left_int32 = AddNode(CheckedSmiUntag(left));
    left_info->alternative().set_int32(left_int32);  // ← O(1) 直接存储！
  }

  // 同样处理 right
  NodeInfo* right_info = known_node_aspects_->GetOrCreateInfoFor(broker_, right);
  ValueNode* right_int32 = right_info->alternative().int32();  // ← O(1)

  if (!right_int32) {
    right_int32 = AddNode(CheckedSmiUntag(right));
    right_info->alternative().set_int32(right_int32);
  }

  // 直接用 int32 表示做加法
  ValueNode* result_int32 = AddNode(Int32AddWithOverflow(left_int32, right_int32));

  // 转回 Smi
  ValueNode* result_smi = AddNode(Int32ToNumber(result_int32));
  SetAccumulator(result_smi);
}
```

## 总结

### 为什么用固定索引而不是遍历？

1. **性能：O(1) vs O(n)**
   - 索引访问：~1 CPU cycle
   - 遍历查找：~5-10 CPU cycles

2. **类型已知：**
   - 编译时就知道需要哪种表示（int32、float64 等）
   - 不需要运行时判断类型

3. **空间固定：**
   - 只有 5 种表示形式
   - 用数组足够，不需要动态结构

4. **代码清晰：**
   ```cpp
   alternative.int32()    // 清晰
   // vs
   alternative.find(INT32_TYPE)  // 不够直接
   ```

### 访问流程

```
调用 alternative.int32()
    ↓
宏展开的方法
    ↓
直接访问 store_[Kind::kInt32]  (索引 1)
    ↓
O(1) 返回结果
```

这就是为什么 AlternativeNodes 如此高效的原因！
