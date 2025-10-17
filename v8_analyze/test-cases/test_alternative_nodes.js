// 演示 AlternativeNodes 的优化效果

function compute(x) {
  let a = x | 0;      // 转换为整数
  let b = a + 10;     // 使用 a 的 int32 表示
  let c = a + 20;     // 再次使用 a 的 int32 表示（避免重复转换！）
  let d = b + c;
  return d;
}

// 预热
%PrepareFunctionForOptimization(compute);
compute(5);
compute(10);

// 强制 Maglev 编译
%OptimizeMaglevOnNextCall(compute);
let result = compute(15);

console.log("Result:", result);
console.log("Optimization status:", %GetOptimizationStatus(compute));

console.log("\n===== 关键点 =====");
console.log("没有 AlternativeNodes 缓存：");
console.log("  a + 10: CheckedSmiUntag(a) + 10");
console.log("  a + 20: CheckedSmiUntag(a) + 20  ← 重复转换！");
console.log("");
console.log("有 AlternativeNodes 缓存：");
console.log("  a + 10: int32_a + 10");
console.log("  a + 20: int32_a + 20  ← 直接复用！");
