# ScopeInfo 深度解析

## 概述

**ScopeInfo** 是 V8 中存储作用域（Scope）元数据的对象，包含了作用域中变量的分配信息、类型、绑定方式等。它在运行时用于：

- 栈追踪和调试
- 解优化（Deoptimization）
- 闭包创建
- 变量查找

## ScopeInfo 的作用

在 JavaScript 中，每个作用域（函数、块、类、catch 块等）都有对应的 ScopeInfo 对象：

```javascript
function outer(x) {
  let y = 10;

  try {
    // 这里有 try 块的 ScopeInfo
    if (x > 0) {
      // 这里有 block 块的 ScopeInfo
      let z = 20;
    }
  } catch (e) {
    // ← CATCH_SCOPE 的 ScopeInfo 在这里
    console.log(e);
  }

  // outer 函数也有自己的 ScopeInfo
}
```

## ScopeInfo 的结构

### 核心字段

基于 `src/objects/scope-info.h` 的定义，ScopeInfo 包含以下信息：

#### 1. 作用域类型（Scope Type）

```cpp
enum ScopeType {
  EVAL_SCOPE,        // eval() 作用域
  FUNCTION_SCOPE,    // 函数作用域
  MODULE_SCOPE,      // ES6 模块作用域
  SCRIPT_SCOPE,      // 脚本级作用域
  CATCH_SCOPE,       // catch 块作用域  ← 我们的例子
  BLOCK_SCOPE,       // 块级作用域（let/const）
  CLASS_SCOPE,       // 类作用域
  WITH_SCOPE,        // with 语句作用域
  // ...
};
```

**CATCH_SCOPE** 专门用于 `catch (e) { ... }` 块，存储异常变量 `e` 的信息。

#### 2. 变量信息

ScopeInfo 存储作用域中所有变量的元数据：

```
变量列表：
  - 变量名（String）
  - 变量模式（VariableMode）：var, let, const, etc.
  - 分配位置：栈、上下文（堆）、模块
  - 初始化标志：已初始化、未初始化
  - 可能被赋值标志：用于优化
```

##### VariableMode（变量模式）

```cpp
enum VariableMode {
  kLet,              // let 声明
  kConst,            // const 声明
  kVar,              // var 声明
  kTemporary,        // 临时变量
  kDynamic,          // 动态变量（with, eval）
  kDynamicGlobal,    // 动态全局变量
  kDynamicLocal,     // 动态局部变量
  // ...
};
```

##### InitializationFlag（初始化标志）

```cpp
enum InitializationFlag {
  kCreatedInitialized,     // 创建时已初始化（var）
  kNeedsInitialization,    // 需要初始化（let/const）
};
```

#### 3. 上下文信息

- **ContextLength**: 上下文槽位数量
- **ContextLocalNames**: 上下文分配的变量名列表
- **ContextLocalModes**: 每个变量的模式
- **ContextLocalInitFlags**: 每个变量的初始化标志

#### 4. 其他元数据

- **LanguageMode**: 严格模式 / 非严格模式
- **FunctionKind**: 函数类型（普通函数、箭头函数、async 函数等）
- **OuterScopeInfo**: 指向外层作用域的 ScopeInfo（作用域链）
- **HasReceiver**: 是否有 `this` 绑定
- **HasNewTarget**: 是否有 `new.target` 绑定

## CATCH_SCOPE 详解

在我们的例子中：

```javascript
try {
  // ... some code ...
} catch (e) {
  // ← CATCH_SCOPE
  console.log("Error occurred");
  return -1;
}
```

### CATCH_SCOPE 的 ScopeInfo 包含：

#### 1. 作用域类型

```
scope_type: CATCH_SCOPE
```

#### 2. 异常变量信息

```
变量名: "e"
变量模式: kLet (catch 变量行为类似 let)
分配位置: Context slot (上下文槽位)
初始化标志: kCreatedInitialized (异常抛出时已初始化)
```

#### 3. 上下文布局

```
ContextLength: 4  (示例值，取决于变量数量)
  Slot 0: Context header
  Slot 1: ...
  Slot 2: ...
  Slot 3: e (异常变量，data=3 就指向这里)
```

### Handler Table 中的 data=3

回顾 Handler Table：

```
Handler Table (size = 16)
   from   to       hdlr (prediction,   data)
  (   7,  71)  ->    71 (prediction=1, data=3)
```

**data=3** 的含义：

- 表示异常变量 `e` 在上下文中的槽位索引是 **3**
- 当异常发生时，V8 会：
  1. 创建 CATCH_SCOPE 的上下文
  2. 将捕获的异常对象存入槽位 3
  3. 在 catch 块中可以通过变量名 `e` 访问

## ScopeInfo 的创建和使用

### 1. 编译时创建

在解析（Parsing）和编译阶段，V8 为每个作用域创建 ScopeInfo：

```
Parser → AST → Scope 树 → ScopeInfo 对象
                              ↓
                         BytecodeArray 常量池
```

### 2. 运行时使用

#### 变量查找

```cpp
// 伪代码：查找变量 'e' 在 catch 块中的位置
int slot = scope_info->ContextSlotIndex("e");
// 返回 3（对应 data=3）
```

#### 解优化

```cpp
// 解优化时恢复作用域状态
for (int i = 0; i < scope_info->ContextLength(); i++) {
  String name = scope_info->ContextLocalName(i);
  VariableMode mode = scope_info->ContextLocalMode(i);
  // 重建变量环境
}
```

#### 调试器

```cpp
// 调试器获取局部变量列表
for (auto name : scope_info->IterateLocalNames()) {
  // 显示变量名和值
}
```

## ScopeInfo 在字节码中的引用

### Constant Pool 中的存储

```
Constant pool (size = 5)
           0: <String[6]: #length>
           1: <ScopeInfo CATCH_SCOPE>  ← 存储在常量池
           2: <String[7]: #console>
           ...
```

### 字节码中的使用

```
@72 : CreateCatchContext r4, [1]
                              ↑
                    常量池索引 1（ScopeInfo）
```

**CreateCatchContext** 指令：

1. 读取常量池索引 1 的 ScopeInfo
2. 创建新的上下文对象
3. 根据 ScopeInfo 分配槽位
4. 将异常对象（在 r4 中）存入槽位 3

## ScopeInfo 示例对比

### 示例 1：简单函数

```javascript
function add(x, y) {
  return x + y;
}
```

ScopeInfo：

```
Type: FUNCTION_SCOPE
Variables:
  - x: parameter, stack slot
  - y: parameter, stack slot
ContextLength: 0 (无需上下文)
HasContext: false
```

### 示例 2：闭包

```javascript
function makeCounter() {
  let count = 0; // 需要上下文分配
  return function () {
    return count++;
  };
}
```

外层 ScopeInfo：

```
Type: FUNCTION_SCOPE
Variables:
  - count: kLet, context slot 0
ContextLength: 1
HasContext: true
```

内层 ScopeInfo：

```
Type: FUNCTION_SCOPE
OuterScopeInfo: → 外层 ScopeInfo
ContextLength: 0
HasContext: false (使用外层上下文)
```

### 示例 3：Catch 块（我们的例子）

```javascript
try {
  // ...
} catch (e) {
  console.log(e);
}
```

ScopeInfo：

```
Type: CATCH_SCOPE
Variables:
  - e: kLet, context slot 3
ContextLength: 4
HasContext: true
OuterScopeInfo: → try 块外层的 ScopeInfo
```

## 性能影响

### 1. 内存占用

ScopeInfo 对象存储在堆上，包含：

- 变量名字符串
- 元数据（类型、标志）
- 上下文布局信息

优化建议：

- 减少作用域嵌套深度
- 避免不必要的 `with` 语句（会创建额外的 ScopeInfo）
- 闭包中只捕获必要的变量

### 2. 变量访问性能

变量分配位置影响访问速度：

- **栈分配**（Stack）：最快，直接寄存器或栈偏移访问
- **上下文分配**（Context）：较慢，需要通过上下文对象查找
- **全局变量**：最慢，需要全局对象查找

示例：

```javascript
function example() {
  let x = 1; // 栈分配（快）

  return function () {
    return x; // x 变成上下文分配（较慢）
  };
}
```

### 3. 解优化开销

ScopeInfo 越复杂，解优化时恢复状态的开销越大：

- 更多变量需要恢复
- 更深的作用域链需要遍历

## 查看 ScopeInfo 的方法

### 方法 1：使用 --print-bytecode

```bash
out/x64.debug/d8 --print-bytecode script.js
# 查看 Constant pool 中的 ScopeInfo 引用
```

### 方法 2：使用 %DebugPrint

```javascript
function test() {
  try {
    throw new Error();
  } catch (e) {
    %DebugPrint(e); // 打印对象信息
  }
}

%PrepareFunctionForOptimization(test);
test();
```

### 方法 3：GDB/LLDB 调试

```bash
gdb --args out/x64.debug/d8 --allow-natives-syntax script.js

# 在 GDB 中
(gdb) break v8::internal::ScopeInfo::Create
(gdb) run
(gdb) print *scope_info
```

## 相关源代码位置

- ScopeInfo 定义: `src/objects/scope-info.h`
- ScopeInfo 实现: `src/objects/scope-info.cc`
- Scope 类: `src/ast/scopes.h`
- CreateCatchContext: `src/interpreter/interpreter-generator.cc`
- 解优化使用: `src/deoptimizer/deoptimizer.cc`

## 总结

| 方面           | 说明                                     |
| -------------- | ---------------------------------------- |
| **作用**       | 存储作用域的变量信息和元数据             |
| **存储位置**   | BytecodeArray 常量池                     |
| **作用域类型** | FUNCTION, BLOCK, CATCH, CLASS, MODULE 等 |
| **关键信息**   | 变量名、模式、分配位置、初始化状态       |
| **运行时用途** | 变量查找、解优化、调试                   |
| **性能影响**   | 影响内存占用和变量访问速度               |

**CATCH_SCOPE** 特点：

- 专门用于 catch 块
- 存储异常变量（如 `e`）
- 在 Handler Table 中通过 `data` 字段引用槽位
- 异常发生时动态创建上下文
