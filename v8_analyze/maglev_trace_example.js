// Maglev 编译跟踪示例
// 用于演示 --trace-maglev-graph-building, --print-maglev-graph, --print-maglev-graphs 输出

// 简单的数学运算函数
function add(x, y) {
  return x + y;
}

function calculate(a, b) {
  let sum = add(a, b);
  let product = a * b;
  let result = sum + product;
  return result;
}

// 预热函数，使其成为优化候选
for (let i = 0; i < 10; i++) {
  calculate(i, i + 1);
}

// 使用 natives syntax 强制优化为 Maglev
%PrepareFunctionForOptimization(calculate);
%OptimizeMaglevOnNextCall(calculate);
let finalResult = calculate(5, 10);

print("Final result: " + finalResult);
