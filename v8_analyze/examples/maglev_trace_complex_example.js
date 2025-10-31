// 复杂的 Maglev 编译跟踪示例
// 包含 try-catch、for 循环、if-else 分支

function processData(arr, threshold) {
  let sum = 0;
  let count = 0;

  try {
    for (let i = 0; i < arr.length; i++) {
      if (arr[i] > threshold) {
        sum += arr[i];
        count++;
      }
    }

    if (count === 0) {
      return 0;
    }

    return sum / count;
  } catch (e) {
    console.log("Error occurred");
    return -1;
  }
}

// 预热函数
let testData = [1, 5, 10, 15, 20, 25];
for (let i = 0; i < 10; i++) {
  processData(testData, 10);
}

// 强制 Maglev 编译
%PrepareFunctionForOptimization(processData);
%OptimizeMaglevOnNextCall(processData);
let result = processData(testData, 10);

print("Average: " + result);
