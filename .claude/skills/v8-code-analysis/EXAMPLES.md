# V8 Code Analysis Examples

Complete test cases and benchmarks for analyzing V8 compiler optimizations.

## FoldBranch Optimization - Complete Example

### JavaScript Test Case

```javascript
// test-foldbranch.js
function constantCompare() {
  const x = 5;
  const y = 10;

  // 5 < 10 determinable at compile time
  if (x < y) {
    return "always true";  // Folded to here
  } else {
    return "dead code";    // Eliminated
  }
}

// Warmup
%PrepareFunctionForOptimization(constantCompare);
constantCompare();
constantCompare();

// Force Maglev compilation
%OptimizeMaglevOnNextCall(constantCompare);
let result = constantCompare();
console.log(result);

// Verify optimization
%OptimizationStatus(constantCompare);
```

### Running with Traces

```bash
# View Maglev graph building
out/x64.debug/d8 --allow-natives-syntax \
  --trace-maglev-graph-building \
  test-foldbranch.js

# Expected output includes:
# - Branch node creation
# - TryFoldInt32CompareOperation returning true
# - FoldBranch converting Branch → Jump
# - Unreachable block marked
```

### IR Before Optimization

```
BasicBlock #1:
  n1: SmiConstant(5)
  n2: SmiConstant(10)
  n3: CheckedSmiUntag(n1)
  n4: CheckedSmiUntag(n2)
  n5: Int32LessThan(n3, n4)
  Branch(n5)
    IfTrue → BasicBlock #2
    IfFalse → BasicBlock #3

BasicBlock #2:
  n6: RootConstant("always true")
  Return(n6)

BasicBlock #3:
  n7: RootConstant("dead code")
  Return(n7)
```

### IR After FoldBranch

```
BasicBlock #1:
  n1: SmiConstant(5)
  n2: SmiConstant(10)
  n3: CheckedSmiUntag(n1)
  n4: CheckedSmiUntag(n2)
  n5: Int32LessThan(n3, n4)  // Still computed but not used for branch
  Jump → BasicBlock #2       // Direct jump!

BasicBlock #2:
  n6: RootConstant("always true")
  Return(n6)

// BasicBlock #3 marked unreachable, removed by DCE
```

## CSE (Common Subexpression Elimination) Example

### JavaScript Test Case

```javascript
// test-cse.js
function repeatedComparison(x, y) {
  if (x < y) {
    console.log(x < y);  // Duplicate comparison
    return x < y;        // Third duplicate
  }
  return false;
}

%PrepareFunctionForOptimization(repeatedComparison);
repeatedComparison(1, 2);
repeatedComparison(3, 4);

%OptimizeMaglevOnNextCall(repeatedComparison);
repeatedComparison(5, 6);
```

### IR Without CSE (Hypothetical)

```
n1: Int32LessThan(x, y)  // First comparison
Branch(n1)
  IfTrue:
    n2: Int32LessThan(x, y)  // Duplicate!
    Call(console.log, n2)
    n3: Int32LessThan(x, y)  // Triple duplicate!
    Return(n3)
```

### IR With CSE

```
n1: Int32LessThan(x, y)  // Computed once
Branch(n1)
  IfTrue:
    Call(console.log, n1)  // Reuse n1
    Return(n1)             // Reuse n1 again
```

**Performance:** Eliminates 2 comparison operations per call in true branch.

## Loop Peeling Example

### JavaScript Test Case

```javascript
// test-loop-peeling.js
function sumArray(arr) {
  let sum = 0;
  for (let i = 0; i < arr.length; i++) {
    sum += arr[i];  // First iteration: i known to be 0
  }
  return sum;
}

const testArray = [1, 2, 3, 4, 5];

%PrepareFunctionForOptimization(sumArray);
sumArray(testArray);
sumArray(testArray);

%OptimizeMaglevOnNextCall(sumArray);
console.log(sumArray(testArray));
```

### IR Before Peeling

```
LoopHeader:
  i_phi = Phi(0, i_next)     // i could be any iteration
  sum_phi = Phi(0, sum_next)

LoopBody:
  check: i_phi < arr.length  // Runtime check
  elem = arr[i_phi]          // Bounds check needed
  sum_next = sum_phi + elem
  i_next = i_phi + 1
  JumpLoop → LoopHeader
```

### IR After Peeling

```
// Peeled first iteration (i = 0)
elem0 = arr[0]      // Constant index, can optimize bounds check
sum1 = 0 + elem0
i1 = 1

LoopHeader:
  i_phi = Phi(i1, i_next)     // i starts at 1, not 0
  sum_phi = Phi(sum1, sum_next)

LoopBody:
  check: i_phi < arr.length
  elem = arr[i_phi]
  sum_next = sum_phi + elem
  i_next = i_phi + 1
  JumpLoop → LoopHeader
```

**Benefits:**
- First iteration fully optimizable (constant folding)
- Loop Phi nodes have better type information
- Reduced type checks in loop body

## Deoptimization Example

### JavaScript Test Case

```javascript
// test-deopt.js
function addNumbers(x, y) {
  return x + y;
}

// Warm up with Smis
%PrepareFunctionForOptimization(addNumbers);
addNumbers(1, 2);
addNumbers(3, 4);

// Trigger Maglev compilation
%OptimizeMaglevOnNextCall(addNumbers);
console.log(addNumbers(5, 6));  // Optimized path

// Trigger deopt with non-Smi
console.log(addNumbers(1, 3.14));  // Deopt!
```

### Generated Machine Code (x64)

```asm
; Optimized code for addNumbers
addNumbers:
  push rbp
  mov rbp, rsp

  ; Load parameters
  mov rax, [rbp+16]  ; x
  mov rcx, [rbp+8]   ; y

  ; CheckedSmiUntag(x)
  test rax, 1
  jz deopt_eager     ; Not Smi → deopt
  sar rax, 1

  ; CheckedSmiUntag(y)
  test rcx, 1
  jz deopt_eager     ; Not Smi → deopt
  sar rcx, 1

  ; Int32Add with overflow check
  add rax, rcx
  jo deopt_eager     ; Overflow → deopt

  ; Int32ToNumber (tag as Smi)
  lea rax, [rax*2]

  mov rsp, rbp
  pop rbp
  ret

deopt_eager:
  ; Save register state
  ; Load DeoptInfo
  ; Call Deoptimizer
  call Builtin::kDeoptimize
```

### Deopt Trace Output

```bash
out/x64.debug/d8 --allow-natives-syntax --trace-deopt test-deopt.js

# Expected output:
# [deoptimizing (DEOPT eager): begin ...]
# [deoptimizing from addNumbers, offset 15]
# [deopt frame translation: height=2]
#   0x... <- x (HeapNumber: 1)
#   0x... <- y (HeapNumber: 3.14)
# [deoptimizing (eager): end ...]
```

## Performance Benchmarks

### CSE Impact Measurement

```javascript
// benchmark-cse.js
function withCSE(x, y, iterations) {
  let count = 0;
  for (let i = 0; i < iterations; i++) {
    if (x < y) {
      count++;
    }
  }
  return count;
}

function withoutCSE(x, y, iterations) {
  let count = 0;
  for (let i = 0; i < iterations; i++) {
    // Force fresh comparison each time (disable CSE)
    const temp = x;
    if (temp < y) {
      count++;
    }
  }
  return count;
}

const ITERATIONS = 10000000;

// Warm up
%PrepareFunctionForOptimization(withCSE);
%PrepareFunctionForOptimization(withoutCSE);
withCSE(1, 2, 1000);
withoutCSE(1, 2, 1000);

// Optimize
%OptimizeMaglevOnNextCall(withCSE);
%OptimizeMaglevOnNextCall(withoutCSE);

// Benchmark
console.time('with CSE');
withCSE(1, 2, ITERATIONS);
console.timeEnd('with CSE');

console.time('without CSE');
withoutCSE(1, 2, ITERATIONS);
console.timeEnd('without CSE');
```

### Expected Results

```
with CSE: ~50ms
without CSE: ~65ms
CSE improvement: ~23%
```

## Testing Checklist

When creating test cases:

```
□ Create minimal reproducible example
□ Add %PrepareFunctionForOptimization
□ Warm up with representative inputs
□ Use %OptimizeMaglevOnNextCall to force compilation
□ Test optimized path with expected inputs
□ Test deopt path with unexpected inputs
□ Verify with --trace-maglev-graph-building
□ Verify with --trace-opt and --trace-deopt
□ Measure performance impact (if claiming optimization)
□ Document expected vs actual behavior
```

## Useful d8 Flags Reference

```bash
# Compilation control
--allow-natives-syntax          # Enable % intrinsics
--maglev                        # Force Maglev compilation
--no-turbofan                   # Disable TurboFan (Maglev only)

# Tracing
--trace-maglev-graph-building   # IR construction
--trace-maglev-regalloc         # Register allocation
--trace-opt                     # Optimization decisions
--trace-deopt                   # Deoptimization events
--print-bytecode                # Bytecode output
--print-code                    # Machine code output

# Debugging
--code-comments                 # Add comments to generated code
--print-opt-code                # Print optimized code
--trace-gc                      # Garbage collection events
```
