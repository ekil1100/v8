// 用例 3: try-catch（不抛出异常）
function safeDivide(a, b) {
  try {
    return a / b;
  } catch (e) {
    return 0;
  }
}

// 预热并强制 Maglev 编译
for (let i = 0; i < 100; i++) {
  safeDivide(10, 2);
}

%PrepareFunctionForOptimization(safeDivide);
%OptimizeMaglevOnNextCall(safeDivide);
let result = safeDivide(10, 2);

print("Result: " + result);
