---
name: Analyzing V8 Compiler Code
description: Trace call chains, annotate complex functions, and visualize data structures in V8's Maglev/TurboFan compilers. Use when investigating compiler optimizations (CSE, branch folding, loop peeling), deoptimization mechanisms, frame states, or understanding control flow transformations.
---

# Analyzing V8 Compiler Code

Systematic approach for deep-diving into V8 compiler internals, especially Maglev and TurboFan optimizations.

## When to Use This Skill

- Investigating compiler optimizations (FoldBranch, CSE, Loop Peeling)
- Understanding deoptimization and frame state management
- Analyzing control flow transformations
- Debugging compilation failures or unexpected behaviors
- Documenting complex compiler mechanisms

## Quick Start Workflow

```
□ Identify the feature to analyze (e.g., FoldBranch, CSE)
□ Find entry point (usually MaglevCompiler::Compile or similar)
□ Trace complete call chain using grep/search
□ Annotate core implementation line-by-line
□ Create data structure diagrams
□ Write JavaScript test cases
□ Verify understanding with --trace-* flags
□ Document findings
```

## Core Analysis Techniques

### 1. Call Chain Tracing

**Purpose**: Map execution path from compilation entry to specific implementation.

**Format**:
```
FunctionName (file.cc:line)
  ↓ brief description
NextFunction (file.cc:line)
  ↓ [condition: when this triggers]
TargetFunction (file.cc:line)
  ↓ [branch: scenario] → result
```

**Key points**: Include source paths, trigger conditions, distinguish compile-time vs runtime.

### 2. Line-by-Line Code Annotation

**Purpose**: Explain complex functions with focus on *why*, not just *what*.

**Format**:
```cpp
// 【Step N: Purpose - Performance Characteristic】
// - Why this step is needed
// - Edge cases to consider
code_line();

// Key design point: Why designed this way
// - Reason 1: ...
// - Reason 2: ...
next_code_line();
```

**Key points**: Use 【Step N】 markers, explain rationale, note performance implications.

### 3. Data Structure Visualization

**Purpose**: Show hierarchical relationships and transformations.

**Use ASCII diagrams** to illustrate:
- Structure layouts with nested boxes
- Data flow with arrows
- Before/after transformations

**Key points**: Keep diagrams under 30 lines, annotate critical fields.

### 4. Optimization Hierarchy

**Purpose**: Document how compiler tries optimizations from strongest to weakest.

**Format**:
```
1. **Strongest**: Description → Result (zero runtime cost)
2. **Mid-level**: Description → Result (constant folding)
3. **Fallback**: Description → Result (runtime check)
```

**Key points**: Each tier gets one concrete example with performance impact.

### 5. Scenario-Driven Examples

**Purpose**: Show optimization triggers with real JavaScript code.

**Format**:
```javascript
// Scenario: Optimization Name
function example() { /* JS code */ }

// Before: [IR/bytecode]
// After: [optimized version]
// Effect: quantified improvement
```

**Keep examples minimal** - one clear case per optimization.

## Essential Tools

### Code Search Script

Use `scripts/v8-search.sh` to quickly find code:

```bash
# Make script executable (first time only)
chmod +x .claude/skills/v8-code-analysis/scripts/v8-search.sh

# Search for functions
.claude/skills/v8-code-analysis/scripts/v8-search.sh func FoldBranch

# Search for classes
.claude/skills/v8-code-analysis/scripts/v8-search.sh class MaglevGraphBuilder

# Search for call sites
.claude/skills/v8-code-analysis/scripts/v8-search.sh calls GetLatestCheckpointedFrame

# See all options
.claude/skills/v8-code-analysis/scripts/v8-search.sh --help
```

### Debugging Commands

```bash
# Maglev graph building
out/x64.debug/d8 --allow-natives-syntax --trace-maglev-graph-building test.js

# Optimization tracking
out/x64.debug/d8 --trace-opt --trace-deopt test.js

# Code generation
out/x64.debug/d8 --print-code test.js

# Bytecode
out/x64.debug/d8 --print-bytecode test.js
```

## Analysis Checklist

When documenting a feature, ensure:

```
□ Call chain from Compile to implementation
□ Core function annotated line-by-line
□ Data structures visualized
□ Optimization tiers documented
□ JavaScript example provided
□ Source file paths and line numbers included
□ Performance impact quantified (when measurable)
□ Test case that triggers the optimization
```

## Document Structure

```
feature-name.md
  ├─ Overview (what it does, when triggered)
  ├─ Call Chain (from entry to implementation)
  ├─ Core Implementation (annotated code)
  ├─ Data Structures (diagrams)
  ├─ Optimization Strategy (hierarchy)
  ├─ Example (JavaScript + IR)
  └─ Source Reference Table (file:line mappings)
```

Keep main analysis under 500 lines. Link to `REFERENCE.md` for detailed examples.

## Writing Guidelines

1. **Precision**: Use exact V8 terminology from source code
2. **Brevity**: Explain *why*, skip obvious *what*
3. **Evidence**: Every claim needs source location
4. **Consistency**: One term per concept throughout
5. **Practicality**: Provide runnable test cases

## Common Pitfalls

❌ Explaining obvious code without rationale
❌ Missing edge cases and boundary conditions
❌ No source file references
❌ Verbose examples without clear purpose
❌ Inconsistent terminology
❌ Untested code snippets

## Progressive Disclosure

This skill uses a layered documentation approach:

**SKILL.md** (this file):
- Core analysis techniques
- Quick reference templates
- Essential tools

**[REFERENCE.md](./REFERENCE.md)** - Detailed walkthroughs:
- Complete call chain examples
- Extended code annotations
- Data structure deep dives
- Optimization tier examples

**[EXAMPLES.md](./EXAMPLES.md)** - Runnable test cases:
- FoldBranch optimization tests
- CSE demonstration
- Loop peeling examples
- Deoptimization scenarios
- Performance benchmarks

## Evaluation-Driven Development

Before writing analysis:
1. Create test case that triggers the optimization
2. Verify optimization occurs with --trace flags
3. Document only what's needed to understand the trace
4. Iterate based on testing, not assumptions

## Advanced Patterns

### Multi-Stage Transformations

When analyzing pipelines (e.g., JS → Bytecode → IR → Asm):
- Document each stage separately
- Show input/output at boundaries
- Highlight where optimization occurs

### Performance-Critical Code

For hot paths (CSE, register allocation):
- Note time complexity
- Explain algorithmic choices
- Show what would break if changed

### GC-Safe Operations

When analyzing deoptimization/materialization:
- Mark GC safepoints
- Explain Handle usage
- Note raw pointer dangers

## Additional Resources

Supporting documentation in this skill:
- [REFERENCE.md](./REFERENCE.md) - Detailed code walkthroughs and deep dives
- [EXAMPLES.md](./EXAMPLES.md) - Complete runnable test cases

Existing analysis documents in repository root:
- `maglev_control_flow.md` - Complete feature documentation
- `framestate_advanced.md` - Deep technical details
- `foldbranch-example.md` - Scenario-driven explanation

---

**Target audience**: Developers analyzing V8 compiler internals, not general V8 users.
**Depth**: Assume familiarity with compilers, SSA, control flow graphs.
**Updates**: Extend this skill when discovering new analysis patterns.
