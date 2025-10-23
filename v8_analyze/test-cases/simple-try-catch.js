// Simple test to trace exception handler creation
function testTryCatch(x) {
  try {
    if (x < 0) throw new Error("Negative");
    return x * 2;
  } catch (e) {
    return -1;
  }
}

%PrepareFunctionForOptimization(testTryCatch);
for (let i = 0; i < 100; i++) {
  testTryCatch(i);
}
%OptimizeMaglevOnNextCall(testTryCatch);
console.log(testTryCatch(42));
