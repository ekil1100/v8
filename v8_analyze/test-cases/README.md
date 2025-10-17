# 测试用例和工具脚本

本目录包含用于验证、演示和分析 V8 编译器行为的 JavaScript 测试脚本和工具。

## 测试用例概览

| 文件 | 类型 | 主要测试内容 |
|------|------|-------------|
| `test_frame.js` | 测试 | FrameState 基础功能 |
| `test_frame_complex.js` | 测试 | FrameState 复杂场景 |
| `test_status.js` | 测试 | 优化状态检查 |
| `test_alternative_nodes.js` | 测试 | 可选节点机制 |
| `test-foldbranch.js` | 测试 | 分支折叠优化 |
| `test-foldbranch-trace.js` | 测试 | 分支折叠追踪 |
| `decode-optimization-status.js` | 工具 | 优化状态解码器 |

---

## 测试用例详解

### 1. FrameState 测试

#### `test_frame.js` - 基础测试

测试 FrameState 的基本构建和反优化机制。

```bash
# 运行
out/x64.debug/d8 --allow-natives-syntax test_frame.js

# 带反优化追踪
out/x64.debug/d8 --allow-natives-syntax --trace-deopt test_frame.js
```

**测试场景**：
- 简单函数的 FrameState 构建
- 类型推测和反优化触发
- 反优化后的状态恢复

#### `test_frame_complex.js` - 复杂场景测试

测试更复杂的 FrameState 场景。

```bash
out/x64.debug/d8 --allow-natives-syntax --trace-deopt test_frame_complex.js
```

**测试场景**：
- 嵌套函数调用
- 循环中的 FrameState
- 多次反优化和重新优化

**相关文档**：`../framestate/`

---

### 2. 优化状态测试

#### `test_status.js` - 优化状态检查

演示如何检查函数的优化状态。

```bash
out/x64.debug/d8 --allow-natives-syntax test_status.js
```

**主要内容**：
- 使用 `%GetOptimizationStatus()` 检查状态
- 理解不同的优化级别（Ignition → Sparkplug → Maglev → TurboFan）
- 观察优化状态变化

**示例输出**：
```
Initial status: 0x1 (is function)
After warmup: 0x3 (is function | is optimized)
After deopt: 0x5 (is function | is never optimized)
```

**配合工具**：使用 `decode-optimization-status.js` 解析状态码

---

### 3. 可选节点测试

#### `test_alternative_nodes.js` - 可选节点机制

测试 V8 编译器的可选节点优化。

```bash
out/x64.debug/d8 --allow-natives-syntax test_alternative_nodes.js
```

**测试场景**：
- 可选实现路径
- 运行时路径选择
- 优化决策

**相关文档**：
- `../misc/alternative_nodes_explained.md`
- `../misc/alternative_nodes_access.md`

---

### 4. 分支折叠测试

#### `test-foldbranch.js` - 分支折叠优化

测试控制流优化中的分支折叠。

```bash
# 基础运行
out/x64.debug/d8 --allow-natives-syntax test-foldbranch.js

# 查看优化过程
out/x64.debug/d8 --allow-natives-syntax --trace-opt test-foldbranch.js
```

**测试场景**：
- 冗余分支消除
- 常量折叠后的分支简化
- 控制流图优化

#### `test-foldbranch-trace.js` - 分支折叠追踪

带详细追踪的分支折叠测试。

```bash
out/x64.debug/d8 --allow-natives-syntax \
                 --trace-opt \
                 --trace-deopt \
                 test-foldbranch-trace.js
```

**输出内容**：
- 编译器优化决策
- 分支消除过程
- 生成的代码对比

**相关文档**：
- `../misc/foldbranch-example.md`
- `../misc/foldbranch-no-break-analysis.md`

---

## 工具脚本

### `decode-optimization-status.js` - 优化状态解码器

解析 `%GetOptimizationStatus()` 返回的状态码。

#### 使用方法

```bash
# 方法 1: 直接运行（交互式）
out/x64.debug/d8 --allow-natives-syntax decode-optimization-status.js

# 方法 2: 在测试脚本中引用
// 在你的测试脚本中
load('decode-optimization-status.js');
let status = %GetOptimizationStatus(myFunction);
print(decodeOptimizationStatus(status));
```

#### 状态位说明

| 位 | 含义 |
|----|------|
| 0x1 | Is function |
| 0x2 | Is never optimized |
| 0x4 | Is always optimized |
| 0x8 | Is maybe deopted |
| 0x10 | Is optimized |
| 0x20 | Is marked for optimization |
| 0x40 | Is marked for concurrent optimization |
| 0x80 | Is executing on Sparkplug |
| 0x100 | Is executing on Maglev |
| 0x200 | Is executing on TurboFan |

#### 示例输出

```javascript
// 输入: 0x111
// 输出:
{
  raw: 0x111,
  flags: [
    "Is function",
    "Is optimized",
    "Is executing on TurboFan"
  ]
}
```

---

## 通用调试技巧

### 必备标志

所有测试用例都需要 `--allow-natives-syntax` 才能使用 V8 的内部函数（如 `%OptimizeFunctionOnNextCall()`）。

### 常用命令组合

```bash
# 最小化输出
out/x64.debug/d8 --allow-natives-syntax test.js

# 查看优化过程
out/x64.debug/d8 --allow-natives-syntax --trace-opt test.js

# 查看反优化
out/x64.debug/d8 --allow-natives-syntax --trace-deopt test.js

# 查看生成的代码
out/x64.debug/d8 --allow-natives-syntax --print-opt-code test.js

# 全面分析
out/x64.debug/d8 --allow-natives-syntax \
                 --trace-opt \
                 --trace-deopt \
                 --print-opt-code \
                 --code-comments \
                 test.js
```

### Maglev 特定标志

```bash
# 查看 Maglev 编译
out/x64.debug/d8 --allow-natives-syntax \
                 --trace-maglev \
                 test.js

# 查看 Maglev 图构建
out/x64.debug/d8 --allow-natives-syntax \
                 --trace-maglev-graph-building \
                 test.js

# 打印 Maglev 代码
out/x64.debug/d8 --allow-natives-syntax \
                 --print-maglev-code \
                 test.js
```

### TurboFan 可视化

```bash
# 生成 Turbolizer 可用的 JSON
out/x64.debug/d8 --allow-natives-syntax \
                 --trace-turbo \
                 test.js
# 输出: turbo-*.json

# 使用 Turbolizer 查看
# https://v8.github.io/tools/head/turbolizer/index.html
```

---

## V8 Native Syntax 速查

### 优化控制

```javascript
// 准备优化（下次调用时优化）
%PrepareFunctionForOptimization(func);

// 强制优化
%OptimizeFunctionOnNextCall(func);

// 强制使用 Maglev
%OptimizeMaglevOnNextCall(func);

// 强制去优化
%DeoptimizeFunction(func);

// 永不优化
%NeverOptimizeFunction(func);
```

### 状态查询

```javascript
// 获取优化状态
%GetOptimizationStatus(func);

// 检查是否优化
%IsFunctionOptimized(func);

// 查看隐藏类（Map）
%DebugPrint(obj);
%HaveSameMap(obj1, obj2);
```

### 垃圾回收

```javascript
// 强制 GC
%CollectGarbage(type);  // type: 0=young, 1=old

// 调试打印
%DebugPrint(value);
%SystemBreak();  // 触发调试器断点
```

---

## 编写新测试用例的建议

### 1. 基础结构

```javascript
// 定义要测试的函数
function testFunction(x) {
  return x + 1;
}

// 预热（让 V8 收集类型反馈）
for (let i = 0; i < 100; i++) {
  testFunction(i);
}

// 准备优化
%PrepareFunctionForOptimization(testFunction);

// 再调用几次
testFunction(1);
testFunction(2);

// 强制优化
%OptimizeFunctionOnNextCall(testFunction);
testFunction(3);

// 验证已优化
if (%IsFunctionOptimized(testFunction)) {
  print("✓ Function is optimized");
} else {
  print("✗ Function is NOT optimized");
}

// 触发反优化（可选）
testFunction("string");  // 类型变化

// 检查反优化
if (!%IsFunctionOptimized(testFunction)) {
  print("✓ Function was deoptimized");
}
```

### 2. 测试 FrameState

```javascript
function frameStateTest(a, b) {
  let sum = a + b;  // 可能触发反优化的点
  return sum * 2;
}

// 用整数预热
for (let i = 0; i < 100; i++) {
  frameStateTest(i, i + 1);
}

// 优化
%OptimizeFunctionOnNextCall(frameStateTest);
frameStateTest(1, 2);

// 用字符串触发反优化（观察 FrameState 恢复）
frameStateTest("hello", "world");
```

### 3. 测试分支优化

```javascript
function branchTest(x) {
  if (x > 0) {
    return x * 2;
  } else {
    return -x;
  }
}

// 用正数预热（让编译器优化掉 else 分支）
for (let i = 1; i <= 100; i++) {
  branchTest(i);
}

%OptimizeFunctionOnNextCall(branchTest);
branchTest(5);

// 触发 else 分支（可能导致反优化）
branchTest(-5);
```

---

## 故障排查

### 问题：函数没有被优化

**可能原因**：
1. 预热次数不够（至少需要几十次调用）
2. 函数太复杂（超过优化阈值）
3. 包含不可优化的特性（如 `eval`, `with`）

**解决方法**：
```javascript
// 增加预热次数
for (let i = 0; i < 1000; i++) func();

// 使用 %PrepareFunctionForOptimization
%PrepareFunctionForOptimization(func);

// 检查是否有编译错误
%GetOptimizationStatus(func);
```

### 问题：无法触发反优化

**可能原因**：
1. 类型变化不够显著
2. 编译器生成了通用代码（没有类型推测）

**解决方法**：
```javascript
// 用单一类型预热（让编译器做激进的类型推测）
for (let i = 0; i < 100; i++) {
  func(42);  // 只用 Smi
}

%OptimizeFunctionOnNextCall(func);
func(42);

// 用完全不同的类型触发
func("string");
func({});
```

---

## 相关文档

- **FrameState 分析**: `../framestate/`
- **Maglev 编译器**: `../maglev/`
- **反优化机制**: `../maglev/maglev_deopt.md`
- **控制流优化**: `../misc/foldbranch-*.md`

---

最后更新：2025-10-21
