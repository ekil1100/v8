// 创建各种类型的对象来触发不同的堆验证路径
function createObjects() {
  // 普通对象
  let obj = { x: 1, y: 2 };

  // 数组
  let arr = [1, 2, 3, 4, 5];

  // 函数
  function add(a, b) { return a + b; }

  // 闭包
  function makeClosure() {
    let counter = 0;
    return () => ++counter;
  }
  let closure = makeClosure();

  // Map 和 Set
  let map = new Map([[1, 'one'], [2, 'two']]);
  let set = new Set([1, 2, 3]);

  return { obj, arr, add, closure, map, set };
}

// 触发多次GC以进行堆验证
for (let i = 0; i < 10; i++) {
  createObjects();

  // 强制GC (需要 --expose-gc)
  if (globalThis.gc) {
    gc();
  }
}

console.log("Heap verification test completed");
