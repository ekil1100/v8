# V8 调试和调优能力实用指南

本文档提供V8引擎调试和性能分析能力的实用指南，包含具体的使用示例、运行命令和结果说明。每个功能都包含完整的使用流程，从JS测试用例到输出结果解读。

---

## 文档说明

**格式约定**: 每个功能模块包含以下内容：
- ✅ 功能说明和默认状态
- ⚙️ 开启方式和前置条件
- 🎯 适用场景
- 📝 具体JS用例
- 💻 运行命令
- 📊 运行结果说明

---

## 目录

### 1. [Verify 验证能力](#1-verify-验证能力)
   - 1.1 [Heap 堆验证](#11-heap-堆验证)
   - 1.2 [写屏障验证](#12-写屏障验证)
   - 1.3 [TurboFan 编译器验证](#13-turbofan-编译器验证)
   - 1.4 [CSA 代码验证](#14-csa-代码验证)
   - 1.5 [Turboshaft 验证](#15-turboshaft-验证)

### 2. [Log 日志能力](#2-log-日志能力)
   - 2.1 [代码事件日志](#21-代码事件日志)
   - 2.2 [反优化日志](#22-反优化日志)
   - 2.3 [IC 状态转换日志](#23-ic-状态转换日志)
   - 2.4 [Map 创建日志](#24-map-创建日志)
   - 2.5 [函数事件日志](#25-函数事件日志)

### 3. [编译耗时统计](#3-编译耗时统计)
   - 3.1 [Runtime Call Stats (RCS)](#31-runtime-call-stats-rcs)
   - 3.2 [Maglev 编译时间统计](#32-maglev-编译时间统计)
   - 3.3 [TurboFan 编译统计](#33-turbofan-编译统计)
   - 3.4 [WebAssembly 编译时间](#34-webassembly-编译时间)

### 4. [优化追踪](#4-优化追踪)
   - 4.1 [优化决策追踪](#41-优化决策追踪)
   - 4.2 [TurboFan 内联追踪](#42-turbofan-内联追踪)
   - 4.3 [Maglev 图构建追踪](#43-maglev-图构建追踪)
   - 4.4 [反优化追踪](#44-反优化追踪)

### 5. [GC 垃圾回收追踪](#5-gc-垃圾回收追踪)
   - 5.1 [基础 GC 追踪](#51-基础-gc-追踪)
   - 5.2 [GC 详细信息](#52-gc-详细信息)
   - 5.3 [内存碎片追踪](#53-内存碎片追踪)
   - 5.4 [对象统计](#54-对象统计)

### 6. [实用命令组合](#6-实用命令组合)
   - 6.1 [完整性能分析](#61-完整性能分析)
   - 6.2 [优化问题诊断](#62-优化问题诊断)
   - 6.3 [内存问题调试](#63-内存问题调试)

### 7. [常见问题排查](#7-常见问题排查)

---

## 1. Verify 验证能力

---

### 1.1 Heap 堆验证

#### ✅ 功能说明

**标志位**: `--verify-heap`

验证堆(Heap)在垃圾回收前后的完整性，检查所有堆对象的指针是否有效、对象布局是否正确。这是V8最重要的内部一致性检查之一。

- **实现位置**: `src/heap/heap-verifier.h`, `src/heap/heap-verifier.cc`
- **默认状态**: ❌ 关闭 (性能开销极大)
- **编译要求**: 需要 `VERIFY_HEAP` 宏定义

#### ⚙️ 开启方式

**前置条件**:
- 使用 Debug 或 OptDebug 构建 (`out/x64.debug/d8` 或 `out/x64.optdebug/d8`)
- Release 构建通常不包含验证代码

**命令行标志**:
```bash
--verify-heap                          # 启用堆验证
--verify-heap-skip-remembered-set      # 跳过 remembered set 验证(更快)
```

#### 🎯 适用场景

1. **调试内存损坏问题**: 对象指针被错误修改
2. **GC bug 诊断**: 垃圾回收器行为异常
3. **新功能开发**: 验证对堆的修改没有破坏不变式
4. **Map 转换问题**: 对象隐藏类变化导致的问题
5. **写屏障问题**: 增量标记期间的对象修改

#### 📝 具体JS用例

**测试用例**: `test_heap_verify.js`
```javascript
// 创建各种类型的对象来触发不同的堆验证路径
function createObjects() {
  // 普通对象
  let obj = { x: 1, y: 2 };

  // 数组
  let arr = [1, 2, 3, 4, 5];

  // 函数
  function add(a, b) { return a + b; }

  // 闭包
  function makeClosure() {
    let counter = 0;
    return () => ++counter;
  }
  let closure = makeClosure();

  // Map 和 Set
  let map = new Map([[1, 'one'], [2, 'two']]);
  let set = new Set([1, 2, 3]);

  return { obj, arr, add, closure, map, set };
}

// 触发多次GC以进行堆验证
for (let i = 0; i < 10; i++) {
  createObjects();

  // 强制GC (需要 --expose-gc)
  if (globalThis.gc) {
    gc();
  }
}

console.log("Heap verification test completed");
```

#### 💻 运行命令

```bash
# 基本堆验证
out/x64.debug/d8 --verify-heap --expose-gc test_heap_verify.js

# 跳过 remembered set 验证(更快)
out/x64.debug/d8 --verify-heap --verify-heap-skip-remembered-set --expose-gc test_heap_verify.js

# 组合其他验证标志
out/x64.debug/d8 --verify-heap --verify-csa --expose-gc test_heap_verify.js
```

#### 📊 运行结果说明

**成功情况**:
```
Heap verification test completed
```
- 无额外输出表示堆验证通过
- 程序正常结束，返回码 0

**失败情况**:
```
#
# Fatal error in ../src/heap/heap-verifier.cc, line 234
# Check failed: object.map().instance_type() == FIXED_ARRAY_TYPE
#

==== C stack trace ===============================

    0   d8                                  0x00007f8a1c3e4f12 V8_Fatal
    1   d8                                  0x00007f8a1ba3c891 v8::internal::HeapVerifier::VerifyHeap
    ...
```

**关键错误信息解读**:
- `Check failed`: 验证的具体断言失败
- `object.map().instance_type()`: 对象类型不匹配
- C stack trace: 显示失败位置的调用栈

**性能影响**:
- 执行时间: **5-10倍慢** (每次GC都会完整遍历堆)
- 适合: 调试和开发，**不适合性能测试**

---

### 1.2 写屏障验证

#### ✅ 功能说明

**标志位**: `--verify-write-barriers` (只读，编译时确定)

验证写屏障(Write Barrier)的正确性。写屏障是增量/并发垃圾回收的关键机制，用于跟踪对象引用的修改。

- **实现位置**: `src/heap/heap-write-barrier.h`, `src/heap/marking-barrier.h`
- **默认状态**:
  - ✅ **Debug 构建**: 自动启用
  - ❌ **OptDebug/Release 构建**: 默认关闭
- **性能影响**: 中等 (每次写操作都会检查)
- **注意**: 这是编译时标志，无法在运行时切换

#### ⚙️ 开启方式

**方式一: 使用 Debug 构建（推荐）**

```bash
# Debug 构建自动启用所有验证功能
tools/dev/gm.py quiet x64.debug

# 验证是否启用
out/x64.debug/d8 --help | grep verify-write-barriers
# 输出: --verify-write-barriers (verify write barriers)
#       type: bool  default: true
```

**方式二: 手动启用（OptDebug/Release）**

```bash
# 方法 A: 使用 GN args
gn gen out/x64.optdebug --args='v8_enable_verify_write_barriers=true'
ninja -C out/x64.optdebug d8

# 方法 B: 编辑 args.gn
tools/dev/gm.py x64.optdebug
# 编辑 out/x64.optdebug/args.gn，添加:
# v8_enable_verify_write_barriers = true
ninja -C out/x64.optdebug d8
```

**编译原理**:
- BUILD.gn 中的配置会添加 `-DV8_VERIFY_WRITE_BARRIERS` 宏
- 这个宏在编译时控制 `--verify-write-barriers` 标志的默认值
- 运行时该标志为只读，无法通过命令行改变

#### 🎯 适用场景

1. **调试增量GC问题**: 并发标记期间的对象修改
2. **诊断missed barriers**: 漏掉的写屏障导致的悬挂指针
3. **验证新的对象操作**: 确保正确插入写屏障
4. **调试黑白对象问题**: 三色标记中的颜色不一致

#### 📝 具体JS用例

**测试用例**: `test_write_barriers.js`
```javascript
// 测试写屏障的各种场景
function testWriteBarriers() {
  // 对象属性写入
  let obj1 = { value: null };
  let obj2 = { data: 42 };
  obj1.value = obj2;  // 触发写屏障

  // 数组元素写入
  let arr = new Array(100);
  for (let i = 0; i < 100; i++) {
    arr[i] = { index: i };  // 每次赋值触发写屏障
  }

  // 动态添加属性
  let dynamic = {};
  for (let i = 0; i < 50; i++) {
    dynamic['prop' + i] = { value: i };  // 触发写屏障
  }

  return { obj1, arr, dynamic };
}

// 在增量GC期间进行写操作
for (let round = 0; round < 20; round++) {
  testWriteBarriers();

  // 触发增量GC
  if (global.gc) {
    gc();  // 可能触发增量标记
  }
}

console.log("Write barrier verification completed");
```

#### 💻 运行命令

```bash
# 基本写屏障验证
out/x64.debug/d8 --verify-write-barriers --expose-gc test_write_barriers.js

# 组合堆验证
out/x64.debug/d8 --verify-heap --verify-write-barriers --expose-gc test_write_barriers.js

# 查看GC详情
out/x64.debug/d8 --verify-write-barriers --trace-gc --expose-gc test_write_barriers.js
```

#### 📊 运行结果说明

**成功情况**:
```
Write barrier verification completed
```
- 所有写操作都正确触发了写屏障
- 没有遗漏的引用更新

**失败情况**:
```
#
# Fatal error in ../src/heap/incremental-marking.cc, line 156
# Check failed: marking_state()->IsMarked(host)
# Write barrier missing for object at address 0x...
#
```

**错误信息解读**:
- `IsMarked(host)`: 宿主对象应该已标记但未标记
- `Write barrier missing`: 某个写操作没有正确触发写屏障
- 地址信息: 出问题的对象地址

---

### 1.3 TurboFan 编译器验证

#### ✅ 功能说明

**标志位**: `--turbo-verify`

在TurboFan优化编译的每个阶段验证IR图(中间表示)的正确性，包括类型系统、图结构、控制流等。

- **实现位置**: `src/compiler/verifier.h`, `src/compiler/verifier.cc`
- **默认状态**:
  - ✅ **Debug 构建**: 默认启用 (无需命令行参数)
  - ❌ **OptDebug/Release 构建**: 默认关闭 (需要 `--turbo-verify`)
- **性能影响**: 高 (每个编译阶段都会完整遍历图)

#### ⚙️ 开启方式

**方式一: Debug 构建（推荐，自动启用）**

```bash
# Debug 构建自动启用 TurboFan 验证，无需额外参数
tools/dev/gm.py quiet x64.debug

# 直接运行即可，验证自动进行
out/x64.debug/d8 --allow-natives-syntax test.js
```

**方式二: OptDebug/Release 构建（需手动指定）**

```bash
# 构建
tools/dev/gm.py quiet x64.release

# 运行时显式启用验证
out/x64.release/d8 --turbo-verify --allow-natives-syntax test.js

# 仅验证特定函数的机器图
out/x64.release/d8 --turbo-verify-machine-graph="hotFunction" --allow-natives-syntax test.js

# 同时验证寄存器分配
out/x64.release/d8 --turbo-verify --turbo-verify-allocation --allow-natives-syntax test.js
```

**验证默认值**:
```bash
# 检查当前构建的默认值
out/x64.debug/d8 --help | grep turbo-verify
# Debug: --turbo-verify (verify TurboFan graphs) type: bool  default: true
# Release: --turbo-verify (verify TurboFan graphs) type: bool  default: false
```

#### 🎯 适用场景

1. **开发TurboFan优化pass**: 确保新的优化不破坏图不变式
2. **调试优化bug**: 找出哪个编译阶段引入了问题
3. **验证类型系统**: 检查类型推导的正确性
4. **调试codegen问题**: 验证机器码生成前的IR

#### 📝 具体JS用例

**测试用例**: `test_turbo_verify.js`
```javascript
// 创建会被TurboFan优化的热函数
function hotMathFunction(x, y) {
  // 包含各种操作以测试不同的编译阶段
  let sum = x + y;
  let product = x * y;
  let result = sum > 100 ? product : sum;
  return result * 2;
}

function testInlining() {
  function inner(a) {
    return a * a;
  }

  function outer(b) {
    return inner(b) + inner(b + 1);  // 应该被内联
  }

  return outer;
}

// 预热函数以触发TurboFan优化
function warmup(func, ...args) {
  // 准备优化（V8新要求，必须在优化前调用）
  %PrepareFunctionForOptimization(func);

  // 先用Ignition/Sparkplug执行
  for (let i = 0; i < 100; i++) {
    func(...args);
  }

  // 标记为热点，触发TurboFan编译
  %OptimizeFunctionOnNextCall(func);
  func(...args);  // 这次调用会触发优化编译
}

// 测试不同类型的函数
warmup(hotMathFunction, 10, 20);

let outerFunc = testInlining();
warmup(outerFunc, 5);

console.log("TurboFan verification completed");
console.log("Result:", hotMathFunction(15, 25));
```

#### 💻 运行命令

```bash
# 基本TurboFan验证
out/x64.debug/d8 --turbo-verify --allow-natives-syntax test_turbo_verify.js

# 验证特定函数
out/x64.debug/d8 --turbo-verify-machine-graph="hotMathFunction" \
                  --allow-natives-syntax test_turbo_verify.js

# 验证寄存器分配
out/x64.debug/d8 --turbo-verify --turbo-verify-allocation \
                  --allow-natives-syntax test_turbo_verify.js

# 查看优化过程
out/x64.debug/d8 --turbo-verify --trace-opt --trace-turbo \
                  --allow-natives-syntax test_turbo_verify.js
```

#### 📊 运行结果说明

**成功情况**:
```
[optimizing 0x... <hotMathFunction> (TurboFan) - took 2.5 ms]
TurboFan verification completed
Result: 80
```
- `[optimizing ...]`: 函数被TurboFan优化
- 所有编译阶段的验证都通过
- 无验证错误输出

**失败情况**:
```
#
# Fatal error in ../src/compiler/verifier.cc, line 324
# Verification failed in phase 'load elimination'
# Type mismatch for node #42: expected Number, got Any
#

Trace/breakpoint trap
```

**错误信息解读**:
- `Verification failed in phase`: 哪个编译阶段失败
- `Type mismatch for node`: 节点类型不一致
- Node number (#42): 图中的节点ID，可用Turbolizer查看

**调试技巧**:
```bash
# 生成可视化图以定位问题节点
out/x64.debug/d8 --turbo-verify --trace-turbo-graph \
                  --allow-natives-syntax test_turbo_verify.js

# 在tools/turbolizer中加载生成的 turbo-*.json 文件
# 查找 node #42 查看其输入输出和类型
```

---

### 1.4 CSA 代码验证

#### ✅ 功能说明

**标志位**: `--verify-csa`

验证由CodeStubAssembler (CSA) 或 Torque 生成的代码的正确性，包括类型检查、控制流验证等。

- **实现位置**: `src/compiler/code-assembler.cc`
- **默认状态**:
  - ✅ **Debug 构建**: 默认启用 (无需命令行参数)
  - ❌ **OptDebug/Release 构建**: 默认关闭 (需要 `--verify-csa`)
- **适用范围**: Builtins、IC stubs、Torque生成的代码

#### ⚙️ 开启方式

**方式一: Debug 构建（自动启用）**

```bash
# Debug 构建自动启用 CSA 验证
tools/dev/gm.py quiet x64.debug

# 直接运行，验证自动进行
out/x64.debug/d8 test_csa_verify.js
```

**方式二: OptDebug/Release 构建（需手动指定）**

```bash
# 运行时显式启用
out/x64.release/d8 --verify-csa test_csa_verify.js

# 追踪验证过程（调试用）
out/x64.release/d8 --verify-csa --trace-verify-csa test_csa_verify.js
```

#### 🎯 适用场景

1. **开发Torque代码**: 验证新的builtin实现
2. **修改Array/Map等builtins**: 确保逻辑正确
3. **调试IC (Inline Cache)**: 验证stub代码生成
4. **类型系统检查**: 确保Torque类型约束被遵守

#### 📝 具体JS用例

**测试用例**: `test_csa_verify.js`
```javascript
// 测试各种会调用CSA builtins的操作

// Array builtins
function testArrayBuiltins() {
  let arr = [1, 2, 3, 4, 5];

  // Array.prototype.map (Torque实现)
  let doubled = arr.map(x => x * 2);

  // Array.prototype.filter (Torque实现)
  let evens = arr.filter(x => x % 2 === 0);

  // Array.prototype.reduce (Torque实现)
  let sum = arr.reduce((a, b) => a + b, 0);

  return { doubled, evens, sum };
}

// Object property access (触发IC stubs)
function testPropertyAccess() {
  let obj = { x: 1, y: 2, z: 3 };

  let results = [];
  for (let i = 0; i < 100; i++) {
    results.push(obj.x + obj.y + obj.z);  // 触发LoadIC
  }

  return results;
}

// String builtins
function testStringBuiltins() {
  let str = "Hello, World!";

  return {
    upper: str.toUpperCase(),
    lower: str.toLowerCase(),
    slice: str.slice(0, 5),
    indexOf: str.indexOf("World")
  };
}

// 执行测试
console.log(testArrayBuiltins());
console.log(testPropertyAccess()[0]);
console.log(testStringBuiltins());
console.log("CSA verification completed");
```

#### 💻 运行命令

```bash
# 基本CSA验证
out/x64.debug/d8 --verify-csa test_csa_verify.js

# 追踪验证过程
out/x64.debug/d8 --verify-csa --trace-verify-csa test_csa_verify.js

# 组合其他验证
out/x64.debug/d8 --verify-csa --verify-heap test_csa_verify.js
```

#### 📊 运行结果说明

**成功情况**:
```
{ doubled: [ 2, 4, 6, 8, 10 ], evens: [ 2, 4 ], sum: 15 }
6
{ upper: 'HELLO, WORLD!', lower: 'hello, world!', slice: 'Hello', indexOf: 7 }
CSA verification completed
```
- 所有builtin调用都验证通过
- 功能正常执行

**失败情况**(使用 --trace-verify-csa):
```
# Verifying builtin ArrayMapLoopContinuation
# Type error: Expected Smi, got HeapObject
#
# Fatal error in CSA verification
```

**错误信息解读**:
- `Verifying builtin`: 正在验证的builtin名称
- `Type error`: CSA类型检查失败
- 通常表示Torque代码或CSA手写代码有bug

---

### 1.5 Turboshaft 验证

#### ✅ 功能说明

**标志位**: `--turboshaft-verify-reductions`

Turboshaft是V8新一代编译器基础设施，这些标志验证其各个优化pass的正确性。

- **实现位置**: `src/compiler/turboshaft/`
- **默认状态**: ❌ 关闭 (新特性，默认禁用)
- **状态**: 实验性，逐步替代TurboFan

#### ⚙️ 开启方式

**前置条件**:
- 较新的V8版本 (支持Turboshaft)
- Debug/OptDebug 构建

**命令行标志**:
```bash
--turboshaft-verify-reductions          # 验证reduction passes
--turboshaft-verify-load-elimination    # 验证load elimination
--turboshaft-enable                     # 启用Turboshaft (可能需要)
```

#### 🎯 适用场景

1. **Turboshaft开发**: 开发新的优化pass
2. **迁移TurboFan代码**: 验证Turboshaft实现的等价性
3. **性能调优**: 确保优化不引入bug

#### 📝 具体JS用例

**测试用例**: `test_turboshaft.js`
```javascript
// Turboshaft优化测试
function computeHeavy(n) {
  let result = 0;
  for (let i = 0; i < n; i++) {
    result += i * i;
  }
  return result;
}

// 触发Turboshaft编译 (如果启用)
for (let i = 0; i < 100; i++) {
  computeHeavy(1000);
}

if (typeof %OptimizeFunctionOnNextCall === 'function') {
  %OptimizeFunctionOnNextCall(computeHeavy);
  computeHeavy(1000);
}

console.log("Turboshaft verification completed");
```

#### 💻 运行命令

```bash
# 启用并验证Turboshaft
out/x64.debug/d8 --turboshaft-enable \
                  --turboshaft-verify-reductions \
                  --allow-natives-syntax \
                  test_turboshaft.js

# 查看编译信息
out/x64.debug/d8 --turboshaft-enable \
                  --turboshaft-verify-reductions \
                  --trace-opt \
                  --allow-natives-syntax \
                  test_turboshaft.js
```

#### 📊 运行结果说明

**成功情况**:
```
Turboshaft verification completed
```
- Turboshaft验证通过或未启用
- 功能正常

**注意**: Turboshaft可能在某些V8版本中默认不启用或不完整。如果看到TurboFan而非Turboshaft，说明当前版本未使用Turboshaft编译该函数。

---

## 2. Log 日志能力

---

### 2.1 代码事件日志

#### ✅ 功能说明

**标志位**: `--log-code`

记录所有代码生成事件，包括函数编译、内置函数加载、代码优化等。输出到 `v8.log` 文件，可用于性能分析。

- **实现位置**: `src/logging/log.h`, `src/logging/log.cc`
- **默认状态**: ❌ 关闭
- **性能影响**: 低 (5-10%)
- **输出文件**: `v8.log` 或自定义文件名

#### ⚙️ 开启方式

**前置条件**:
- 任意构建模式 (Release推荐用于性能分析)

**命令行标志**:
```bash
--log-code                  # 记录代码生成事件
--log-source-code           # 同时记录源代码
--log-source-position       # 记录详细源码位置
--log-code-disassemble      # 记录反汇编代码
--logfile=<filename>        # 指定日志文件名
```

#### 🎯 适用场景

1. **性能分析**: 了解哪些函数被编译，编译层级
2. **优化确认**: 验证函数是否被TurboFan/Maglev优化
3. **代码覆盖**: 查看哪些代码路径被执行
4. **Profiling准备**: 为 tick processor 生成符号信息

#### 📝 具体JS用例

**测试用例**: `test_log_code.js`
```javascript
// 测试各种代码生成场景
function simpleFunction(x) {
  return x * 2;
}

function complexFunction(arr) {
  return arr.map(x => x * 2).filter(x => x > 10).reduce((a, b) => a + b, 0);
}

// 触发Ignition字节码编译
for (let i = 0; i < 10; i++) {
  simpleFunction(i);
  complexFunction([1, 2, 3, 4, 5, 6, 7, 8]);
}

// 触发优化编译 (需要更多调用)
for (let i = 0; i < 1000; i++) {
  simpleFunction(i);
  complexFunction([1, 2, 3, 4, 5, 6, 7, 8]);
}

// eval 触发新的编译
eval("function evalFunc() { return 42; }");
evalFunc();

console.log("Code logging test completed");
```

#### 💻 运行命令

```bash
# 基本代码日志
out/x64.release/d8 --log-code test_log_code.js

# 包含源码
out/x64.release/d8 --log-code --log-source-code test_log_code.js

# 详细位置信息
out/x64.release/d8 --log-code --log-source-position test_log_code.js

# 自定义日志文件
out/x64.release/d8 --log-code --logfile=my_code.log test_log_code.js

# 完整profiling
out/x64.release/d8 --prof test_log_code.js  # --prof 隐含 --log-code
```

#### 📊 运行结果说明

**日志文件**: `v8.log` 或 `isolate-0x...-v8.log`

**日志格式示例**:
```
code-creation,LazyCompile,0x2f9d00084d81,324,simpleFunction,test_log_code.js:2:26,0x2f9d00012345
code-creation,LazyCompile,0x2f9d00085001,1024,complexFunction,test_log_code.js:6:26,0x2f9d00012678

# 优化后的代码
code-creation,Builtin,0x...,100,MaglevCompileLazy
code-creation,OptimizedFunction,0x2f9d00085301,256,simpleFunction,test_log_code.js:2:26,0x2f9d00012345
```

**字段含义**:
1. `code-creation`: 事件类型
2. `LazyCompile/OptimizedFunction`: 编译类型
3. `0x2f9d00084d81`: 代码地址
4. `324`: 代码大小(字节)
5. `simpleFunction`: 函数名
6. `test_log_code.js:2:26`: 源文件位置
7. `0x2f9d00012345`: SharedFunctionInfo地址

**使用tick processor分析**:
```bash
# 处理日志文件
tools/linux-tick-processor v8.log

# 输出示例：
Statistical profiling result from v8.log
   ticks  total  nonlib   name
    512   25.6%   35.2%  JavaScript
    345   17.2%   23.7%  LazyCompile: *complexFunction test_log_code.js:6
    167    8.3%   11.5%  LazyCompile: *simpleFunction test_log_code.js:2
```

---

### 2.2 反优化日志

#### ✅ 功能说明

**标志位**: `--log-deopt`

记录函数反优化(deoptimization)事件，包括反优化原因、触发位置等关键信息。

- **实现位置**: `src/deoptimizer/`
- **默认状态**: ❌ 关闭
- **性能影响**: 低 (只在反优化时记录)

#### ⚙️ 开启方式

**前置条件**:
- 任意构建模式
- 需要有被优化的代码才能看到反优化

**命令行标志**:
```bash
--log-deopt                # 记录反优化事件
--trace-deopt              # 同时在控制台打印反优化信息
--trace-deopt-verbose      # 详细的反优化信息
```

#### 🎯 适用场景

1. **性能问题诊断**: 找出频繁反优化的函数
2. **类型不稳定**: 识别类型反馈不一致的代码
3. **优化失败**: 了解为什么优化的代码回退
4. **代码质量**: 发现需要改进的代码模式

#### 📝 具体JS用例

**测试用例**: `test_log_deopt.js`
```javascript
// 会导致反优化的代码模式

// 示例1: 类型不稳定
function unstableTypes(x) {
  return x + 1;
}

// 准备优化
%PrepareFunctionForOptimization(unstableTypes);

// 先用数字调用，让V8优化为Number+Number
for (let i = 0; i < 10000; i++) {
  unstableTypes(i);
}

// 强制优化
%OptimizeFunctionOnNextCall(unstableTypes);
unstableTypes(100);

// 用字符串调用，触发反优化!
unstableTypes("hello");  // Deopt: wrong type

// 示例2: Hidden class变化
function Point(x, y) {
  this.x = x;
  this.y = y;
}

function processPoint(p) {
  return p.x + p.y;
}

// 准备优化
%PrepareFunctionForOptimization(processPoint);

// 预热
for (let i = 0; i < 10000; i++) {
  processPoint(new Point(i, i));
}

// 优化
%OptimizeFunctionOnNextCall(processPoint);
processPoint(new Point(1, 2));

// 添加新属性，改变hidden class，触发反优化
let p = new Point(1, 2);
p.z = 3;  // 改变map
processPoint(p);  // Deopt: wrong map

console.log("Deopt logging test completed");
```

#### 💻 运行命令

```bash
# 日志文件记录
out/x64.release/d8 --log-deopt --allow-natives-syntax test_log_deopt.js

# 控制台输出 + 日志
out/x64.release/d8 --log-deopt --trace-deopt --allow-natives-syntax test_log_deopt.js

# 详细反优化信息
out/x64.release/d8 --trace-deopt-verbose --allow-natives-syntax test_log_deopt.js
```

#### 📊 运行结果说明

**控制台输出** (使用 --trace-deopt):
```
[deoptimizing (DEOPT eager): begin 0x... <unstableTypes> @1, FP to SP delta: 40, caller sp: 0x...]
            ;;; deoptimize at <test_log_deopt.js:3:10>, wrong type
  reading input frame unstableTypes => bytecode_offset=1, args=2, height=1; inputs:
      0: 0x2f9d00012345 ; [fp - 16] 0x2f9d00012345 <JSFunction unstableTypes>
      1: 0x2f9d00023456 ; [fp - 24] 0x2f9d00023456 <String[5]: hello>
[deoptimizing (eager): end 0x... <unstableTypes> @1 => node=1, pc=0x..., caller sp=0x..., took 0.045 ms]
```

**日志文件输出** (v8.log):
```
code-deopt,1,4,eager,1,3,wrong type,test_log_deopt.js:3:10
code-deopt,2,8,eager,5,2,wrong map,test_log_deopt.js:18:12
```

**字段含义**:
- `code-deopt`: 事件类型
- `1, 4`: 反优化计数器
- `eager/soft`: 反优化类型
- `wrong type/wrong map`: 反优化原因
- `test_log_deopt.js:3:10`: 触发位置

**常见反优化原因**:
- `wrong type`: 类型假设不成立
- `wrong map`: 对象结构变化
- `not a heap number`: Smi溢出
- `not a number`: 非数字类型
- `overflow`: 算术溢出

---

### 2.3 IC 状态转换日志

#### ✅ 功能说明

**标志位**: `--log-ic`

记录Inline Cache (IC) 的状态转换，包括属性访问、函数调用等的优化过程。

- **实现位置**: `src/ic/`
- **默认状态**: ❌ 关闭
- **性能影响**: 低-中 (5-15%)
- **隐含依赖**: 自动启用 `--log-code`

#### ⚙️ 开启方式

**前置条件**:
- 任意构建模式

**命令行标志**:
```bash
--log-ic                # 记录IC状态转换
--trace-ic              # 同时在控制台打印
```

#### 🎯 适用场景

1. **性能优化**: 了解属性访问的优化状态
2. **多态分析**: 识别单态/多态/超态调用点
3. **IC miss诊断**: 找出IC未命中的原因
4. **对象形状分析**: 理解hidden class的影响

#### 📝 具体JS用例

**测试用例**: `test_log_ic.js`
```javascript
// IC状态转换示例

// 1. 单态 LoadIC (Monomorphic)
function Point(x, y) {
  this.x = x;
  this.y = y;
}

function getX(obj) {
  return obj.x;  // LoadIC这里
}

// 只用一种类型，变为monomorphic
for (let i = 0; i < 100; i++) {
  getX(new Point(i, i));
}

// 2. 多态 LoadIC (Polymorphic)
function Point3D(x, y, z) {
  this.x = x;
  this.y = y;
  this.z = z;
}

function getValue(obj) {
  return obj.x;  // LoadIC这里
}

// 先用Point
for (let i = 0; i < 50; i++) {
  getValue(new Point(i, i));
}

// 再用Point3D，IC变为polymorphic
for (let i = 0; i < 50; i++) {
  getValue(new Point3D(i, i, i));
}

// 3. StoreIC
function setProperty(obj, val) {
  obj.value = val;  // StoreIC这里
}

let obj1 = {};
for (let i = 0; i < 100; i++) {
  setProperty(obj1, i);
}

console.log("IC logging test completed");
```

#### 💻 运行命令

```bash
# 日志文件记录
out/x64.release/d8 --log-ic test_log_ic.js

# 控制台输出
out/x64.release/d8 --trace-ic test_log_ic.js

# 详细IC信息
out/x64.release/d8 --trace-ic --log-ic test_log_ic.js
```

#### 📊 运行结果说明

**控制台输出** (使用 --trace-ic):
```
[LoadIC in ~getX at test_log_ic.js:9 0x... (0->.) map=0x... stub=0x...]
[LoadIC in ~getX at test_log_ic.js:9 0x... (.->1) map=0x... stub=0x...]  # MONOMORPHIC
[LoadIC in ~getValue at test_log_ic.js:20 0x... (0->.) map=0x... stub=0x...]
[LoadIC in ~getValue at test_log_ic.js:20 0x... (.->P) map=0x... stub=0x...]  # POLYMORPHIC
[StoreIC in ~setProperty at test_log_ic.js:32 0x... (0->.) map=0x... stub=0x...]
```

**IC状态代码**:
- `0`: UNINITIALIZED (未初始化)
- `.`: PREMONOMORPHIC (预单态)
- `1`: MONOMORPHIC (单态，最优)
- `P`: POLYMORPHIC (多态，2-4种类型)
- `N`: MEGAMORPHIC (超态，>4种类型，慢)

**性能含义**:
- MONOMORPHIC: 最快，直接访问
- POLYMORPHIC: 较快，需要类型检查
- MEGAMORPHIC: 慢，回退到通用访问

---

### 2.4 Map 创建日志

#### ✅ 功能说明

**标志位**: `--log-maps`

记录Map (Hidden Class) 的创建和转换，帮助理解对象形状的演化。

- **实现位置**: `src/objects/map.cc`
- **默认状态**: ❌ 关闭
- **性能影响**: 低

#### ⚙️ 开启方式

**前置条件**:
- 任意构建模式

**命令行标志**:
```bash
--log-maps              # 记录map创建
--log-maps-details      # 详细map信息 (默认开启)
--trace-maps            # 控制台输出map转换
```

#### 🎯 适用场景

1. **对象形状优化**: 理解对象结构变化
2. **性能调优**: 减少map转换
3. **调试IC问题**: 查看为什么IC失效
4. **内存分析**: 了解map数量和类型

#### 📝 具体JS用例

**测试用例**: `test_log_maps.js`
```javascript
// Map转换示例

// 1. 逐步添加属性
let obj = {};       // 创建初始map
obj.a = 1;          // map转换: {} -> {a}
obj.b = 2;          // map转换: {a} -> {a, b}
obj.c = 3;          // map转换: {a, b} -> {a, b, c}

// 2. 相同形状的对象共享map
function createPoint(x, y) {
  return { x: x, y: y };
}

let p1 = createPoint(1, 2);
let p2 = createPoint(3, 4);  // 共享同一个map

// 3. 不同添加顺序产生不同map
let obj1 = {};
obj1.x = 1;
obj1.y = 2;

let obj2 = {};
obj2.y = 2;  // 不同顺序
obj2.x = 1;  // 产生不同的map!

// 4. 元素类型变化
let arr = [1, 2, 3];          // PACKED_SMI_ELEMENTS
arr.push(1.5);                // 转换为 PACKED_DOUBLE_ELEMENTS
arr.push("hello");            // 转换为 PACKED_ELEMENTS

console.log("Maps logging test completed");
```

#### 💻 运行命令

```bash
# 日志文件记录
out/x64.release/d8 --log-maps test_log_maps.js

# 控制台输出
out/x64.release/d8 --trace-maps test_log_maps.js

# 详细信息
out/x64.release/d8 --trace-maps --log-maps-details test_log_maps.js
```

#### 📊 运行结果说明

**控制台输出** (使用 --trace-maps):
```
[Map transition from 0x2f9d00001001 to 0x2f9d00001101 at test_log_maps.js:4]
  Add property "a": Int32 at offset 0, from map 0x2f9d00001001
[Map transition from 0x2f9d00001101 to 0x2f9d00001201 at test_log_maps.js:5]
  Add property "b": Int32 at offset 1, from map 0x2f9d00001101
[ElementsKind transition: PACKED_SMI_ELEMENTS -> PACKED_DOUBLE_ELEMENTS]
[ElementsKind transition: PACKED_DOUBLE_ELEMENTS -> PACKED_ELEMENTS]
```

**Map转换类型**:
- `kFieldConst`: 添加常量属性
- `kDataField`: 添加数据属性
- `kAccessorField`: 添加访问器
- `kElementsTransition`: 数组元素类型变化

**优化建议**:
- 相同形状的对象用构造函数或对象字面量创建
- 按相同顺序添加属性
- 避免频繁改变对象结构

---

### 2.5 函数事件日志

#### ✅ 功能说明

**标志位**: `--log-function-events`

记录函数生命周期事件，包括解析、编译、执行等。

- **实现位置**: `src/objects/js-function.cc`
- **默认状态**: ❌ 关闭
- **性能影响**: 低

#### ⚙️ 开启方式

**前置条件**:
- 任意构建模式

**命令行标志**:
```bash
--log-function-events        # 记录函数事件
--log-code                   # 通常配合使用
```

#### 🎯 适用场景

1. **代码加载分析**: 了解函数何时被解析
2. **延迟编译**: 验证lazy compilation
3. **执行追踪**: 查看函数调用顺序
4. **性能优化**: 找出冷代码

#### 📝 具体JS用例

**测试用例**: `test_log_functions.js`
```javascript
// 函数生命周期测试

// 立即调用的函数
function immediate() {
  return "called immediately";
}
immediate();

// 延迟调用的函数
function delayed() {
  return "called later";
}

// 闭包
function outer() {
  let value = 42;
  return function inner() {
    return value;
  };
}
let closure = outer();
closure();

// 稍后调用delayed
setTimeout(() => {
  delayed();
}, 0);

console.log("Function events logged");
```

#### 💻 运行命令

```bash
# 记录函数事件
out/x64.release/d8 --log-function-events test_log_functions.js

# 组合代码日志
out/x64.release/d8 --log-function-events --log-code test_log_functions.js
```

#### 📊 运行结果说明

**日志输出**:
```
function-event,parse-script,test_log_functions.js
function-event,compile-lazy,immediate
function-event,compile-lazy,outer
function-event,compile-lazy,delayed  # 延迟到实际调用时才编译
```

**事件类型**:
- `parse-script`: 脚本解析
- `compile-lazy`: 延迟编译
- `compile-eager`: 立即编译
- `optimize`: 优化编译
- `deoptimize`: 反优化

---

## 3. 编译耗时统计

---

### 3.1 Runtime Call Stats (运行时调用统计)

#### ✅ 功能说明

**标志位**: `--runtime-call-stats` (简写: `--rcs`)

统计 V8 运行时的所有函数调用次数和耗时，包括 GC、API 调用、编译器调用等。输出详细的性能分析报告。

- **实现位置**: `src/logging/runtime-call-stats.h`, `src/logging/counters.h`
- **默认状态**: ❌ 关闭
- **性能影响**: 低-中 (10-20%)
- **输出位置**: 程序结束时输出到 stderr

#### ⚙️ 开启方式

**命令行标志**:
```bash
--runtime-call-stats         # 基本统计
--rcs                        # 简写
--rcs-cpu-time               # 使用 CPU 时间而非墙钟时间（更精确）
```

**前置条件**:
- 任意构建模式（Release 推荐，用于性能分析）
- 无需特殊编译选项

#### 🎯 适用场景

1. **性能瓶颈分析**: 找出哪些 V8 内部函数耗时最多
2. **GC 时间统计**: 查看垃圾回收占用的时间比例
3. **API 调用分析**: 了解嵌入器 API 调用频率
4. **编译器性能**: 统计编译各阶段的时间
5. **对比优化效果**: 代码优化前后的性能对比

#### 📝 具体JS用例

**测试用例**: `test_runtime_call_stats.js`
```javascript
// 综合测试：包含各种 V8 运行时操作

// 1. 数组操作 (触发 Array builtins)
function testArrayOperations() {
  let arr = [];
  for (let i = 0; i < 10000; i++) {
    arr.push(i);
  }

  let doubled = arr.map(x => x * 2);
  let filtered = arr.filter(x => x % 2 === 0);
  let sum = arr.reduce((a, b) => a + b, 0);

  return { doubled, filtered, sum };
}

// 2. 对象操作 (触发 IC, property access)
function testObjectOperations() {
  let objects = [];
  for (let i = 0; i < 5000; i++) {
    objects.push({
      id: i,
      name: `Object ${i}`,
      value: Math.random()
    });
  }

  // 大量属性访问
  let total = 0;
  for (let obj of objects) {
    total += obj.value;
  }

  return total;
}

// 3. 字符串操作
function testStringOperations() {
  let str = "Hello, World!";
  let result = [];

  for (let i = 0; i < 1000; i++) {
    result.push(str.toUpperCase());
    result.push(str.toLowerCase());
    result.push(str.slice(0, 5));
    result.push(str.repeat(10));
  }

  return result.join("");
}

// 4. 正则表达式
function testRegexOperations() {
  let text = "The quick brown fox jumps over the lazy dog";
  let pattern = /\b\w{5}\b/g;

  let matches = [];
  for (let i = 0; i < 1000; i++) {
    matches.push(...text.match(pattern));
  }

  return matches.length;
}

// 5. Promise 和异步 (触发 microtask 队列)
async function testAsyncOperations() {
  let promises = [];
  for (let i = 0; i < 100; i++) {
    promises.push(Promise.resolve(i));
  }

  return await Promise.all(promises);
}

// 6. 触发 GC
function allocateMemory() {
  let arr = [];
  for (let i = 0; i < 1000; i++) {
    arr.push(new Array(1000).fill(i));
  }
  return arr.length;
}

// 执行所有测试
console.log("Starting RCS test...");

testArrayOperations();
testObjectOperations();
testStringOperations();
testRegexOperations();
testAsyncOperations().then(() => {
  console.log("Async operations completed");
});

// 触发一些 GC
for (let i = 0; i < 5; i++) {
  allocateMemory();
}

if (globalThis.gc) {
  gc();
}

console.log("RCS test completed");
```

#### 💻 运行命令

```bash
# 基本统计
out/x64.release/d8 --runtime-call-stats test_runtime_call_stats.js

# 使用 CPU 时间（更精确）
out/x64.release/d8 --rcs-cpu-time test_runtime_call_stats.js

# 组合 GC 追踪
out/x64.release/d8 --rcs --trace-gc --expose-gc test_runtime_call_stats.js

# 简写形式
out/x64.release/d8 --rcs test_runtime_call_stats.js
```

#### 📊 运行结果说明

**输出格式** (程序结束时输出到 stderr):

```
Runtime call stats for test_runtime_call_stats.js
=================================================

          Time (us)      Count        Name
        -----------    -------  ---------
            125,432     12,345  JS_Execution
             45,678      5,432  GC_SCAVENGER
             32,109        156  GC_MARK_COMPACTOR
             21,456     10,000  ArrayPush
             18,234     10,000  ArrayMap
             15,678      5,000  LoadIC_Monomorphic
             12,345      5,000  StoreIC_Monomorphic
              8,901      1,000  StringToUpperCase
              7,654      1,000  StringToLowerCase
              5,432        100  Promise_Resolve
              ...

Total:       543,210    100,000
```

**关键字段含义**:
- **Time (us)**: 微秒，该函数总耗时
- **Count**: 调用次数
- **Name**: 函数/操作名称

**主要类别**:

1. **JavaScript 执行**:
   - `JS_Execution`: JavaScript 代码总执行时间
   - `Builtin_xxx`: 内置函数（Array.map, String.slice等）

2. **GC 相关**:
   - `GC_SCAVENGER`: 新生代 GC
   - `GC_MARK_COMPACTOR`: 老年代 GC
   - `GC_INCREMENTAL_MARKING`: 增量标记

3. **编译相关**:
   - `Compile`: 编译总时间
   - `OptimizeCode`: 优化编译
   - `ParseLazy`: 延迟解析

4. **IC (Inline Cache)**:
   - `LoadIC_xxx`: 属性加载
   - `StoreIC_xxx`: 属性存储
   - `_Monomorphic/_Polymorphic`: IC 状态

5. **API 调用**:
   - `API_Object_xxx`: 对象操作
   - `API_Array_xxx`: 数组操作

**性能分析技巧**:

```bash
# 将输出重定向到文件分析
out/x64.release/d8 --rcs test.js 2> rcs_output.txt

# 用 grep 过滤特定类别
out/x64.release/d8 --rcs test.js 2>&1 | grep GC
out/x64.release/d8 --rcs test.js 2>&1 | grep Compile
```

**优化建议**:
- 如果 `GC_xxx` 占比 > 20%，考虑减少内存分配
- 如果 `IC_Megamorphic` 很多，优化对象形状一致性
- 如果 `Compile` 时间长，考虑预热重要函数

---

### 3.2 Maglev 编译时间统计

#### ✅ 功能说明

**标志位**: `--trace-opt-stats` / `--maglev-stats`

Maglev 是 V8 的中级优化编译器（介于 Sparkplug 和 TurboFan 之间），提供详细的按函数、按阶段的编译时间统计。

- **实现位置**: `src/maglev/maglev-concurrent-dispatcher.cc`, `src/maglev/maglev-pipeline-statistics.h`
- **默认状态**: ❌ 关闭
- **性能影响**: 低 (5-10%)
- **编译阶段**: Prepare → Execute → Finalize (3个阶段，各自计时)

#### ⚙️ 开启方式

**命令行标志**:
```bash
--trace-opt-stats         # 实时显示每个函数编译信息
--maglev-stats            # 程序结束时显示汇总统计
--maglev-stats-nvp        # 机器可读的NVP格式（JSON）
```

**前置条件**:
- 任意构建模式 (Release 推荐)
- Maglev 默认启用（现代 V8 版本）

**编译阶段说明**:
1. **Prepare** (0.1-0.5 ms): 准备编译资源、创建job
2. **Execute** (5-20 ms): 构建图、优化、寄存器分配（最耗时）
3. **Finalize** (0.5-2 ms): 生成机器代码、安装到函数

#### 🎯 适用场景

1. **Maglev 性能分析**: 了解中级编译器的开销
2. **分层编译调优**: 对比 Sparkplug/Maglev/TurboFan 的编译时间
3. **大型应用启动优化**: 减少初始编译时间
4. **函数粒度分析**: 找出编译慢的函数
5. **回归测试**: 确保编译性能没有下降

#### 📝 具体JS用例

**测试用例**: `test_maglev_stats.js`
```javascript
// 创建不同复杂度的函数来测试 Maglev 编译时间

// 1. 简单函数
function simpleAdd(a, b) {
  return a + b;
}

// 2. 中等复杂度 - 包含循环
function sumArray(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}

// 3. 较复杂 - 包含条件和多个操作
function processData(data) {
  let result = {
    sum: 0,
    count: 0,
    average: 0
  };

  for (let item of data) {
    if (item > 0) {
      result.sum += item;
      result.count++;
    }
  }

  result.average = result.count > 0 ? result.sum / result.count : 0;
  return result;
}

// 4. 包含内联候选
function mathOperations(x) {
  function square(n) { return n * n; }
  function double(n) { return n * 2; }

  return square(x) + double(x);
}

// 5. 长函数 - 可能触发特殊优化路径
function longFunction(n) {
  let result = 0;

  // 多个代码块
  for (let i = 0; i < n; i++) {
    result += i;
  }

  for (let i = 0; i < n; i++) {
    result *= 2;
  }

  for (let i = 0; i < n; i++) {
    result -= i;
  }

  // 一些条件
  if (result > 1000) {
    result /= 2;
  } else if (result < -1000) {
    result *= -1;
  }

  return result;
}

// 预热并触发 Maglev 编译
function warmupForMaglev(func, ...args) {
  // Maglev 通常在函数被调用一定次数后触发
  // 不需要 natives syntax
  for (let i = 0; i < 100; i++) {
    func(...args);
  }
}

console.log("Warming up functions for Maglev compilation...");

// 预热所有函数
warmupForMaglev(simpleAdd, 1, 2);
warmupForMaglev(sumArray, [1, 2, 3, 4, 5]);
warmupForMaglev(processData, [1, 2, 3, 4, 5, -1, -2]);
warmupForMaglev(mathOperations, 10);
warmupForMaglev(longFunction, 10);

console.log("Maglev compilation stats test completed");

// 执行更多调用以确保编译发生
for (let i = 0; i < 1000; i++) {
  simpleAdd(i, i + 1);
  sumArray([1, 2, 3, 4, 5, i]);
  processData([i, i + 1, i + 2]);
  mathOperations(i);
  longFunction(i % 20);
}
```

#### 💻 运行命令

```bash
# 实时显示每个函数的编译信息
out/x64.release/d8 --trace-opt-stats test_maglev_stats.js

# 程序结束时显示汇总统计
out/x64.release/d8 --maglev-stats test_maglev_stats.js

# JSON格式输出
out/x64.release/d8 --maglev-stats-nvp test_maglev_stats.js > maglev_stats.json

# 组合追踪优化决策
out/x64.release/d8 --trace-opt --trace-opt-stats test_maglev_stats.js

# 查看所有编译层级（Sparkplug + Maglev + TurboFan）
out/x64.release/d8 --trace-opt --trace-opt-stats --allow-natives-syntax test_maglev_stats.js
```

#### 📊 运行结果说明

**使用 --trace-opt-stats 的输出** (实时):

```
[compiling method 0x... <simpleAdd> (Maglev) using Maglev]
[maglev] Compiled: 1 function with 45 byte source size in 1.23 ms
[compiling method 0x... <sumArray> (Maglev) using Maglev]
[maglev] Compiled: 1 function with 128 byte source size in 3.45 ms
[compiling method 0x... <processData> (Maglev) using Maglev]
[maglev] Compiled: 1 function with 256 byte source size in 6.78 ms
[compiling method 0x... <mathOperations> (Maglev) using Maglev]
[maglev] Compiled: 1 function with 89 byte source size in 2.10 ms
[compiling method 0x... <longFunction> (Maglev) using Maglev]
[maglev] Compiled: 1 function with 512 byte source size in 12.34 ms
```

**字段含义**:
- **function count**: 本次编译的函数数量
- **source size**: 源码大小（字节）
- **compilation time**: 编译总耗时（毫秒）

**使用 --maglev-stats 的输出** (汇总):

```
Maglev compilation statistics:
===============================

Total functions compiled: 5
Total source size: 1030 bytes
Total compilation time: 25.90 ms
Average time per function: 5.18 ms

Phase breakdown (average):
  Prepare:   0.35 ms (6.8%)
  Execute:  17.82 ms (68.8%)
  Finalize:  6.32 ms (24.4%)

Slowest functions:
  1. longFunction    - 12.34 ms (512 bytes)
  2. processData     -  6.78 ms (256 bytes)
  3. sumArray        -  3.45 ms (128 bytes)
```

**性能分析**:

1. **Execute 阶段占比高** (60-70%):
   - 正常现象，图构建和优化最耗时
   - 如果超过 80%，可能图太复杂

2. **编译时间 vs 源码大小**:
   - 简单函数: ~0.1 ms/10 bytes
   - 中等复杂: ~0.5 ms/10 bytes
   - 复杂函数: ~1.0 ms/10 bytes

3. **优化建议**:
   - 长函数编译慢: 考虑拆分函数
   - 频繁编译: 检查是否有类型不稳定导致重编译

**调试技巧**:

```bash
# 查看特定函数的编译过程
out/x64.release/d8 --trace-opt-verbose --trace-opt-stats test.js 2>&1 | grep simpleAdd

# 对比 Maglev vs TurboFan 编译时间
out/x64.release/d8 --trace-opt-stats --allow-natives-syntax test.js

# 导出统计数据供分析
out/x64.release/d8 --maglev-stats-nvp test.js 2>&1 | tee stats.json
```

---

## 4. 优化追踪

### 4.1 通用优化追踪

#### ✅ 功能说明

**标志位**: `--trace-opt` / `--trace-deopt`

追踪 JavaScript 函数的优化和反优化过程，了解哪些函数被优化、为何反优化。

- **默认状态**: ❌ 关闭
- **性能影响**: 中等（20-40%）

#### ⚙️ 开启方式

```bash
# 基本优化追踪
out/x64.release/d8 --trace-opt script.js

# 追踪反优化
out/x64.release/d8 --trace-deopt script.js

# 详细模式
out/x64.release/d8 --trace-opt-verbose --trace-deopt-verbose script.js

# 优化统计（每个函数的编译时间）
out/x64.release/d8 --trace-opt-stats script.js
```

#### 🎯 适用场景

- 检查函数是否被优化
- 诊断频繁反优化问题
- 分析优化决策和时机

#### 📝 测试用例

参见 `v8_analyze/test-cases/test_log_deopt.js`

#### 📊 输出示例

```
[marking 0x... <JS Function hotFunction> for optimization, mode: concurrent]
[compiling method 0x... <JS Function hotFunction> with Maglev, mode: concurrent]
[optimizing 0x... <JS Function hotFunction> - took 12.5ms]

[deoptimizing (DEOPT eager): begin. deoptimizing hotFunction, mode: eager]
[bailout: wrong type feedback]
```

**解读**:
- `marking for optimization`: 函数被标记为热点
- `compiling with Maglev/TurboFan`: 使用何种编译器优化
- `took Xms`: 编译耗时
- `deoptimizing`: 发生反优化，并说明原因（如类型反馈错误）

---

### 4.2 TurboFan 编译器追踪

#### ✅ 功能说明

**标志位**: `--trace-turbo` / `--trace-turbo-graph`

追踪 TurboFan 高级优化编译器的工作过程，生成 IR 图和优化决策日志。

- **默认状态**: ❌ 关闭
- **性能影响**: 高（2-5x）
- **输出文件**: `turbo-<function>-<phase>.json`, `turbo-<function>.cfg`

#### ⚙️ 开启方式

```bash
# 追踪 TurboFan IR 生成
out/x64.debug/d8 --trace-turbo script.js

# 生成图形化数据（可用 Turbolizer 可视化）
out/x64.debug/d8 --trace-turbo-graph script.js

# 仅追踪特定函数
out/x64.debug/d8 --trace-turbo-filter="hotFunction" script.js

# 追踪内联决策
out/x64.debug/d8 --trace-turbo-inlining script.js
```

#### 🎯 适用场景

- 编译器开发和调试
- 深入分析优化过程
- 理解内联、逃逸分析等优化决策

#### 🔧 可视化工具

使用 `tools/turbolizer/index.html` 加载生成的 `turbo-*.json` 文件，可视化查看优化过程。

---

### 4.3 Maglev 中级优化追踪

#### ✅ 功能说明

**标志位**: `--trace-maglev-*`

追踪 Maglev 中级优化编译器的各个阶段，包括图构建、内联、寄存器分配等。

- **默认状态**: ❌ 关闭
- **性能影响**: 中等

#### ⚙️ 常用标志

```bash
# 追踪图构建
out/x64.debug/d8 --trace-maglev-graph-building script.js

# 追踪内联决策
out/x64.debug/d8 --trace-maglev-inlining script.js

# 追踪寄存器分配
out/x64.debug/d8 --trace-maglev-regalloc script.js
```

**注意**: Maglev 编译时间统计请使用 Section 3.2 中介绍的 `--maglev-stats`。

---

#### 📝 Try-Catch + For Loop 示例

Maglev 对 try-catch 和循环的处理是性能关键点。以下示例展示如何追踪这类场景：

**测试代码** (`maglev-try-catch-loop.js`):
```javascript
function processWithErrorHandling(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    try {
      sum += arr[i] * 2;
    } catch (e) {
      sum += 0;
    }
  }
  return sum;
}

// 预热函数
%PrepareFunctionForOptimization(processWithErrorHandling);

const testArray = new Array(1000).fill(42);
for (let i = 0; i < 100; i++) {
  processWithErrorHandling(testArray);
}

// 触发 Maglev 优化（必须用 OptimizeMaglevOnNextCall）
%OptimizeMaglevOnNextCall(processWithErrorHandling);
processWithErrorHandling(testArray);

console.log("Optimized result:", processWithErrorHandling(testArray));
```

**追踪命令**:
```bash
# 追踪图构建过程（观察 try-catch 如何被表示）
out/x64.debug/d8 --allow-natives-syntax \
  --trace-maglev-graph-building \
  maglev-try-catch-loop.js

# 追踪完整的编译过程
out/x64.debug/d8 --allow-natives-syntax \
  --trace-opt \
  --trace-maglev-graph-building \
  --maglev-stats \
  maglev-try-catch-loop.js
```

#### 📊 输出示例及逐行解释

```
[manually marking 0x... processWithErrorHandling for optimization to MAGLEV]
[compiling method processWithErrorHandling (target MAGLEV)]
Concurrent maglev has been disabled for tracing.
```

**解释**:
- `manually marking ... for optimization to MAGLEV`: 因为我们调用了 `%OptimizeMaglevOnNextCall`，V8 将函数标记为待 Maglev 优化
- `target MAGLEV`: 目标编译器是 Maglev（中级优化编译器），不是 TurboFan
- `Concurrent maglev has been disabled`: 由于启用了追踪，并发编译被禁用，改为同步编译（方便调试）

---

```
== New block (merge) ==
  4 : 33 03 00 00       GetNamedProperty a0, [0], [0]
  n10: LoadTaggedField [n2]  // 加载 arr.length
```

**解释**:
- `== New block (merge) ==`: 创建一个新的控制流基本块（basic block），这是循环前的初始化块
- `4 : 33 03 00 00 GetNamedProperty a0, [0], [0]`:
  - `4`: 字节码偏移量（第 4 字节）
  - `33 03 00 00`: 字节码指令的字节
  - `GetNamedProperty a0, [0], [0]`: 从参数 `a0` (即 `arr`) 获取属性，常量池索引 `[0]` 存储的是 `"length"` 字符串
  - 对应 JavaScript: `arr.length`
- `n10: LoadTaggedField [n2]`:
  - `n10`: Maglev IR 节点编号
  - `LoadTaggedField`: Maglev 的 IR 操作，从对象 `n2` (arr) 加载标记字段（length 字段）
  - Maglev 知道这是访问 length 属性，可以优化为直接字段访问

---

```
  8 : 77 f8 02          TestLessThan r1, [2]
  n16: TaggedEqual [n13, n15]  // i < length
```

**解释**:
- `8 : 77 f8 02 TestLessThan r1, [2]`:
  - 字节码偏移 8，测试寄存器 `r1` (存储变量 `i`) 是否小于累加器中的值
  - `[2]`: 反馈槽索引，用于类型反馈
  - 对应 JavaScript: `i < arr.length`
- `n16: TaggedEqual [n13, n15]`:
  - Maglev IR 节点，比较两个节点 `n13` 和 `n15` 是否相等（或小于）
  - 这是循环条件判断

---

```
== New block (loop header) ==
* VOs (Merge Frame State):
  r0: n32<> <- n42<>  // Phi(sum)
  r1: n33<> <- n44<>  // Phi(i)
```

**解释**:
- `== New block (loop header) ==`: 循环头块，每次循环迭代都会回到这里
- `* VOs (Merge Frame State)`: 虚拟对象/变量状态（Virtual Objects），显示寄存器的值来源
- `r0: n32<> <- n42<>  // Phi(sum)`:
  - `r0`: 寄存器 0（存储 `sum` 变量）
  - `n32`: 当前的 Phi 节点
  - `<- n42`: 来自节点 `n42`（循环体更新后的值）
  - **Phi 节点**: SSA (Static Single Assignment) 形式的关键，在循环头合并来自不同路径的值：
    - 第一次进入循环：`sum = 0`（初始值）
    - 后续迭代：`sum = 上次循环更新后的值`
- `r1: n33<> <- n44<>  // Phi(i)`: 同理，`i` 的 Phi 节点

**为什么需要 Phi 节点？**
- SSA 要求每个变量只赋值一次
- 循环变量会被多次赋值，所以在循环头用 Phi 节点"合并"多个来源的值

---

```
  18 : 35 03 05          GetKeyedProperty a0, [5]
  n19: LoadTaggedField [n2]  // arr[i]
```

**解释**:
- `18 : 35 03 05 GetKeyedProperty a0, [5]`:
  - 从数组 `a0` (arr) 获取键控属性（即数组元素）
  - `[5]`: 反馈槽，类型反馈告诉 Maglev 这是 PACKED_SMI_ELEMENTS（紧凑的小整数数组）
  - 对应 JavaScript: `arr[i]`
- `n19: LoadTaggedField [n2]`:
  - Maglev 知道这是数组元素访问，可以优化为直接内存读取（跳过属性查找）

---

```
  21 : 4f 02 04          MulSmi [2], [4]
  n21: Int32MultiplyWithOverflow [n19, n20]
```

**解释**:
- `21 : 4f 02 04 MulSmi [2], [4]`:
  - `MulSmi`: 乘以小整数（Small Integer）
  - `[2]`: 立即数 2
  - `[4]`: 反馈槽索引
  - 对应 JavaScript: `arr[i] * 2`
- `n21: Int32MultiplyWithOverflow [n19, n20]`:
  - Maglev 推断出类型是 Int32（32位整数）
  - `Int32MultiplyWithOverflow`: 使用优化的 32 位整数乘法，并检查溢出
  - 如果溢出（结果超出 Int32 范围），会触发去优化（deoptimization）

---

```
  24 : 40 f9 03          Add r0, [3]
  n22: Int32AddWithOverflow [n18, n21]  // sum += result
```

**解释**:
- `24 : 40 f9 03 Add r0, [3]`:
  - 将累加器的值（乘法结果）加到寄存器 `r0` (sum)
  - 对应 JavaScript: `sum += arr[i] * 2`
- `n22: Int32AddWithOverflow [n18, n21]`:
  - 同样是优化的 Int32 加法
  - 检查溢出

---

```
  27 : 1b f9 f6          Mov r0, r3
  30 : d2                Star0
  31 : 96 15             Jump [21]
  n24: Jump  // 跳过 catch block
```

**解释**:
- `27 : 1b f9 f6 Mov r0, r3`: 移动寄存器值（保存中间结果）
- `30 : d2 Star0`: 将累加器的值存储到寄存器 `r0`
- `31 : 96 15 Jump [21]`:
  - 无条件跳转 21 个字节
  - **关键**: 这个跳转跳过了 catch block（因为 try block 正常执行完毕）
  - 对应 JavaScript: try 块执行完，不进入 catch
- `n24: Jump`: Maglev IR 的跳转节点

---

```
== New block (exception handler) ==
- Creating exception merge state
  34 : 8d f6 01          CreateCatchContext r3, [1]
  46 : 4d 00 07          AddSmi [0], [7]
  // catch (e) { sum += 0; }
```

**解释**:
- `== New block (exception handler) ==`: 异常处理器块，只有抛异常时才会执行
- `Creating exception merge state`: 为异常情况创建合并状态（恢复现场）
- `34 : 8d f6 01 CreateCatchContext r3, [1]`:
  - 创建 catch 上下文（存储异常对象 `e`）
  - `[1]`: 常量池索引，指向 CATCH_SCOPE 信息
- `46 : 4d 00 07 AddSmi [0], [7]`:
  - 对应 JavaScript: `sum += 0`（catch block 中的操作）
  - 实际上这是空操作，编译器可能会优化掉

---

```
== Loop increment ==
  54 : 59 08             Inc [8]
  n44: Int32IncrementWithOverflow [n34]  // i++
```

**解释**:
- `== Loop increment ==`: 循环递增块
- `54 : 59 08 Inc [8]`:
  - 递增操作
  - `[8]`: 反馈槽
  - 对应 JavaScript: `i++`
- `n44: Int32IncrementWithOverflow [n34]`:
  - Maglev 优化的 Int32 递增，检查溢出

---

```
  57 : 95 35 00 09       JumpLoop [53], [0], [9]
  n45: ReduceInterruptBudgetForLoop(42)
  n46: JumpLoop  // 回到循环头
```

**解释**:
- `57 : 95 35 00 09 JumpLoop [53], [0], [9]`:
  - 向后跳转 53 个字节（回到循环头）
  - `[0]`: 循环深度
  - `[9]`: 反馈槽索引
- `n45: ReduceInterruptBudgetForLoop(42)`:
  - **关键**: 减少中断预算（interrupt budget）
  - V8 使用中断预算来决定何时进行 OSR (On-Stack Replacement)
  - 如果预算耗尽，可能会在循环中从 Maglev 代码跳到 TurboFan 代码
  - 也用于周期性检查（如 GC、调试器中断）
- `n46: JumpLoop`: 跳回循环头

---

```
Handler Table (size = 16)
   from   to       hdlr (prediction,   data)
  (  16,  31)  ->    33 (prediction=1, data=2)
```

**解释**:
- `Handler Table`: 异常处理器表，运行时用于查找异常处理器
- `from   to`: 受保护的字节码范围
  - `(16, 31)`: 字节码偏移 16 到 31 之间（try block）
- `hdlr`: handler 的缩写，异常处理器的位置
  - `-> 33`: 如果在偏移 16-31 之间抛异常，跳转到偏移 33（catch block）
- `prediction=1`: 预测这个 handler 会被执行（1 表示可能，用于分支预测）
- `data=2`: 附加数据（如上下文深度）

**工作原理**:
1. 运行时在 try block (16-31) 中执行
2. 如果抛异常（如 `arr[i]` 访问越界）
3. 查询 Handler Table，找到对应的 handler 偏移 33
4. 跳转到 catch block，执行 `catch (e) { sum += 0; }`

---

```
[completed compiling processWithErrorHandling (target MAGLEV) - took 40.821 ms]
Optimized result: 84000
```

**解释**:
- `completed compiling`: 编译完成
- `took 40.821 ms`: 编译耗时 40.821 毫秒（这是图构建的耗时，实际运行更快）
- `Optimized result: 84000`: 函数执行结果（1000 个元素，每个 42，乘以 2，求和 = 84000）

---

#### 🔍 关键概念总结

| 概念 | 解释 | 作用 |
|-----|------|------|
| **Phi 节点** | SSA 形式中合并多个来源值的节点 | 循环头合并初始值和更新后的值 |
| **Int32 优化** | 使用 32 位整数运算代替通用运算 | 性能提升，但需检查溢出 |
| **Handler Table** | 字节码范围到异常处理器的映射表 | 运行时快速找到 catch block |
| **Interrupt Budget** | 中断预算，计数器递减 | 决定 OSR 时机和周期性检查 |
| **基本块 (Basic Block)** | 顺序执行的指令序列（无分支） | 控制流图的最小单位 |
| **Tagged/Untagged** | Tagged: 带类型标记的值；Int32: 无标记整数 | Tagged 更通用，Int32 更快 |

#### ⚡ 性能影响

**Try-Catch 开销**:
- ✅ **正常路径（无异常）**: 几乎零开销
  - 只是一个无条件跳转（`Jump [21]`）跳过 catch block
  - Handler Table 不会被查询
  - 现代 CPU 分支预测几乎完美（try 路径更可能）

- ❌ **异常路径（抛异常）**: 较大开销
  - 查询 Handler Table
  - 创建 Catch Context
  - 栈展开（stack unwinding）
  - 但这是罕见情况，不影响热路径性能

**Maglev vs Ignition**:
- Ignition (解释器): 逐字节码解释执行
- Maglev (优化编译器):
  - Int32 优化运算（无装箱/拆箱）
  - 类型推断（知道是 PACKED_SMI_ELEMENTS）
  - 直接内存访问（跳过属性查找）
  - **性能提升**: 通常 5-10x

#### 🎯 适用场景

- 分析 Maglev 如何处理控制流复杂的代码
- 理解 try-catch 对优化的影响
- 调试循环优化相关问题
- 研究 Maglev 的寄存器分配策略

---

## 5. GC 追踪

### 5.1 基本 GC 追踪

#### ✅ 功能说明

**标志位**: `--trace-gc` / `--trace-gc-verbose`

追踪垃圾回收事件，包括 Scavenge（新生代）和 Mark-Sweep（老生代）。

- **默认状态**: ❌ 关闭
- **性能影响**: 中等（10-30%）

#### ⚙️ 开启方式

```bash
# 基本 GC 追踪
out/x64.release/d8 --trace-gc script.js

# 详细 GC 信息
out/x64.release/d8 --trace-gc-verbose script.js

# NVP 格式（易于解析）
out/x64.release/d8 --trace-gc-nvp script.js
```

#### 📊 输出示例

```
[12345] Scavenge 5.2 (10.0) -> 4.8 (11.0) MB, 2.3 ms
[12345] Mark-Sweep 45.2 (50.0) -> 32.1 (40.0) MB, 15.7 ms
```

**解读**:
- `Scavenge/Mark-Sweep`: GC 类型
- `5.2 -> 4.8 MB`: 堆内存从 5.2MB 减少到 4.8MB
- `(10.0) -> (11.0)`: 堆容量变化
- `2.3 ms`: GC 耗时

---

### 5.2 GC 详细诊断

#### ✅ 功能说明

**常用标志**:
- `--trace-fragmentation`: 追踪碎片化
- `--trace-gc-object-stats`: 对象统计
- `--trace-detached-contexts`: detached context 追踪（内存泄漏诊断）

#### ⚙️ 使用方式

```bash
# 碎片化分析
out/x64.release/d8 --trace-gc --trace-fragmentation script.js

# 对象统计（内存泄漏诊断）
out/x64.release/d8 --trace-gc-object-stats script.js

# detached context 追踪
out/x64.release/d8 --trace-detached-contexts script.js
```

#### 🎯 适用场景

- GC 暂停时间过长
- 内存泄漏问题
- 堆碎片化分析

---

## 6. 实用命令组合

### 6.1 优化分析组合

```bash
# 基础优化诊断
out/x64.release/d8 \
  --trace-opt \
  --trace-deopt \
  script.js

# 详细优化分析
out/x64.release/d8 \
  --trace-opt-verbose \
  --trace-deopt-verbose \
  --trace-turbo-inlining \
  script.js

# 性能 + 优化综合分析
out/x64.release/d8 \
  --trace-opt \
  --trace-deopt \
  --runtime-call-stats \
  script.js
```

---

### 6.2 GC 调试组合

```bash
# GC 基本诊断
out/x64.release/d8 \
  --trace-gc \
  --trace-gc-verbose \
  script.js

# GC 深度诊断（内存泄漏）
out/x64.release/d8 \
  --trace-gc \
  --trace-fragmentation \
  --trace-detached-contexts \
  --trace-gc-object-stats \
  script.js

# GC + 堆验证（Debug 构建）
out/x64.debug/d8 \
  --trace-gc \
  --verify-heap \
  --expose-gc \
  script.js
```

---

### 6.3 全面诊断组合

```bash
# 开发阶段验证（Debug 构建）
out/x64.debug/d8 \
  --verify-heap \
  --turbo-verify \
  --trace-opt \
  --trace-gc \
  script.js

# 性能分析（Release 构建）
out/x64.release/d8 \
  --runtime-call-stats \
  --trace-opt \
  --trace-gc \
  script.js

# 生产环境 Profiling
out/x64.release/d8 \
  --prof \
  --log-all \
  script.js
# 处理日志: tools/linux-tick-processor v8.log
```

---

### 6.4 性能影响对照表

| 功能类别 | 标志示例 | 性能影响 | 适用场景 |
|---------|---------|---------|---------|
| Verify | `--verify-heap` | 极高 (5-10x) | Debug 构建，问题诊断 |
| Basic Log | `--log` | 低 (5-10%) | 生产环境分析 |
| Trace GC | `--trace-gc` | 中 (10-30%) | 内存问题诊断 |
| Trace Opt | `--trace-opt` | 中 (20-40%) | 优化问题分析 |
| Trace Turbo | `--trace-turbo-graph` | 高 (2-5x) | 编译器开发 |
| Maglev Stats | `--maglev-stats` | 低-中 (5-15%) | Maglev 编译性能分析 |
| RCS | `--runtime-call-stats` | 低-中 (10-20%) | 性能瓶颈分析 |
| Profiling | `--prof` | 低 (5-15%) | 生产环境 profiling |

---

## 7. 常见问题排查

### 7.1 函数未被优化

#### 🔍 诊断方法

```bash
# 检查优化状态
out/x64.release/d8 --trace-opt --trace-opt-verbose script.js
```

#### 常见原因

- ❌ 使用了 `eval`、`with` 等特性（阻止优化）
- ❌ 函数过大（TurboFan 有大小限制）
- ❌ 类型不稳定（频繁改变参数类型）
- ❌ 函数未达到热点阈值（调用次数不够）

---

### 7.2 频繁反优化

#### 🔍 诊断方法

```bash
# 追踪反优化原因
out/x64.release/d8 --trace-deopt --trace-deopt-verbose script.js
```

**测试用例**: 参见 `v8_analyze/test-cases/test_log_deopt.js`

#### 常见原因

- ❌ **类型反馈不一致**: 函数参数类型变化（如先传数字，后传字符串）
- ❌ **Hidden class 变化**: 对象属性添加顺序不一致
- ❌ **数组元素类型变化**: 数组从存储整数变为存储浮点数

#### 解决方案

- ✅ 保持类型稳定（相同函数始终使用相同类型参数）
- ✅ 一致的对象构造（相同顺序添加属性）
- ✅ 避免修改已优化对象的结构

---

### 7.3 GC 暂停时间过长

#### 🔍 诊断方法

```bash
# 分析 GC 行为
out/x64.release/d8 --trace-gc --trace-gc-verbose --trace-fragmentation script.js
```

#### 常见原因

- ❌ 老生代对象过多（触发 Mark-Sweep）
- ❌ 堆碎片化严重
- ❌ 大对象频繁分配和释放

#### 解决方案

- ✅ 减少长生命周期对象
- ✅ 使用对象池复用对象
- ✅ 避免在热路径中创建大对象

---

### 7.4 内存泄漏

#### 🔍 诊断方法

```bash
# 追踪 detached contexts
out/x64.release/d8 --trace-detached-contexts script.js

# 对象统计
out/x64.release/d8 --trace-gc-object-stats script.js
```

#### 常见原因

- ❌ Detached DOM 节点（浏览器环境）
- ❌ 全局变量持有引用
- ❌ 闭包意外捕获大对象
- ❌ Event listener 未清理

---

### 7.5 输出文件说明

| 标志 | 输出文件 | 格式 | 后处理工具 |
|-----|---------|------|----------|
| `--log-all` / `--prof` | `v8.log` | 文本 | `tools/linux-tick-processor` |
| `--trace-turbo-graph` | `turbo-*.json` | JSON | `tools/turbolizer/index.html` |
| `--redirect-code-traces` | `code-*.asm` | 汇编 | 文本编辑器 |
| `--runtime-call-stats` | stdout | 文本/JSON | - |
| `--maglev-stats-nvp` | stdout | JSON | 自定义脚本 |

---

## 8. 总结

### 8.1 核心能力概览

V8 提供了 4 大类调试和性能分析工具:

1. **Verify 能力** (Section 1): 验证内部状态正确性
   - 堆验证、写屏障验证、编译器验证
   - 适合开发阶段问题诊断

2. **Log 能力** (Section 2): 事件记录系统
   - 代码日志、优化日志、反优化日志、IC 日志
   - 支持轻量级生产环境分析

3. **编译统计** (Section 3): 时间和内存统计
   - Runtime Call Stats、Maglev 编译时间
   - 性能瓶颈分析

4. **优化和 GC 追踪** (Section 4-5): 运行时追踪
   - 优化决策、反优化原因、GC 行为
   - 实时诊断优化和内存问题

---

### 8.2 最佳实践

#### 开发阶段（Debug 构建）

```bash
# 全面验证
out/x64.debug/d8 \
  --verify-heap \
  --turbo-verify \
  --trace-opt \
  --trace-gc \
  script.js
```

#### 性能分析（Release 构建）

```bash
# 综合分析
out/x64.release/d8 \
  --runtime-call-stats \
  --trace-opt \
  --trace-deopt \
  --trace-gc \
  script.js
```

#### 生产环境

```bash
# 轻量级 profiling
out/x64.release/d8 --prof --log-all script.js
tools/linux-tick-processor v8.log
```

---

### 8.3 快速查找指南

| 问题 | 使用工具 | 章节 |
|-----|---------|------|
| 函数未优化 | `--trace-opt-verbose` | 4.1, 7.1 |
| 频繁反优化 | `--trace-deopt-verbose` | 4.1, 7.2 |
| GC 暂停过长 | `--trace-gc --trace-fragmentation` | 5.1, 7.3 |
| 内存泄漏 | `--trace-detached-contexts` | 5.2, 7.4 |
| 性能瓶颈 | `--runtime-call-stats` | 3.1 |
| 编译耗时 | `--maglev-stats --trace-opt-stats` | 3.2 |

---

### 8.4 相关资源

**V8 源码文件**:
- 标志定义: `src/flags/flag-definitions.h`
- 日志实现: `src/logging/log.h`
- 验证实现: `src/heap/heap-verifier.h`
- RCS 实现: `src/logging/runtime-call-stats.h`
- Maglev 统计: `src/maglev/maglev-pipeline-statistics.h`

**测试用例**: `v8_analyze/test-cases/`
- `test_heap_verify.js`: 堆验证测试
- `test_turbo_verify.js`: TurboFan 验证测试
- `test_log_deopt.js`: 反优化日志测试
- `README.md`: 测试用例使用说明

**其他文档**:
- Maglev 编译时间详解: `v8_analyze/maglev_compilation_timing.md`
- V8 官方文档: https://v8.dev/docs

---

**文档版本**: v2.0 (精简版)
**更新日期**: 2025-10-23
**V8 版本**: 基于最新主分支
**变更说明**: 统一格式，删除重复和弱相关内容，新增可运行测试用例
