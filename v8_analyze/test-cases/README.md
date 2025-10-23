# V8 调试和性能分析测试用例

本目录包含 V8 调试和性能分析功能的可运行测试用例。

## 📋 测试用例清单

### ✅ 已验证可运行

| 测试文件 | 功能 | 运行命令 | 状态 |
|---------|------|---------|------|
| `test_heap_verify.js` | 堆验证 | `out/x64.debug/d8 --verify-heap --expose-gc test_heap_verify.js` | ✅ 通过 |
| `test_turbo_verify.js` | TurboFan 验证 | `out/x64.debug/d8 --allow-natives-syntax test_turbo_verify.js` | ✅ 通过 |
| `test_log_deopt.js` | 反优化日志 | `out/x64.release/d8 --trace-deopt --allow-natives-syntax test_log_deopt.js` | ✅ 通过 |
| `maglev-try-catch-loop.js` | Maglev try-catch 优化 | `out/x64.debug/d8 --allow-natives-syntax --trace-maglev-graph-building maglev-try-catch-loop.js` | ✅ 通过 |

## 🔧 关键修复说明

### 1. Native Syntax 函数检查问题

**❌ 错误写法:**
```javascript
if (typeof %OptimizeFunctionOnNextCall === 'function') {
  %OptimizeFunctionOnNextCall(func);
}
```

**✅ 正确写法:**
```javascript
// 直接使用，不要用 typeof 检查
%OptimizeFunctionOnNextCall(func);
```

**原因**: 在启用 `--allow-natives-syntax` 时，`typeof %Func` 会导致语法错误。

### 2. 优化前必须 Prepare

**❌ 错误写法:**
```javascript
for (let i = 0; i < 100; i++) {
  func(args);
}
%OptimizeFunctionOnNextCall(func);  // 会报错！
```

**✅ 正确写法:**
```javascript
// 必须先调用 PrepareFunctionForOptimization
%PrepareFunctionForOptimization(func);

for (let i = 0; i < 100; i++) {
  func(args);
}

%OptimizeFunctionOnNextCall(func);
func(args);  // 触发优化
```

**原因**: V8 新版本要求在手动优化前先准备函数，防止竞争条件。

### 3. 全局对象访问

**❌ 错误写法:**
```javascript
if (global.gc) {  // ReferenceError in d8
  gc();
}
```

**✅ 正确写法:**
```javascript
if (globalThis.gc) {
  gc();
}
```

**原因**: d8 中没有 `global` 对象，应使用 `globalThis`。

## 🚀 快速运行所有测试

```bash
# 在 v8 根目录运行
cd v8_analyze/test-cases

# 堆验证测试
../../out/x64.debug/d8 --verify-heap --expose-gc test_heap_verify.js

# TurboFan 验证测试
../../out/x64.debug/d8 --allow-natives-syntax test_turbo_verify.js

# 反优化日志测试
../../out/x64.release/d8 --trace-deopt --allow-natives-syntax test_log_deopt.js

# Maglev try-catch 优化追踪
../../out/x64.debug/d8 --allow-natives-syntax --trace-maglev-graph-building maglev-try-catch-loop.js
```

## 🔍 Maglev 优化特殊说明

### 4. Maglev vs TurboFan 优化

**问题**: 为什么 `%OptimizeFunctionOnNextCall` 会跳过 Maglev，直接用 TurboFan 优化？

**原因**: `%OptimizeFunctionOnNextCall` 默认目标是 TurboFan（最高层优化）。

**✅ 强制 Maglev 优化:**
```javascript
// 使用 OptimizeMaglevOnNextCall 而不是 OptimizeFunctionOnNextCall
%PrepareFunctionForOptimization(func);

for (let i = 0; i < 100; i++) {
  func(args);
}

%OptimizeMaglevOnNextCall(func);  // 强制 Maglev
func(args);  // 触发优化
```

**验证优化层级:**
```bash
# 使用 --trace-opt 查看优化到哪一层
../../out/x64.debug/d8 --allow-natives-syntax --trace-opt script.js

# 输出会显示:
# [compiling method ... (target MAGLEV), ...]      # Maglev 优化
# [compiling method ... (target TURBOFAN_JS), ...] # TurboFan 优化
```

**Try-Catch 性能影响:**
- Maglev 可以优化带 try-catch 的代码
- 额外创建 exception handler block
- 如果 catch 不执行，开销很小（只是额外的跳转和 handler table）
- Handler table 查找在现代 CPU 上很快（分支预测友好）
