// 简单版本（无 try-catch）
function processSimple(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i] * 2;
  }
  return sum;
}

// 预热函数
%PrepareFunctionForOptimization(processSimple);

const testArray = new Array(1000).fill(42);
for (let i = 0; i < 100; i++) {
  processSimple(testArray);
}

// 触发优化
%OptimizeFunctionOnNextCall(processSimple);
processSimple(testArray);

console.log("Result:", processSimple(testArray));
