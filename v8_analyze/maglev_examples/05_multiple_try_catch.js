// 用例 5: 多个 try-catch 块
function multiTryCatch(a, b, c) {
  let result = 0;

  // 第一个 try-catch
  try {
    result += a / b;
  } catch (e1) {
    result = -1;
  }

  // 第二个 try-catch
  try {
    result += parseInt(c);
  } catch (e2) {
    result = -2;
  }

  return result;
}

// 预热并强制 Maglev 编译
for (let i = 0; i < 100; i++) {
  multiTryCatch(10, 2, "123");
}

%PrepareFunctionForOptimization(multiTryCatch);
%OptimizeMaglevOnNextCall(multiTryCatch);
let result = multiTryCatch(10, 2, "123");

print("Result: " + result);
