# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

V8 is Google's open-source JavaScript and WebAssembly engine written in C++. It implements ECMAScript and WebAssembly specifications and is used in Chrome and Node.js. The codebase is large and complex, with multiple compilation tiers, a sophisticated garbage collector, and extensive platform abstractions.

Documentation: https://v8.dev/docs

## Build System

V8 uses GN (Generate Ninja) for build configuration and Ninja for actual compilation. The `gm.py` wrapper simplifies common workflows.

### Building

```bash
# Build for x64 in different modes
tools/dev/gm.py quiet x64.debug       # Debug build (full assertions, slower)
tools/dev/gm.py quiet x64.optdebug    # Optimized debug (good for development)
tools/dev/gm.py quiet x64.release     # Release build (for benchmarking)

# List all available configurations
tools/dev/gm.py
```

**Important:** Always use `quiet` to minimize compilation output unless specifically debugging build issues. Errors will still be reported.

### Build Modes

- **release**: Fully optimized, no debug info. Use for performance benchmarks only.
- **optdebug**: Optimized with debug info. Recommended for most development work.
- **debug**: No optimization, full assertions. Use when debugging complex issues.

## Testing

Primary test runner: `tools/run-tests.py`

### Test Suites

- **unittests**: C++ unit tests (newer, preferred format)
- **cctest**: C++ unit tests (older format, being migrated to unittests)
- **mjsunit**: JavaScript tests for language features and builtins
- **message**: Tests for error messages
- **inspector**: DevTools protocol tests
- **intl**: Internationalization tests

### Running Tests

```bash
# Run all standard tests
tools/run-tests.py --progress dots --exit-after-n-failures=5 --outdir=out/x64.optdebug

# Run specific test suite
tools/run-tests.py --progress dots --exit-after-n-failures=5 --outdir=out/x64.optdebug cctest

# Run specific test file
tools/run-tests.py --progress dots --exit-after-n-failures=5 --outdir=out/x64.optdebug mjsunit/array-map

# Run C++ tests only
tools/run-tests.py --progress dots --exit-after-n-failures=5 --outdir=out/x64.optdebug cctest unittests

# Run a single test by name
tools/run-tests.py --progress dots --outdir=out/x64.optdebug cctest/test-heap/TestPage
```

**Important:** Always use `--progress dots` to minimize output clutter.

### Re-running Failed Tests

When tests fail, the output includes the exact command to reproduce. You can:

1. Use the test name with `tools/run-tests.py`
2. Run the command directly (shown in stderr) and add debugging flags

### Running d8 Shell

```bash
# Run JavaScript file
out/x64.debug/d8 script.js

# With debugging flags
out/x64.debug/d8 --trace-opt --trace-deopt script.js

# Enable native syntax for testing
out/x64.debug/d8 --allow-natives-syntax script.js
```

## Code Structure

### Source Organization (`src/`)

V8's compilation pipeline has multiple tiers:

1. **Parser** (`src/parsing/`) → Parses JavaScript into AST
2. **Ignition** (`src/interpreter/`) → Bytecode compiler and interpreter (baseline tier)
3. **Sparkplug** (`src/baseline/`) → Fast baseline compiler (generates code directly from bytecode)
4. **Maglev** (`src/maglev/`) → Mid-tier optimizing compiler
5. **TurboFan** (`src/compiler/`) → High-tier optimizing compiler
6. **Turboshaft** (`src/compiler/turboshaft/`) → New CFG-based compiler within TurboFan

### Key Directories

- **`src/api/`**: Public V8 API implementation (headers in `include/`)
- **`src/objects/`**: Object representations and runtime behavior
- **`src/builtins/`**: JavaScript built-in functions (Array.map, etc.)
- **`src/codegen/`**: Machine code generation, including macro assemblers and CodeStubAssembler
- **`src/execution/`**: Isolate, stack frames, tiering decisions
- **`src/heap/`**: Garbage collector and memory management
- **`src/runtime/`**: C++ functions callable from JavaScript
- **`src/d8/`**: d8 shell implementation
- **`src/wasm/`**: WebAssembly implementation
- **`src/sandbox/`**: Memory safety sandbox
- **`src/handles/`**: GC-safe object references
- **`src/ic/`**: Inline caching for property access optimization

### Test Organization (`test/`)

- **`test/cctest/`**: C++ tests using CCTest framework
- **`test/unittests/`**: C++ tests using GoogleTest
- **`test/mjsunit/`**: JavaScript tests (largest test suite)
- **`test/inspector/`**: Inspector protocol tests
- **`test/fuzzer/`**: Fuzzing tests

### Public API (`include/`)

All V8 embedding APIs are in `include/`. The main header is `v8.h`. Never modify these headers without careful consideration of backwards compatibility.

## Torque

Torque is V8's domain-specific language for writing builtins and defining object layouts. It compiles to CodeStubAssembler (CSA) C++ code.

### Key Concepts

- **File extension**: `.tq` (in `src/builtins/` and `src/objects/`)
- **Macros**: Inlined functions for reusable logic
- **Builtins**: Compiled functions callable from JavaScript or other builtins
- **Generated files**: Located in `out/<config>/gen/torque-generated/`

### Common Torque Keywords

- `transitioning`: Function can cause object map changes
- `javascript`: Builtin is directly callable from JavaScript
- `extern`: Declares C++ CSA functions callable from Torque

### Workflow

1. Modify `.tq` file in `src/builtins/` or `src/objects/`
2. Run build (e.g., `tools/dev/gm.py quiet x64.optdebug`)
3. Torque compiler automatically runs and generates C++ code
4. Run tests to verify changes

**Important:** Never edit generated files in `out/` - always edit source `.tq` files.

## Debugging

### Common Flags

```bash
# Optimization tracking
--trace-opt                    # Log optimized functions
--trace-deopt                  # Log deoptimizations
--trace-opt-verbose            # Detailed optimization info

# GC debugging
--trace-gc                     # Log GC events
--verify-heap                  # Verify heap integrity (debug builds)

# Bytecode and compilation
--print-bytecode               # Show generated bytecode
--print-code                   # Show generated machine code

# Testing helpers
--allow-natives-syntax         # Enable %OptimizeFunctionOnNextCall() etc.
```

View all flags: `out/x64.debug/d8 --help`

Most V8 flags are defined in `src/flags/flag-definitions.h`.

### Using Debuggers

```bash
# GDB
gdb --args out/x64.debug/d8 --flag script.js

# LLDB
lldb -- out/x64.debug/d8 --flag script.js
```

Use `debug` or `optdebug` builds for debugging. Generated Torque code can be inspected in `out/<config>/gen/torque-generated/`.

## Code Style and Commits

### Formatting

```bash
# Format all changes
git cl format
```

Always run before committing. V8 follows Chromium's C++ style guide.

### Commit Message Format

```
[component]: Short description

Longer explanation of why the change is needed, not just what
changed. Wrap at 72 characters.

Bug: v8:12345
```

Components: `compiler`, `runtime`, `api`, `heap`, `parser`, `maglev`, `turboshaft`, etc.

Bug tracker: https://crbug.com/v8

## Architecture Notes

### Compilation Pipeline Flow

Hot code progresses through tiers:

```
JavaScript → Parser → Ignition bytecode → Sparkplug → Maglev → TurboFan/Turboshaft
```

Deoptimization can happen at any point, reverting to interpreted bytecode.

### Object System

- All heap objects inherit from `HeapObject`
- Objects have a "map" (hidden class) that describes their structure
- Maps enable inline caching and optimize property access
- Tagged pointers: low bit distinguishes Smi (small integer) from heap pointers

### Memory Management

- Generational garbage collector (young + old generation)
- Handles provide GC-safe references to heap objects
- Never store raw pointers to GC-managed objects
- Use `Handle<T>` for local references, `MaybeHandle<T>` for nullable

### CodeStubAssembler (CSA)

CSA is used for:

- Implementing builtins that need to be fast
- Low-level runtime code
- Torque compiles to CSA

CSA provides platform-independent assembly-like interface that generates machine code for all architectures.

## Common Pitfalls

1. **Never edit generated files**: Files in `out/` are auto-generated
2. **Match test and build configs**: Test `x64.debug` against `out/x64.debug`
3. **Use handles correctly**: Never store raw pointers to heap objects across potential GC points
4. **Include `-inl.h` files carefully**: Only include from `.cc` or other `-inl.h` files
5. **Check architecture-specific code**: Subdirectories like `arm/`, `arm64/`, `x64/`, `ia32/` in `src/codegen/` and `src/regexp/` must be kept in sync
6. **Don't guess header locations**: Search for class/function definitions
7. **Forward declarations**: Many types are forward declared; find the actual definition if you need more than the declaration

## Key Development Patterns

- **Zone allocation**: Temporary memory for compilation, automatically freed
- **Isolate**: Per-instance V8 state; most operations require isolate access
- **Context**: JavaScript execution context (global object, scope)
- **Factory**: Use `isolate->factory()->NewXxx()` to allocate heap objects
- **Built-in IDs**: Defined in `src/builtins/builtins-definitions.h`

## Updating Dependencies

```bash
# Sync dependencies after git pull
gclient sync
```

V8 uses gclient (part of depot_tools) for dependency management. DEPS file defines all dependencies.
