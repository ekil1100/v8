// 用例 2: if-else 条件分支
function classify(num) {
  if (num > 10) {
    return "large";
  } else {
    return "small";
  }
}

// 预热并强制 Maglev 编译
for (let i = 0; i < 10; i++) {
  classify(5);
  classify(15);
}

%PrepareFunctionForOptimization(classify);
%OptimizeMaglevOnNextCall(classify);
let result1 = classify(5);
let result2 = classify(15);

print("Result 1: " + result1);
print("Result 2: " + result2);
