// 创建会被TurboFan优化的热函数
function hotMathFunction(x, y) {
  // 包含各种操作以测试不同的编译阶段
  let sum = x + y;
  let product = x * y;
  let result = sum > 100 ? product : sum;
  return result * 2;
}

function testInlining() {
  function inner(a) {
    return a * a;
  }

  function outer(b) {
    return inner(b) + inner(b + 1);  // 应该被内联
  }

  return outer;
}

// 预热函数以触发TurboFan优化
function warmup(func, ...args) {
  // 准备优化（V8新要求）
  %PrepareFunctionForOptimization(func);

  // 先用Ignition/Sparkplug执行
  for (let i = 0; i < 100; i++) {
    func(...args);
  }

  // 标记为热点，触发TurboFan编译 (需要 --allow-natives-syntax)
  %OptimizeFunctionOnNextCall(func);
  func(...args);  // 这次调用会触发优化编译
}

// 测试不同类型的函数
warmup(hotMathFunction, 10, 20);

let outerFunc = testInlining();
warmup(outerFunc, 5);

console.log("TurboFan verification completed");
console.log("Result:", hotMathFunction(15, 25));
