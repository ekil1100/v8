// 用例 1: 简单循环
function simpleLoop(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}

// 预热并强制 Maglev 编译
let testData = [1, 2, 3, 4, 5];
for (let i = 0; i < 10; i++) {
  simpleLoop(testData);
}

%PrepareFunctionForOptimization(simpleLoop);
%OptimizeMaglevOnNextCall(simpleLoop);
let result = simpleLoop(testData);

print("Sum: " + result);
