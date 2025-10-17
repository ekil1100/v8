// FoldBranch 优化示例
// 当 Maglev 编译器检测到分支条件在编译时可以确定时，
// 会将分支折叠成直接跳转

// 示例 1: 常量比较 - 最简单的情况
function constantCompare() {
  const x = 5;
  const y = 10;

  // 这个分支条件在编译时就能确定（5 < 10 总是 true）
  if (x < y) {
    return "always true";
  } else {
    return "never reached";
  }
}

// 示例 2: 通过常量传播实现的分支折叠
function withConstantPropagation(flag) {
  let x = 42;

  // Maglev 可以通过常量传播得知 x 的值
  if (x === 42) {
    return "folded to true";
  } else {
    return "dead code";
  }
}

// 示例 3: 循环中的分支折叠
function loopBranchFold(arr) {
  let sum = 0;
  const threshold = 100;  // 常量

  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];

    // 这个比较涉及常量，有机会被优化
    if (threshold > 50) {  // 100 > 50 总是 true
      sum *= 2;
    }
  }
  return sum;
}

// 示例 4: 相同值的比较
function sameValueCompare(x) {
  // x === x 总是 true（除了 NaN，但这是 int32 比较）
  if (x === x) {
    return "same value";
  } else {
    return "unreachable";
  }
}

// 预热和触发 Maglev 编译
function warmup() {
  // 运行足够次数让 V8 使用 Maglev 编译
  for (let i = 0; i < 10000; i++) {
    constantCompare();
    withConstantPropagation(true);
    loopBranchFold([1, 2, 3, 4, 5]);
    sameValueCompare(42);
  }
}

// 运行测试
console.log("=== FoldBranch 优化示例 ===\n");

console.log("示例 1 - 常量比较:");
console.log("结果:", constantCompare());

console.log("\n示例 2 - 常量传播:");
console.log("结果:", withConstantPropagation());

console.log("\n示例 3 - 循环中的分支折叠:");
console.log("结果:", loopBranchFold([1, 2, 3, 4, 5]));

console.log("\n示例 4 - 相同值比较:");
console.log("结果:", sameValueCompare(42));

console.log("\n开始预热...");
warmup();
console.log("预热完成！");

// 使用 V8 的 native syntax 来查看优化状态
console.log("\n优化状态:");
console.log("constantCompare:", %GetOptimizationStatus(constantCompare));
console.log("withConstantPropagation:", %GetOptimizationStatus(withConstantPropagation));
