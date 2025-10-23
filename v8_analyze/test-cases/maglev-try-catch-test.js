// V8 Maglev Try-Catch Test Cases
// Run with: out/x64.debug/d8 --allow-natives-syntax --trace-maglev-graph-building this-file.js

// ============================================================================
// Test 1: Basic Try-Catch (Handler Never Used)
// Expected: Lazy deopt optimization should apply
// ============================================================================
function basicTryCatch(x) {
  try {
    return x * 2;  // Never throws
  } catch (e) {
    return -1;
  }
}

// Warm up to trigger Maglev compilation
%PrepareFunctionForOptimization(basicTryCatch);
for (let i = 0; i < 100; i++) {
  basicTryCatch(i);
}
%OptimizeMaglevOnNextCall(basicTryCatch);
let result1 = basicTryCatch(42);
console.log("Test 1 - Basic Try-Catch:", result1);  // Should be 84

// ============================================================================
// Test 2: Try-Catch with Exception Thrown
// Expected: Handler is used, full trampoline should be generated
// ============================================================================
function tryCatchWithThrow(x) {
  try {
    if (x < 0) throw new Error("Negative!");
    return x * 2;
  } catch (e) {
    return -1;
  }
}

// Warm up WITH exceptions to mark handler as used
%PrepareFunctionForOptimization(tryCatchWithThrow);
for (let i = 0; i < 50; i++) {
  tryCatchWithThrow(i);
}
for (let i = 0; i < 50; i++) {
  tryCatchWithThrow(-i);  // Trigger exceptions
}
%OptimizeMaglevOnNextCall(tryCatchWithThrow);
let result2a = tryCatchWithThrow(42);
let result2b = tryCatchWithThrow(-5);
console.log("Test 2 - With Throw (positive):", result2a);  // Should be 84
console.log("Test 2 - With Throw (negative):", result2b);  // Should be -1

// ============================================================================
// Test 3: Nested Try-Catch
// Expected: catch_block_stack_ maintains multiple active handlers
// ============================================================================
function nestedTryCatch(x) {
  try {
    try {
      if (x < 0) throw new Error("Inner error");
      return x * 2;
    } catch (inner) {
      if (x < -10) throw new Error("Re-throw to outer");
      return x * 3;  // Handle in inner catch
    }
  } catch (outer) {
    return -999;
  }
}

%PrepareFunctionForOptimization(nestedTryCatch);
for (let i = 0; i < 100; i++) {
  nestedTryCatch(i);
  if (i % 3 === 0) nestedTryCatch(-i);
  if (i % 10 === 0) nestedTryCatch(-i - 10);
}
%OptimizeMaglevOnNextCall(nestedTryCatch);
let result3a = nestedTryCatch(10);    // Normal path
let result3b = nestedTryCatch(-5);    // Inner catch
let result3c = nestedTryCatch(-15);   // Outer catch
console.log("Test 3 - Nested (normal):", result3a);      // Should be 20
console.log("Test 3 - Nested (inner catch):", result3b); // Should be -15
console.log("Test 3 - Nested (outer catch):", result3c); // Should be -999

// ============================================================================
// Test 4: Try-Catch with Live Values (Exception Phi Test)
// Expected: Values must be correctly restored via exception phi nodes
// ============================================================================
function tryCatchWithLiveValues(x, y) {
  let temp1 = x * 2;
  let temp2 = y * 3;
  try {
    let temp3 = temp1 + temp2;
    if (temp3 > 100) throw new Error("Too big");
    return temp3;
  } catch (e) {
    // temp1 and temp2 should be accessible here via exception phis
    return temp1 + temp2 + 1000;
  }
}

%PrepareFunctionForOptimization(tryCatchWithLiveValues);
for (let i = 0; i < 100; i++) {
  tryCatchWithLiveValues(i, i);
}
%OptimizeMaglevOnNextCall(tryCatchWithLiveValues);
let result4a = tryCatchWithLiveValues(5, 5);   // Normal: 5*2 + 5*3 = 25
let result4b = tryCatchWithLiveValues(20, 20); // Catch: 20*2 + 20*3 + 1000 = 1100
console.log("Test 4 - Live Values (normal):", result4a);  // Should be 25
console.log("Test 4 - Live Values (catch):", result4b);   // Should be 1100

// ============================================================================
// Test 5: Try-Catch with Context Access
// Expected: Context register properly saved and restored
// ============================================================================
function tryCatchWithClosure(x) {
  let captured = x * 10;

  function inner() {
    try {
      if (x < 0) throw new Error("Negative");
      return captured + x;
    } catch (e) {
      // Must access outer scope (context) correctly
      return captured - x;
    }
  }

  return inner();
}

%PrepareFunctionForOptimization(tryCatchWithClosure);
for (let i = 0; i < 100; i++) {
  tryCatchWithClosure(i);
  if (i % 5 === 0) tryCatchWithClosure(-i);
}
%OptimizeMaglevOnNextCall(tryCatchWithClosure);
let result5a = tryCatchWithClosure(5);   // Normal: 50 + 5 = 55
let result5b = tryCatchWithClosure(-5);  // Catch: -50 - (-5) = -45
console.log("Test 5 - Context (normal):", result5a);  // Should be 55
console.log("Test 5 - Context (catch):", result5b);   // Should be -45

// ============================================================================
// Test 6: Try-Catch with Object Allocation (Escape Analysis Test)
// Expected: Object may need to be materialized before exception
// ============================================================================
function tryCatchWithObject(x) {
  try {
    let obj = { a: x, b: x * 2 };
    if (x < 0) throw new Error("Negative");
    return obj.a + obj.b;
  } catch (e) {
    return -1;
  }
}

%PrepareFunctionForOptimization(tryCatchWithObject);
for (let i = 0; i < 100; i++) {
  tryCatchWithObject(i);
  if (i % 10 === 0) tryCatchWithObject(-i);
}
%OptimizeMaglevOnNextCall(tryCatchWithObject);
let result6a = tryCatchWithObject(10);  // Normal: 10 + 20 = 30
let result6b = tryCatchWithObject(-5);  // Catch: -1
console.log("Test 6 - Object Allocation (normal):", result6a);  // Should be 30
console.log("Test 6 - Object Allocation (catch):", result6b);   // Should be -1

// ============================================================================
// Test 7: Multiple Exception Paths (Testing Trampoline Generation)
// Expected: Each throw site should have its own handler entry
// ============================================================================
function multipleThrowSites(x) {
  try {
    if (x === 1) throw new Error("First");
    if (x === 2) throw new Error("Second");
    if (x === 3) throw new Error("Third");
    return x * 10;
  } catch (e) {
    return -x;
  }
}

%PrepareFunctionForOptimization(multipleThrowSites);
for (let i = 0; i < 100; i++) {
  multipleThrowSites(i % 5);
}
%OptimizeMaglevOnNextCall(multipleThrowSites);
let result7a = multipleThrowSites(0);  // Normal: 0
let result7b = multipleThrowSites(1);  // Catch: -1
let result7c = multipleThrowSites(2);  // Catch: -2
let result7d = multipleThrowSites(3);  // Catch: -3
console.log("Test 7 - Multiple Throws:", [result7a, result7b, result7c, result7d]);

console.log("\n=== All Tests Complete ===");
