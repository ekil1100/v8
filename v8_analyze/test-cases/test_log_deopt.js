// 会导致反优化的代码模式

// 示例1: 类型不稳定
function unstableTypes(x) {
  return x + 1;
}

// 准备优化
%PrepareFunctionForOptimization(unstableTypes);

// 先用数字调用，让V8优化为Number+Number
for (let i = 0; i < 10000; i++) {
  unstableTypes(i);
}

// 强制优化
%OptimizeFunctionOnNextCall(unstableTypes);
unstableTypes(100);

// 用字符串调用，触发反优化!
unstableTypes("hello");  // Deopt: wrong type

// 示例2: Hidden class变化
function Point(x, y) {
  this.x = x;
  this.y = y;
}

function processPoint(p) {
  return p.x + p.y;
}

// 准备优化
%PrepareFunctionForOptimization(processPoint);

// 预热
for (let i = 0; i < 10000; i++) {
  processPoint(new Point(i, i));
}

// 优化
%OptimizeFunctionOnNextCall(processPoint);
processPoint(new Point(1, 2));

// 添加新属性，改变hidden class，触发反优化
let p = new Point(1, 2);
p.z = 3;  // 改变map
processPoint(p);  // Deopt: wrong map

console.log("Deopt logging test completed");
