// 更复杂的例子：有条件分支
function calculate(x, y, useAdd) {
  let result;
  if (useAdd) {
    result = x + y;
  } else {
    result = x - y;
  }
  return result * 2;
}

// 预热
%PrepareFunctionForOptimization(calculate);
calculate(10, 5, true);
calculate(20, 8, false);

// 强制 Maglev 编译
%OptimizeMaglevOnNextCall(calculate);
let value = calculate(15, 7, true);

console.log("Result:", value);
console.log("Optimization status:", %GetOptimizationStatus(calculate));
