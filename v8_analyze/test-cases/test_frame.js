function add(a, b) {
  let result = a + b;
  return result;
}

// 预热函数
%PrepareFunctionForOptimization(add);
add(1, 2);
add(3, 4);

// 强制使用 Maglev 编译
%OptimizeMaglevOnNextCall(add);
add(5, 6.1);

// 检查优化状态
console.log("Optimization status:", %GetOptimizationStatus(add));
