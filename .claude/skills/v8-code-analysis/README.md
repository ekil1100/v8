# V8 Code Analysis Skill

Systematic approach for analyzing V8 compiler internals, especially Maglev and TurboFan optimizations.

## Quick Start

1. **Use the search script** to find code:
   ```bash
   .claude/skills/v8-code-analysis/scripts/v8-search.sh func FoldBranch
   ```

2. **Follow analysis workflow** in SKILL.md

3. **Reference detailed examples** in REFERENCE.md and EXAMPLES.md

## File Structure

```
v8-code-analysis/
├── SKILL.md           Core skill - analysis techniques and templates
├── REFERENCE.md       Detailed walkthroughs and deep dives
├── EXAMPLES.md        Runnable test cases and benchmarks
├── README.md          This file
└── scripts/
    └── v8-search.sh   Code search helper utility
```

## Documentation Layers

### SKILL.md - Core Techniques
Quick reference for:
- Call chain tracing format
- Line-by-line annotation template
- Data structure visualization
- Optimization hierarchy pattern
- Scenario-driven examples
- Tool commands

**Use when:** Starting a new analysis or need template reference.

### REFERENCE.md - Deep Dives
Extended explanations:
- Complete FoldBranch call chain
- FindExpression (CSE) full annotation
- DeoptFrame lifecycle with diagrams
- BuildTaggedEqual optimization tiers
- GC safety mechanisms
- Predecessor ID selection rationale

**Use when:** Need detailed understanding of specific mechanisms.

### EXAMPLES.md - Test Cases
Runnable code:
- FoldBranch test with IR traces
- CSE demonstration
- Loop peeling example
- Deoptimization scenario
- Performance benchmarks
- d8 flags reference

**Use when:** Need working code to verify understanding or measure impact.

## Common Workflows

### Analyzing a New Optimization

```bash
# 1. Find the implementation
.claude/skills/v8-code-analysis/scripts/v8-search.sh func OptimizationName

# 2. Trace call chain from MaglevCompiler::Compile
.claude/skills/v8-code-analysis/scripts/v8-search.sh calls OptimizationName

# 3. Create test case (see EXAMPLES.md for templates)

# 4. Run with traces
out/x64.debug/d8 --allow-natives-syntax \
  --trace-maglev-graph-building \
  test.js

# 5. Document using SKILL.md templates

# 6. Add to REFERENCE.md for detailed walkthrough
```

### Understanding Deoptimization

1. Read "GC Safety During Deoptimization" in REFERENCE.md
2. Run deopt example from EXAMPLES.md
3. Trace with `--trace-deopt` flag
4. Review DeoptFrame lifecycle diagram

### Performance Analysis

1. Use benchmark template from EXAMPLES.md
2. Measure before/after optimization
3. Verify with `--print-code` to see generated assembly
4. Document findings using optimization hierarchy template

## Tool Usage

### v8-search.sh Commands

```bash
# Function definitions
./scripts/v8-search.sh func FunctionName

# Class definitions
./scripts/v8-search.sh class ClassName

# Call sites
./scripts/v8-search.sh calls FunctionName

# Variable declarations
./scripts/v8-search.sh var VariableName

# Macro definitions
./scripts/v8-search.sh macro MACRO_NAME

# All occurrences
./scripts/v8-search.sh all SearchTerm

# Include test files (excluded by default)
./scripts/v8-search.sh func FunctionName --include-tests
```

## Best Practices

✅ **Start with SKILL.md templates** - Don't reinvent the wheel
✅ **Use v8-search.sh** - Faster than manual grepping
✅ **Create test cases first** - Evaluation-driven development
✅ **Verify with traces** - Don't assume, confirm
✅ **Document source locations** - File paths and line numbers
✅ **Show before/after** - Always compare optimized vs unoptimized
✅ **Quantify impact** - Measure performance when claiming optimization

❌ Don't explain obvious code without rationale
❌ Don't skip edge cases
❌ Don't write untested examples
❌ Don't use inconsistent terminology

## Contributing to This Skill

When discovering new analysis patterns:

1. Add technique to SKILL.md (keep under 300 lines)
2. Add detailed example to REFERENCE.md
3. Add runnable test to EXAMPLES.md
4. Update this README if adding new sections
5. Test on multiple V8 features to validate pattern

## Related Documentation

In repository root:
- `maglev_control_flow.md` - Complete Maglev optimization analysis
- `framestate_advanced.md` - DeoptFrame lifecycle deep dive
- `foldbranch-example.md` - FoldBranch walkthrough
- `CLAUDE.md` - V8 development guide

## Version

Last updated: 2025-01-21
Based on V8 commit: 90c956014db
