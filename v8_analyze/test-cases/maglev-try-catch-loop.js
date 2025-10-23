function processWithErrorHandling(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    try {
      sum += arr[i] * 2;
    } catch (e) {
      sum += 0;
    }
  }
  return sum;
}

// 预热函数
%PrepareFunctionForOptimization(processWithErrorHandling);

const testArray = new Array(1000).fill(42);
for (let i = 0; i < 100; i++) {
  processWithErrorHandling(testArray);
}

// 触发 Maglev 优化
%OptimizeMaglevOnNextCall(processWithErrorHandling);
processWithErrorHandling(testArray);

console.log("Optimized result:", processWithErrorHandling(testArray));
