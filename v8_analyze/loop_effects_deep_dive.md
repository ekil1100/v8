# Maglev 循环副作用（Loop Effects）详解

## 一、什么是副作用（Effects）？

在 Maglev 编译器中，**副作用**（Effects）指的是循环中可能影响优化的操作。这些信息帮助编译器：
1. 决定哪些优化是安全的
2. 确定是否可以移动或消除某些操作
3. 跟踪循环对程序状态的影响

## 二、LoopEffects 结构定义

```cpp
struct LoopEffects {
  // 上下文槽位被写入
  ZoneSet<KnownNodeAspects::LoadedContextSlotsKey> context_slot_written;

  // 对象被写入（修改对象的字段）
  ZoneSet<ValueNode*> objects_written;

  // 属性键被清除（删除对象的属性）
  ZoneSet<KnownNodeAspects::LoadedPropertyMapKey> keys_cleared;

  // 分配操作（new、对象字面量等）
  ZoneSet<InlinedAllocation*> allocations;

  // 不稳定方面被清除（影响类型假设）
  bool unstable_aspects_cleared = false;

  // 可能有别名上下文
  bool may_have_aliasing_contexts = false;
};
```

## 三、各种副作用的含义

### 1. **unstable_aspects_cleared** (ua)

**含义**：循环中存在可能改变对象类型或结构的操作。

**示例**：
```javascript
for (let i = 0; i < arr.length; i++) {
  obj.newProperty = i;  // ← 添加新属性，改变对象结构
}
```

**显示**：`(effects: ua)`

**影响**：
- 编译器不能假设对象的 Map（隐藏类）保持不变
- 必须重新检查类型假设
- 限制了 Map 相关的优化

### 2. **context_slot_written** (c[数字])

**含义**：循环中写入了闭包的上下文槽位。

**示例**：
```javascript
function outer() {
  let captured = 0;  // ← 被闭包捕获的变量

  for (let i = 0; i < 10; i++) {
    captured++;  // ← 写入上下文槽位
  }
}
```

**显示**：`(effects: c1)` - 1 个上下文槽位被写入

**影响**：
- 编译器必须保证上下文槽位的写入操作按顺序执行
- 不能缓存上下文槽位的值
- 可能需要额外的内存读写

### 3. **objects_written** (o[数字])

**含义**：循环中修改了对象的字段。

**示例**：
```javascript
for (let i = 0; i < arr.length; i++) {
  obj.field = i;  // ← 写入对象字段
}
```

**显示**：`(effects: o1)` - 1 个对象被写入

**影响**：
- 编译器不能假设对象字段值保持不变
- 限制了加载消除（Load Elimination）优化
- 可能需要保留冗余的加载操作

### 4. **keys_cleared** (k[数字])

**含义**：循环中删除了对象的属性。

**示例**：
```javascript
for (let i = 0; i < arr.length; i++) {
  delete obj.property;  // ← 删除属性
}
```

**显示**：`(effects: k1)` - 1 个属性键被清除

**影响**：
- 编译器不能假设属性存在
- 必须插入额外的存在性检查
- 限制了属性访问优化

## 四、`(effects:)` 为空的含义

### processData 函数的例子

```javascript
function processData(arr, threshold) {
  let sum = 0;
  let count = 0;

  try {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > threshold) {
        sum += arr[i];    // ← 只操作局部变量
        count++;          // ← 只操作局部变量
      }
    }
    // ...
  } catch (e) {
    // ...
  }
}
```

**Block b6 的输出**：
```
Block b6 peeled (effects:)
  ↑ 副作用列表为空！
```

### 为什么没有副作用？

✓ **没有写入上下文槽位**
  - `sum` 和 `count` 是局部变量，存储在寄存器或栈中
  - 不是闭包捕获的变量

✓ **没有写入对象字段**
  - 没有 `obj.field = value` 这样的操作
  - 只读取数组元素（`arr[i]`），不修改

✓ **没有删除属性**
  - 没有 `delete` 操作

✓ **没有改变对象结构**
  - 没有添加新属性
  - 对象的 Map（隐藏类）保持稳定

✓ **没有分配新对象**
  - 没有 `new Object()`、`{}`、`[]` 等

### 这意味着什么？

**非常适合优化！**

编译器可以安全地：
1. **循环不变量外提（LICM）**：将不变的操作移到循环外
2. **加载消除**：缓存重复的内存读取
3. **强度削减**：将复杂操作替换为简单操作
4. **循环剥离**：复制第一次迭代（我们看到的 `peeled` 标记）
5. **类型特化**：假设类型不变

## 五、有副作用的例子

### 例子 1：写入对象字段

```javascript
function sumToObject(arr, result) {
  result.sum = 0;  // ← 初始化

  for (let i = 0; i < arr.length; i++) {
    result.sum += arr[i];  // ← 每次迭代写入对象字段
  }
}
```

**Block 输出**：
```
Block b1 (effects: o1)
  ↑ 1 个对象被写入（result）
```

**限制的优化**：
- 不能消除对 `result.sum` 的重复读取
- 必须在每次迭代时写回内存

### 例子 2：写入闭包变量

```javascript
function counter() {
  let count = 0;  // ← 被闭包捕获

  return function() {
    for (let i = 0; i < 10; i++) {
      count++;  // ← 写入上下文槽位
    }
    return count;
  };
}
```

**Block 输出**：
```
Block b1 (effects: c1)
  ↑ 1 个上下文槽位被写入
```

**限制的优化**：
- 必须保证写入顺序
- 不能将写入操作延迟到循环结束

### 例子 3：添加新属性（unstable）

```javascript
function addProperties(obj, arr) {
  for (let i = 0; i < arr.length; i++) {
    obj[`prop${i}`] = arr[i];  // ← 添加新属性
  }
}
```

**Block 输出**：
```
Block b1 (effects: ua o1)
  ↑ 不稳定方面被清除 + 1 个对象被写入
```

**限制的优化**：
- 对象的 Map 不断改变
- 不能假设属性访问的偏移固定
- 可能触发对象从 Fast 模式转到 Dictionary 模式

### 例子 4：组合多种副作用

```javascript
function complex(arr, context) {
  let captured = 0;  // ← 被闭包捕获
  context.result = {};

  for (let i = 0; i < arr.length; i++) {
    captured++;                    // ← c1: 写入上下文槽位
    context.result[i] = arr[i];    // ← o1: 写入对象
    context.result.count = i;      // ← ua: 可能改变结构
    delete context.temp;           // ← k1: 删除属性
  }

  return () => captured;  // 闭包
}
```

**Block 输出**：
```
Block b1 (effects: ua c1 o1 k1)
  ↑ 所有副作用都有！
```

**严重限制优化**：
- 几乎所有优化都受限
- 编译器必须保守处理
- 可能无法有效优化循环

## 六、副作用与优化的关系

### 优化决策表

| 副作用       | 影响的优化                         | 严重程度 |
| ------------ | ---------------------------------- | -------- |
| 无副作用     | 所有优化都可用                     | ✓✓✓      |
| c (context)  | 限制加载消除、不能延迟写入         | ⚠        |
| o (objects)  | 限制加载消除、不能假设字段不变     | ⚠⚠       |
| k (keys)     | 限制属性访问优化、需要存在性检查   | ⚠⚠       |
| ua (unstable)| 限制类型特化、Map 假设、inline cache | ⚠⚠⚠     |

### 最优情况（processData）

```
Block b6 peeled (effects:)
```

- ✓ 循环剥离（loop peeling）
- ✓ 类型特化（CheckMaps, CheckedSmiUntag）
- ✓ 边界检查消除（部分）
- ✓ 寄存器分配优化
- ✓ 指令调度优化

### 最差情况

```
Block b1 (effects: ua c2 o3 k1)
```

- ✗ 大部分优化受限
- ✗ 必须保守生成代码
- ✗ 性能可能接近解释器

## 七、如何编写无副作用的循环

### 最佳实践

✓ **使用局部变量**（而非对象字段）
```javascript
// 好：无副作用
let sum = 0;
for (let i = 0; i < arr.length; i++) {
  sum += arr[i];
}
result.sum = sum;  // 循环后写一次

// 差：每次迭代都有副作用
result.sum = 0;
for (let i = 0; i < arr.length; i++) {
  result.sum += arr[i];  // o1
}
```

✓ **避免在循环中修改对象结构**
```javascript
// 好：对象结构不变
const obj = { values: [] };
for (let i = 0; i < 10; i++) {
  obj.values.push(i);  // 数组操作，不改变 obj 结构
}

// 差：每次迭代都改变对象结构
const obj = {};
for (let i = 0; i < 10; i++) {
  obj[`prop${i}`] = i;  // ua + o1
}
```

✓ **最小化闭包捕获**
```javascript
// 好：count 是局部变量
function process(arr) {
  let count = 0;
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 0) count++;
  }
  return count;
}

// 差：count 被闭包捕获
function process(arr) {
  let count = 0;
  const increment = () => { count++; };  // 捕获 count
  for (let i = 0; i < arr.length; i++) {
    if (arr[i] > 0) increment();  // c1
  }
  return count;
}
```

✓ **循环外初始化对象**
```javascript
// 好：result 在循环前完全初始化
const result = { sum: 0, count: 0 };
for (let i = 0; i < arr.length; i++) {
  result.sum += arr[i];      // o1，但结构稳定
  result.count++;
}

// 差：动态添加属性
const result = {};
for (let i = 0; i < arr.length; i++) {
  result.sum = (result.sum || 0) + arr[i];  // ua
  result.count = (result.count || 0) + 1;
}
```

## 八、调试副作用

### 使用 --print-maglev-graph

```bash
out/x64.debug/d8 --allow-natives-syntax --print-maglev-graph script.js
```

查看 Block 的 effects 标记：
```
Block b1 (effects:)          ← 无副作用，最优
Block b2 (effects: o1)       ← 1 个对象被写入
Block b3 (effects: ua c1 o2) ← 多种副作用
```

### 理解输出

| 标记 | 含义                   | 数字含义         |
| ---- | ---------------------- | ---------------- |
| ua   | Unstable aspects       | 布尔值，无计数   |
| c[n] | Context slots written  | n = 槽位数量     |
| o[n] | Objects written        | n = 对象数量     |
| k[n] | Keys cleared           | n = 属性数量     |

## 九、总结

### 核心理解

> **`(effects:)` 为空 = 循环是纯计算的，没有副作用 = 编译器可以大胆优化**

### processData 为什么优化得这么好？

```javascript
for (let i = 0; i < arr.length; i++) {
  if (arr[i] > threshold) {
    sum += arr[i];    // ✓ 局部变量
    count++;          // ✓ 局部变量
  }
}
```

1. **只操作局部变量**（sum, count, i）
2. **只读取数组元素**，不修改
3. **没有闭包捕获**
4. **没有对象字段写入**
5. **没有动态属性操作**

结果：`Block b6 peeled (effects:)` → 完美的优化候选！

### 关键外卖

- **空副作用 = 高性能**
- **副作用越多 = 优化越受限**
- **编写无副作用循环 = 让 V8 全力优化**

---

相关源码位置：
- `src/maglev/maglev-interpreter-frame-state.h` - LoopEffects 定义
- `src/maglev/maglev-graph-printer.cc` - effects 打印逻辑
- `src/maglev/maglev-known-node-aspects.h` - 节点方面跟踪
