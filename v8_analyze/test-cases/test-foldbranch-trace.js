// 专门用于观察 FoldBranch 优化的简单示例

// 示例 1: 常量比较 - 应该被折叠
function testConstantBranch() {
  const x = 5;
  const y = 10;

  // 这个分支在编译时就能确定结果：5 < 10 总是 true
  // Maglev 会将其折叠为直接跳转到 true 分支
  if (x < y) {
    return 100;
  } else {
    return 200;
  }
}

// 示例 2: 相同值比较
function testSameValue(a) {
  // a === a 对于整数总是 true
  // 这也会被折叠
  if (a === a) {
    return 42;
  } else {
    return 0;
  }
}

// 示例 3: 可折叠的比较链
function testChainedComparison() {
  const limit = 100;

  // limit > 50 总是 true (100 > 50)
  if (limit > 50) {
    // limit < 200 也总是 true (100 < 200)
    if (limit < 200) {
      return "both true";
    }
  }
  return "unreachable";
}

// 强制优化
%PrepareFunctionForOptimization(testConstantBranch);
%PrepareFunctionForOptimization(testSameValue);
%PrepareFunctionForOptimization(testChainedComparison);

// 预热
for (let i = 0; i < 100; i++) {
  testConstantBranch();
  testSameValue(i);
  testChainedComparison();
}

// 触发 Maglev 编译
%OptimizeMaglevOnNextCall(testConstantBranch);
testConstantBranch();

%OptimizeMaglevOnNextCall(testSameValue);
testSameValue(42);

%OptimizeMaglevOnNextCall(testChainedComparison);
testChainedComparison();

console.log("测试完成");
console.log("testConstantBranch 结果:", testConstantBranch());
console.log("testSameValue 结果:", testSameValue(10));
console.log("testChainedComparison 结果:", testChainedComparison());
