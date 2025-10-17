// 解码 V8 GetOptimizationStatus 返回的状态值
// 基于 src/runtime/runtime.h 中的 OptimizationStatus 枚举

const OptimizationStatus = {
  kIsFunction: 1 << 0,                              // 1
  kNeverOptimize: 1 << 1,                           // 2
  kMaybeDeopted: 1 << 2,                            // 4
  kOptimized: 1 << 3,                               // 8
  kMaglevved: 1 << 4,                               // 16
  kTurboFanned: 1 << 5,                             // 32
  kInterpreted: 1 << 6,                             // 64
  kMarkedForOptimization: 1 << 7,                   // 128
  kMarkedForConcurrentOptimization: 1 << 8,         // 256
  kOptimizingConcurrently: 1 << 9,                  // 512
  kIsExecuting: 1 << 10,                            // 1024
  kTopmostFrameIsTurboFanned: 1 << 11,              // 2048
  kLiteMode: 1 << 12,                               // 4096
  kMarkedForDeoptimization: 1 << 13,                // 8192
  kBaseline: 1 << 14,                               // 16384
  kTopmostFrameIsInterpreted: 1 << 15,              // 32768
  kTopmostFrameIsBaseline: 1 << 16,                 // 65536
  kIsLazy: 1 << 17,                                 // 131072
  kTopmostFrameIsMaglev: 1 << 18,                   // 262144
  kOptimizeOnNextCallOptimizesToMaglev: 1 << 19,    // 524288
  kOptimizeMaglevOptimizesToTurbofan: 1 << 20,      // 1048576
  kMarkedForMaglevOptimization: 1 << 21,            // 2097152
  kMarkedForConcurrentMaglevOptimization: 1 << 22,  // 4194304
};

function decodeStatus(status) {
  console.log(`\n解码状态值: ${status} (0b${status.toString(2)})\n`);
  console.log("激活的标志:");

  const activeFlags = [];

  for (const [name, value] of Object.entries(OptimizationStatus)) {
    if (status & value) {
      activeFlags.push({ name, value });
      console.log(`  ✓ ${name.padEnd(40)} (${value})`);
    }
  }

  if (activeFlags.length === 0) {
    console.log("  (无)");
  }

  // 提供人类可读的解释
  console.log("\n含义:");
  if (status & OptimizationStatus.kIsFunction) {
    console.log("  - 这是一个函数对象");
  }
  if (status & OptimizationStatus.kOptimized) {
    console.log("  - 函数已被优化编译");
  }
  if (status & OptimizationStatus.kMaglevved) {
    console.log("  - 使用 Maglev 编译器优化");
  }
  if (status & OptimizationStatus.kTurboFanned) {
    console.log("  - 使用 TurboFan 编译器优化");
  }
  if (status & OptimizationStatus.kBaseline) {
    console.log("  - 有 Baseline (Sparkplug) 代码");
  }
  if (status & OptimizationStatus.kInterpreted) {
    console.log("  - 正在使用解释器");
  }
  if (status & OptimizationStatus.kMarkedForOptimization) {
    console.log("  - 已标记为待优化");
  }
  if (status & OptimizationStatus.kMarkedForMaglevOptimization) {
    console.log("  - 已标记为待 Maglev 优化");
  }
  if (status & OptimizationStatus.kOptimizingConcurrently) {
    console.log("  - 正在并发优化中");
  }
  if (status & OptimizationStatus.kNeverOptimize) {
    console.log("  - 永不优化");
  }
  if (status & OptimizationStatus.kMarkedForDeoptimization) {
    console.log("  - 已标记为待去优化");
  }

  console.log("");
}

// 示例：解码状态 25
console.log("=== V8 优化状态解码器 ===");
decodeStatus(25);

// 其他常见状态示例
console.log("\n=== 其他常见状态 ===");

console.log("\n[状态 1] - 未优化的函数:");
decodeStatus(1);

console.log("\n[状态 65] - 解释执行的函数:");
decodeStatus(65);  // kIsFunction | kInterpreted

console.log("\n[状态 41] - TurboFan 优化:");
decodeStatus(41);  // kIsFunction | kOptimized | kTurboFanned

console.log("\n[状态 16409] - Baseline 编译:");
decodeStatus(16385);  // kIsFunction | kBaseline
