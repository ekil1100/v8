# AlternativeNodes：避免重复类型转换

## 问题：为什么需要 AlternativeNodes？

### 场景
```javascript
function compute(x) {
  let a = x | 0;      // a 是 Smi
  let b = a + 10;     // 需要 Int32
  let c = a + 20;     // 又需要 Int32
  return b + c;
}
```

### 没有 AlternativeNodes 的情况

```
n1: InitialValue(x)          [Smi tagged]
n2: CheckedSmiUntag(n1)      [Int32 untagged]  解标记
n3: Int32Constant(0)
n4: Int32Or(n2, n3)
n5: Int32ToNumber(n4)        [Smi tagged]      重新标记
n6: StoreLocal(a, n5)        存储 a

// 计算 b = a + 10
n7: LoadLocal(a)             [Smi tagged]
n8: CheckedSmiUntag(n7)      [Int32 untagged]  ← 又解标记一次！
n9: Int32Constant(10)
n10: Int32Add(n8, n9)
n11: Int32ToNumber(n10)      [Smi tagged]

// 计算 c = a + 20
n12: LoadLocal(a)            [Smi tagged]
n13: CheckedSmiUntag(n12)    [Int32 untagged]  ← 再解标记一次！！
n14: Int32Constant(20)
n15: Int32Add(n13, n14)
...
```

**问题：做了 3 次 `CheckedSmiUntag`！**

---

## 解决方案：AlternativeNodes 缓存

### 有 AlternativeNodes 的情况

```
n1: InitialValue(x)          [Smi tagged]
n2: CheckedSmiUntag(n1)      [Int32 untagged]  解标记
n3: Int32Constant(0)
n4: Int32Or(n2, n3)
n5: Int32ToNumber(n4)        [Smi tagged]      重新标记
n6: StoreLocal(a, n5)        存储 a

// KnownNodeAspects 记录：
// node_infos_[n5].alternative_.int32() = n2  ← 缓存 Int32 表示！

// 计算 b = a + 10
n7: LoadLocal(a)             [Smi tagged]
// 查找 alternative_.int32() → 找到 n2！
n9: Int32Constant(10)
n10: Int32Add(n2, n9)        ← 直接使用 n2，不需要解标记！
n11: Int32ToNumber(n10)      [Smi tagged]

// 计算 c = a + 20
n12: LoadLocal(a)            [Smi tagged]
// 查找 alternative_.int32() → 还是 n2！
n14: Int32Constant(20)
n15: Int32Add(n2, n14)       ← 还是直接使用 n2！
...
```

**优化结果：只做 1 次 `CheckedSmiUntag`！**

---

## 实际的 Maglev 输出

```
0x1e34012cc990  n8: CheckedSmiUntag [n2]              ← 只有一次！
0x1e34012ccb18  n10: Int32AddWithOverflow [n8, n9]    ← a + 10 使用 n8
0x1e34012ccc30  n12: Int32AddWithOverflow [n8, n11]   ← a + 20 也使用 n8
```

---

## AlternativeNodes 的实现

```cpp
class AlternativeNodes {
 private:
  std::array<ValueNode*, 5> store_;
  // [0] tagged      - Smi 表示（内存中）
  // [1] int32       - Int32 表示（寄存器中）
  // [2] truncated_int32_to_number
  // [3] float64     - Float64 表示
  // [4] checked_value
};
```

### 使用场景

```cpp
// 在编译 a + 10 时：
NodeInfo* a_info = known_node_aspects->GetOrCreateInfoFor(broker, a);

// 检查是否已有 int32 表示
ValueNode* int32_a = a_info->alternative().int32();
if (int32_a == nullptr) {
  // 没有缓存，创建新的
  int32_a = AddNode(CheckedSmiUntag(a));
  a_info->alternative().set_int32(int32_a);
}

// 直接使用 int32_a
ValueNode* result = AddNode(Int32Add(int32_a, constant_10));
```

---

## 性能收益

### 成本对比

| 操作 | CPU 周期（估计） |
|------|-----------------|
| CheckedSmiUntag | ~2-3 cycles |
| Int32Add | ~1 cycle |
| 查找 AlternativeNodes | ~1 cycle（缓存命中） |

### 示例中的收益

**没有缓存：**
- 3 次 CheckedSmiUntag = 6-9 cycles
- 3 次 Int32Add = 3 cycles
- **总计：9-12 cycles**

**有缓存：**
- 1 次 CheckedSmiUntag = 2-3 cycles
- 3 次 Int32Add = 3 cycles
- 2 次缓存查找 = 2 cycles
- **总计：7-8 cycles**

**节省：~25-30%**

---

## 总结

### Smi vs Int32

- **Smi（Small Integer）**：
  - V8 的**内存表示**
  - 带标记位（tagged pointer）
  - 用于存储和传递

- **Int32**：
  - CPU 的**原生整数**
  - 不带标记位（raw integer）
  - 用于快速运算

### AlternativeNodes 的作用

1. **缓存同一个值的不同表示**
2. **避免重复的类型转换**
3. **减少 CheckedSmiUntag 等昂贵操作**
4. **提升 20-30% 的整数运算性能**

### 为什么说 "y 有 Int32 表示"

```javascript
let y = x | 0;
```

- `y` 在 JavaScript 语义上是 **Number 类型**
- `y` 在 V8 内存中是 **Smi 表示**（tagged）
- `y` 在 KnownNodeAspects 中**缓存了 Int32 表示**（untagged）
- 后续使用 `y` 做整数运算时，**直接用 Int32 表示，不需要转换**

这就是"y 有 Int32 表示形式"的真正含义！
