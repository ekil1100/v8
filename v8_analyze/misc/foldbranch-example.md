# FoldBranch 优化示例

## 什么是 FoldBranch？

FoldBranch 是 V8 Maglev 编译器中的一个优化，用于在编译时**折叠（消除）可以静态确定结果的条件分支**。当分支条件可以在编译时计算出结果时，Maglev 会直接将分支替换为跳转到对应的目标块，消除不可达的分支。

## 代码位置

- 实现：`src/maglev/maglev-graph-optimizer.cc:252` (FoldBranch 方法)
- 调用位置：`src/maglev/maglev-graph-optimizer.cc:2331` (VisitBranchIfInt32Compare)
- 条件折叠逻辑：`src/maglev/maglev-reducer-inl.h:1417` (TryFoldInt32CompareOperation)

## 工作原理

```cpp
// 在 VisitBranchIfInt32Compare 中
if (auto result = reducer_.TryFoldInt32CompareOperation(
        node->operation(), node->input_node(0), node->input_node(1))) {
  FoldBranch(state.block(), node, result.value());
  return ProcessResult::kRevisit;
}
```

1. 检测到 `BranchIfInt32Compare` 节点
2. 尝试折叠比较操作（TryFoldInt32CompareOperation）
3. 如果可以折叠，获得布尔结果（true/false）
4. 调用 FoldBranch 将分支替换为直接跳转
5. 标记不可达的分支为死代码

## 可以触发 FoldBranch 的情况

### 1. 两个常量的比较

```javascript
function constantCompare() {
  const x = 5;
  const y = 10;

  // 5 < 10 在编译时确定为 true
  if (x < y) {
    return "always true";  // 折叠到这里
  } else {
    return "dead code";    // 死代码，会被消除
  }
}
```

**编译前**：包含分支指令 `BranchIfInt32Compare`
**编译后**：直接跳转到 true 分支，false 分支被消除

### 2. 相同值的比较

```javascript
function sameValueCompare(x) {
  // x === x 对于整数总是 true
  if (x === x) {
    return "same value";   // 折叠到这里
  } else {
    return "unreachable";  // 死代码
  }
}
```

**折叠依据**：在 `TryFoldInt32CompareOperation` 中有特殊处理
```cpp
if (op == Operation::kEqual || op == Operation::kStrictEqual) {
  if (left == right) {
    return true;  // 同一个 ValueNode，直接返回 true
  }
}
```

### 3. 一个常量和一个变量的比较（通过常量传播）

```javascript
function withConstantPropagation() {
  let x = 42;  // Maglev 可以追踪到 x 的常量值

  // x === 42 可以被折叠为 true
  if (x === 42) {
    return "folded";
  } else {
    return "dead";
  }
}
```

### 4. 嵌套的可折叠分支

```javascript
function nestedBranches() {
  const limit = 100;

  if (limit > 50) {        // 100 > 50 → true，折叠
    if (limit < 200) {     // 100 < 200 → true，折叠
      return "both true";  // 最终路径
    }
  }
  return "unreachable";
}
```

## 支持的比较操作

从 `TryFoldInt32CompareOperation` 的实现可以看到支持的操作：

```cpp
switch (op) {
  case Operation::kEqual:
  case Operation::kStrictEqual:
    return left == right;
  case Operation::kLessThan:
    return left < right;
  case Operation::kLessThanOrEqual:
    return left <= right;
  case Operation::kGreaterThan:
    return left > right;
  case Operation::kGreaterThanOrEqual:
    return left >= right;
}
```

## 完整测试用例

查看 `test-foldbranch.js` 和 `test-foldbranch-trace.js` 获取可运行的示例。

## 运行示例

```bash
# 基本运行
out/x64.debug/d8 --allow-natives-syntax test-foldbranch.js

# 查看 Maglev 编译过程
out/x64.debug/d8 --allow-natives-syntax --trace-maglev-graph-building test-foldbranch-trace.js

# 强制使用 Maglev 并查看优化
out/x64.debug/d8 --allow-natives-syntax --maglev test-foldbranch-trace.js
```

## 优化效果

- **性能提升**：消除运行时的分支判断
- **代码体积**：减少生成的机器码大小
- **控制流简化**：简化 CFG（控制流图），有利于后续优化
- **死代码消除**：不可达分支不会生成代码

## 相关优化

- **常量折叠**（Constant Folding）：折叠常量表达式
- **常量传播**（Constant Propagation）：追踪变量的常量值
- **死代码消除**（Dead Code Elimination）：移除不可达代码
- **分支优化**（Branch Optimization）：优化分支结构

## 注意事项

1. FoldBranch 主要在 Maglev 中实现，需要代码运行足够次数才会触发 Maglev 编译
2. 只适用于可以静态确定的 Int32 比较
3. 浮点数比较有单独的处理（BranchIfFloat64Compare）
4. 引用相等性比较（BranchIfReferenceEqual）目前标记为 TODO 待优化
