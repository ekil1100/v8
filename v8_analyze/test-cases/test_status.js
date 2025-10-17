// 测试优化状态
function simple(x) {
  return x + 1;
}

// 预热
%PrepareFunctionForOptimization(simple);
simple(1);
simple(2);

console.log("初始状态:", %GetOptimizationStatus(simple));

// Maglev 编译
%OptimizeMaglevOnNextCall(simple);
simple(3);

let status = %GetOptimizationStatus(simple);
console.log("Maglev 后状态:", status);
console.log("二进制:", status.toString(2).padStart(8, '0'));

// 解释各个位
console.log("\n状态解析（根据 V8 源码）:");
console.log("bit 0 (1):   kIsFunction =", (status & 1) ? "YES" : "NO");
console.log("bit 1 (2):   kNeverOptimize =", (status & 2) ? "YES" : "NO");
console.log("bit 2 (4):   kAlwaysOptimize =", (status & 4) ? "YES" : "NO");
console.log("bit 3 (8):   kMaybeDeopted =", (status & 8) ? "YES" : "NO");
console.log("bit 4 (16):  kOptimized =", (status & 16) ? "YES" : "NO");
console.log("bit 5 (32):  kTurboFanned =", (status & 32) ? "YES" : "NO");
console.log("bit 6 (64):  kMaglev =", (status & 64) ? "YES" : "NO");
console.log("bit 7 (128): kMarkedForConcurrentOptimization =", (status & 128) ? "YES" : "NO");

// 触发反优化
console.log("\n触发反优化...");
simple(1.5);  // 传入浮点数
console.log("反优化后状态:", %GetOptimizationStatus(simple));
