// 用例 4: try-catch（抛出异常）
function parseNumber(str) {
  try {
    if (typeof str !== 'string') {
      throw new Error("Not a string");
    }
    return parseInt(str);
  } catch (e) {
    return -1;
  }
}

// 预热并强制 Maglev 编译
for (let i = 0; i < 10; i++) {
  parseNumber("123");
  parseNumber(456);  // 这会触发异常
}

%PrepareFunctionForOptimization(parseNumber);
%OptimizeMaglevOnNextCall(parseNumber);
let result1 = parseNumber("123");
let result2 = parseNumber(456);

print("Result 1: " + result1);
print("Result 2: " + result2);
