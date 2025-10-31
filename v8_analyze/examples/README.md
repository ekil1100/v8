# 示例和追踪脚本 (Examples & Tracing Scripts)

本目录包含用于演示和追踪 V8 编译器行为的 JavaScript 示例脚本。

## 文件列表

- **`maglev_trace_example.js`** - Maglev 基础追踪示例
- **`maglev_trace_complex_example.js`** - Maglev 复杂场景追踪示例

## maglev_trace_example.js

基础的 Maglev 编译追踪示例。

### 使用方法

```bash
# 基础追踪
out/x64.debug/d8 --trace-maglev --allow-natives-syntax maglev_trace_example.js

# 详细的图构建追踪
out/x64.debug/d8 --trace-maglev-graph-building --allow-natives-syntax maglev_trace_example.js

# 查看生成的代码
out/x64.debug/d8 --print-maglev-code --allow-natives-syntax maglev_trace_example.js

# 组合追踪
out/x64.debug/d8 \
  --trace-maglev \
  --trace-maglev-graph-building \
  --print-maglev-code \
  --code-comments \
  --allow-natives-syntax \
  maglev_trace_example.js
```

### 学习目标

- 理解 Maglev 编译触发条件
- 观察图构建过程
- 查看生成的机器码

## maglev_trace_complex_example.js

复杂场景的 Maglev 编译示例，包含：
- 控制流（if/else、循环）
- 异常处理（try/catch）
- 类型反馈
- 内联机会

### 使用方法

```bash
# 完整追踪（推荐）
out/x64.debug/d8 \
  --trace-maglev \
  --trace-maglev-graph-building \
  --trace-maglev-regalloc \
  --trace-opt \
  --trace-deopt \
  --allow-natives-syntax \
  maglev_trace_complex_example.js

# 查看优化统计
out/x64.release/d8 --maglev-stats --allow-natives-syntax maglev_trace_complex_example.js

# 对比不同编译层级
out/x64.debug/d8 --print-bytecode maglev_trace_complex_example.js
out/x64.debug/d8 --print-maglev-code --allow-natives-syntax maglev_trace_complex_example.js
out/x64.debug/d8 --print-opt-code --allow-natives-syntax maglev_trace_complex_example.js
```

### 学习目标

- 理解复杂控制流的处理
- 观察寄存器分配
- 理解反优化触发条件
- 对比不同编译层级

## 通用追踪标志

### 基础标志

```bash
--trace-maglev                    # 追踪 Maglev 编译
--trace-maglev-graph-building     # 追踪图构建
--trace-maglev-regalloc           # 追踪寄存器分配
--print-maglev-code               # 打印生成的代码
--code-comments                   # 在代码中添加注释
--allow-natives-syntax            # 启用 natives 语法（%函数）
```

### 优化相关

```bash
--trace-opt                       # 追踪优化
--trace-opt-verbose               # 详细的优化信息
--trace-deopt                     # 追踪反优化
--trace-feedback-updates          # 追踪反馈更新
```

### 统计相关

```bash
--maglev-stats                    # Maglev 编译统计
--runtime-call-stats              # 运行时调用统计
--trace-opt-stats                 # 优化统计
```

### 代码打印

```bash
--print-bytecode                  # 打印字节码
--print-maglev-code               # 打印 Maglev 代码
--print-opt-code                  # 打印 TurboFan 代码
```

## 强制编译

这些示例使用 V8 的 natives 语法来控制编译：

```javascript
// 准备函数以便优化
%PrepareFunctionForOptimization(myFunction);

// 调用几次以收集反馈
myFunction(1);
myFunction(2);

// 强制 Maglev 编译
%OptimizeMaglevOnNextCall(myFunction);
myFunction(3);

// 检查优化状态
%GetOptimizationStatus(myFunction);

// 或强制 TurboFan 编译
%OptimizeFunctionOnNextCall(myFunction);
myFunction(4);
```

## 交互式工具

除了直接运行这些示例，还可以使用交互式工具：

```bash
# Maglev 统计演示（推荐）
../test-cases/run_maglev_stats.sh

# 提供 11 种预设场景，包括：
# - 数值计算
# - 数组操作
# - 对象访问
# - 控制流
# - 异常处理
# - 内联
# 等等
```

## 编写自己的示例

### 基本模板

```javascript
// 1. 定义测试函数
function testFunction(x) {
  return x + 1;
}

// 2. 准备优化
%PrepareFunctionForOptimization(testFunction);

// 3. 预热（收集类型反馈）
for (let i = 0; i < 100; i++) {
  testFunction(i);
}

// 4. 触发 Maglev 编译
%OptimizeMaglevOnNextCall(testFunction);
testFunction(42);

// 5. 验证优化状态
console.log("Optimization status:", %GetOptimizationStatus(testFunction));

// 6. 测试性能
console.time("optimized");
for (let i = 0; i < 1000000; i++) {
  testFunction(i);
}
console.timeEnd("optimized");
```

### 运行

```bash
out/x64.debug/d8 --allow-natives-syntax --trace-maglev your-script.js
```

## 学习路径

1. **从简单开始**：运行 `maglev_trace_example.js`
2. **观察追踪输出**：理解编译过程
3. **查看生成代码**：使用 `--print-maglev-code`
4. **尝试复杂示例**：运行 `maglev_trace_complex_example.js`
5. **编写自己的示例**：测试特定场景
6. **使用交互工具**：`run_maglev_stats.sh` 快速实验

## 相关资源

- **`../test-cases/`** - 更多测试用例和工具
- **`../debugging/`** - 调试工具和技巧文档
- **`../maglev/`** - Maglev 编译器原理
- **`../optimization/`** - 优化机制详解

## 提示

1. **使用 debug 构建**：追踪功能在 debug 构建中更详细
2. **从简单到复杂**：先理解简单示例再处理复杂场景
3. **对比输出**：使用不同标志对比输出
4. **保存输出**：将追踪输出重定向到文件便于分析
   ```bash
   out/x64.debug/d8 --trace-maglev script.js > trace.log 2>&1
   ```

---

**注意**：这些示例是学习工具，用于理解 V8 编译器行为。
