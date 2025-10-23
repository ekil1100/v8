# Maglev 统计 - 快速开始

3步快速查看Maglev编译统计！

---

## 🚀 方法一：使用交互式脚本（推荐）

```bash
cd /home/like/google/v8/v8
./v8_analyze/test-cases/run_maglev_stats.sh
```

**优势:**
- ✅ 图形化菜单，无需记命令
- ✅ 自动保存输出到 `output/` 目录
- ✅ 包含11种预设场景
- ✅ 彩色输出，易于阅读

---

## 📊 方法二：直接运行命令

### 最常用的3个命令

```bash
cd /home/like/google/v8/v8

# 1️⃣ 快速查看每个函数编译时间（最常用）
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js

# 2️⃣ 详细的阶段分解
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js

# 3️⃣ 完整追踪（包含优化决策）
out/x64.release/d8 --trace-opt --trace-opt-stats --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js
```

---

## 📈 预期输出

### trace-opt-stats 输出示例

```
[maglev] Compiled: 1 functions with 45 byte source size in 2.3ms.
[maglev] Compiled: 2 functions with 123 byte source size in 5.8ms.
[maglev] Compiled: 3 functions with 234 byte source size in 9.5ms.
[maglev] Compiled: 4 functions with 389 byte source size in 15.2ms.
...
[maglev] Compiled: 8 functions with 1234 byte source size in 45.6ms.
```

**解读:**
- 数字是累计值
- 每行对应一个函数的编译
- 可以看到总共编译了8个函数，耗时45.6ms

### maglev-stats 输出示例

```
=== Maglev Compilation Statistics for 'fibonacci' ===
Phase Kind: V8.MaglevPrepareJob
  Time: 0.4ms
  Allocated: 512 bytes

Phase Kind: V8.MaglevExecuteJob      ← 最耗时阶段
  Time: 8.5ms
  Allocated: 16384 bytes
  Input graph: 85 nodes
  Output graph: 72 nodes              ← 优化减少了13个节点

Phase Kind: V8.MaglevFinalizeJob
  Time: 1.3ms
  Allocated: 2048 bytes

Total: 10.2ms
```

**关键指标:**
- **Total**: 总编译时间
- **Execute时间**: 通常占80-90%
- **图优化**: Input → Output 节点减少

---

## 🎯 测试用例说明

`maglev-stats-demo.js` 包含8个不同类型的函数：

| 函数 | 特点 | 预期编译时间 |
|------|------|------------|
| `simpleAdd` | 简单运算 | ~2-3ms |
| `sumArray` | 数组循环 | ~3-6ms |
| `fibonacci` | 复杂循环 | ~5-10ms |
| `complexCalculation` | 多种操作 | ~8-15ms |
| `processObject` | 对象访问 | ~4-8ms |
| `multiplyArrayElements` | 数组处理 | ~5-10ms |
| `processString` | 字符串操作 | ~4-8ms |
| `mainFunction` | 函数调用链 | ~2-5ms |

所有函数都会被调用10,000次以触发Maglev编译。

---

## 💡 实用技巧

### 只看编译摘要

```bash
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "maglev"
```

### 只看总编译时间

```bash
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "Total:"
```

### 保存输出到文件

```bash
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | tee maglev_output.log
```

### 导出JSON数据

```bash
out/x64.release/d8 --maglev-stats-nvp v8_analyze/test-cases/maglev-stats-demo.js > stats.json
```

---

## 🔍 进阶探索

### 对比Maglev vs TurboFan

```bash
# Maglev (快)
out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js

# TurboFan (慢但更优化)
out/x64.release/d8 --no-maglev --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js
```

### 追踪内联决策

```bash
out/x64.debug/d8 --trace-maglev-inlining v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "inline"
```

### 查看生成的代码

```bash
out/x64.debug/d8 --print-maglev-code v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | less
```

---

## 📚 详细文档

- **完整使用指南**: `MAGLEV_STATS_USAGE.md`
- **Maglev编译时间详解**: `../maglev_compilation_timing.md`
- **V8调试能力总览**: `../debug_and_profiling_capabilities.md`

---

## ⚡ 一行命令快速测试

```bash
# 最快速的测试方法（一行搞定）
cd /home/like/google/v8/v8 && out/x64.release/d8 --trace-opt-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep "maglev"
```

---

## 🐛 常见问题

### Q: 看不到输出？

A: 确保：
1. 使用 `out/x64.release/d8` (不是 `out/x64.debug/d8`)
2. V8已经构建完成

### Q: 输出太多？

A: 使用 `grep` 过滤：
```bash
out/x64.release/d8 --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js 2>&1 | grep -E "(maglev|Total:)"
```

### Q: 想要更详细的信息？

A: 使用 `--trace-opt-verbose`:
```bash
out/x64.release/d8 --trace-opt-verbose --maglev-stats v8_analyze/test-cases/maglev-stats-demo.js
```

---

**享受探索V8 Maglev编译器的乐趣！** 🎉
