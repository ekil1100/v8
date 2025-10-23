// Maglev编译时间统计演示用例
// 本文件展示如何触发Maglev编译并观察编译统计信息

// ============================================================
// 1. 简单的数学计算函数（快速编译）
// ============================================================
function simpleAdd(a, b) {
  return a + b;
}

// ============================================================
// 2. 包含循环的热函数（中等复杂度）
// ============================================================
function sumArray(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];
  }
  return sum;
}

// ============================================================
// 3. 更复杂的计算函数（较长编译时间）
// ============================================================
function fibonacci(n) {
  if (n <= 1) return n;
  let a = 0, b = 1;
  for (let i = 2; i <= n; i++) {
    let temp = a + b;
    a = b;
    b = temp;
  }
  return b;
}

// ============================================================
// 4. 包含多种操作的函数
// ============================================================
function complexCalculation(x, y) {
  let result = 0;

  // 数学运算
  result += Math.sqrt(x * x + y * y);

  // 条件判断
  if (x > y) {
    result *= 2;
  } else {
    result /= 2;
  }

  // 循环累加
  for (let i = 0; i < 10; i++) {
    result += i * 0.1;
  }

  return result;
}

// ============================================================
// 5. 对象操作函数
// ============================================================
function processObject(obj) {
  let sum = 0;
  sum += obj.x * 2;
  sum += obj.y * 3;
  sum += obj.z || 0;
  return sum;
}

// ============================================================
// 6. 数组处理函数（适合内联）
// ============================================================
function multiplyArrayElements(arr, factor) {
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    result.push(arr[i] * factor);
  }
  return result;
}

// ============================================================
// 7. 字符串处理函数
// ============================================================
function processString(str) {
  let result = str.toLowerCase();
  result = result.split('').reverse().join('');
  return result.length;
}

// ============================================================
// 8. 包含调用链的函数（测试内联）
// ============================================================
function helper1(n) {
  return n * 2;
}

function helper2(n) {
  return helper1(n) + 10;
}

function mainFunction(n) {
  return helper2(n) * 3;
}

// ============================================================
// 预热函数 - 触发Maglev编译
// ============================================================

console.log("=== 开始预热函数，触发Maglev编译 ===\n");

// 预热 simpleAdd (简单函数，应该快速编译)
console.log("1. 预热 simpleAdd...");
for (let i = 0; i < 10000; i++) {
  simpleAdd(i, i + 1);
}

// 预热 sumArray (中等复杂度)
console.log("2. 预热 sumArray...");
const testArray = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
for (let i = 0; i < 10000; i++) {
  sumArray(testArray);
}

// 预热 fibonacci (较复杂的循环)
console.log("3. 预热 fibonacci...");
for (let i = 0; i < 10000; i++) {
  fibonacci(20);
}

// 预热 complexCalculation (多种操作)
console.log("4. 预热 complexCalculation...");
for (let i = 0; i < 10000; i++) {
  complexCalculation(i, i + 1);
}

// 预热 processObject (对象操作)
console.log("5. 预热 processObject...");
const testObj = { x: 10, y: 20, z: 30 };
for (let i = 0; i < 10000; i++) {
  processObject(testObj);
}

// 预热 multiplyArrayElements (数组处理)
console.log("6. 预热 multiplyArrayElements...");
for (let i = 0; i < 10000; i++) {
  multiplyArrayElements(testArray, 2);
}

// 预热 processString (字符串操作)
console.log("7. 预热 processString...");
for (let i = 0; i < 10000; i++) {
  processString("Hello World");
}

// 预热 mainFunction (测试内联)
console.log("8. 预热 mainFunction...");
for (let i = 0; i < 10000; i++) {
  mainFunction(i);
}

console.log("\n=== 预热完成 ===");
console.log("所有函数都应该已经被Maglev编译");
console.log("\n运行统计信息请查看上方输出");

// ============================================================
// 验证函数仍然正常工作
// ============================================================
console.log("\n=== 验证结果 ===");
console.log("simpleAdd(5, 3) =", simpleAdd(5, 3));
console.log("sumArray([1,2,3,4,5]) =", sumArray([1, 2, 3, 4, 5]));
console.log("fibonacci(10) =", fibonacci(10));
console.log("complexCalculation(10, 5) =", complexCalculation(10, 5));
console.log("processObject({x:1, y:2, z:3}) =", processObject({x: 1, y: 2, z: 3}));
console.log("multiplyArrayElements([1,2,3], 5) =", multiplyArrayElements([1, 2, 3], 5));
console.log("processString('Test') =", processString('Test'));
console.log("mainFunction(5) =", mainFunction(5));

// ============================================================
// 性能测试 - 观察编译后的性能提升
// ============================================================
console.log("\n=== 性能测试 ===");

function benchmark(name, fn, iterations) {
  const start = Date.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = Date.now();
  console.log(`${name}: ${end - start}ms (${iterations} iterations)`);
}

benchmark("Optimized fibonacci", () => fibonacci(30), 100000);
benchmark("Optimized sumArray", () => sumArray(testArray), 100000);
benchmark("Optimized complexCalculation", () => complexCalculation(10, 20), 100000);

console.log("\n=== 完成 ===");
