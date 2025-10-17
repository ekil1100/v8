# V8 Code Analysis Reference

Detailed examples and extended walkthroughs for analyzing V8 compiler code.

## Call Chain Tracing - Detailed Example

### FoldBranch Complete Trace

```
MaglevCompiler::Compile (src/maglev/maglev-compiler.cc:70)
  ↓ Entry point for Maglev compilation
MaglevGraphBuilder::Build (src/maglev/maglev-compiler.cc:102-104)
  ↓ Constructs basic IR graph from bytecode
  ↓ [Condition: v8_flags.maglev_non_eager_inlining enabled]
MaglevInliner::Run() (src/maglev/maglev-compiler.cc:109-113)
  ↓ Performs inlining optimizations
MaglevInliner::RunOptimizer() (src/maglev/maglev-inlining.cc:138)
  ↓ Creates graph optimizer instance
MaglevGraphOptimizer created (src/maglev/maglev-inlining.cc:140)
  ↓
GraphMultiProcessor::ProcessGraph (src/maglev/maglev-inlining.cc:146)
  ↓ Iterates over all basic blocks and nodes
  ↓ For each BranchIfInt32Compare node:
MaglevGraphOptimizer::VisitBranchIfInt32Compare (src/maglev/maglev-graph-optimizer.cc:2327)
  ↓ Attempts to fold Int32 comparison branch
reducer_.TryFoldInt32CompareOperation (src/maglev/maglev-graph-optimizer.cc:2329)
  ↓ [If compile-time determinable] Returns boolean
  ↓
MaglevGraphOptimizer::FoldBranch (src/maglev/maglev-graph-optimizer.cc:252)
  ↓ Executes branch folding
  ↓ Returns ProcessResult::kRevisit
```

**Trigger Conditions:**
1. Compilation stage: After basic graph construction
2. Flag check: `--maglev-non-eager-inlining` enabled
3. Inlining optimization stage
4. Constant folding: `TryFoldInt32CompareOperation` can determine result at compile-time

**Call Frequency:**
- Once per function compilation (during inlining optimization)
- Once per foldable conditional branch

## Line-by-Line Annotation - Extended Example

### FindExpression (CSE Implementation)

```cpp
// Template parameters:
//   NodeT: Node type to search for (e.g., TestEqual, Int32Add)
//   Args: Node construction parameters (e.g., Operation type for comparisons)
// Parameters:
//   hash: Expression hash value (computed by cse::fast_hash_combine)
//   inputs: Node's input array (operands)
//   args: Node's other options (forwarded to options() method)
// Returns:
//   Cached node if equivalent expression found, nullptr otherwise
template <typename NodeT, typename... Args>
NodeT* FindExpression(uint32_t hash,
                      std::array<ValueNode*, NodeT::kInputCount>& inputs,
                      Args&&... args) {

  // 【Step 1: Hash Lookup - O(1) Time Complexity】
  // Search available_expressions_ hash table for given hash
  // Type: ZoneMap<uint32_t, AvailableExpression>
  auto it = available_expressions_.find(hash);

  // Early exit optimization: Return nullptr immediately if hash not found
  // This is CSE's first line of defense (most common case)
  if (it == available_expressions_.end()) return nullptr;

  // 【Step 2: Get Node Opcode】
  // Compile-time constant, gets opcode corresponding to NodeT
  // Example: TestEqual → Opcode::kTestEqual
  // Used for subsequent side effect checks
  static constexpr Opcode op = Node::opcode_of<NodeT>;

  // 【Step 3: Extract Candidate Node】
  // it->second is AvailableExpression struct containing:
  //   - node: Cached expression node
  //   - effect_epoch: Side effect epoch when node was created
  auto candidate = it->second.node;

  // 【Step 4: Dead Node Detection】
  // Identity nodes are placeholders for deleted nodes
  // Why they appear: Nodes removed by optimizer but still in hash table
  // Design rationale: Avoid updating hash table on every graph modification (lazy deletion)
  if (candidate->Is<Identity>()) {
    available_expressions_.erase(it);  // Cleanup: Remove stale entry
    return nullptr;
  }

  // 【Step 5: Type and Input Count Validation】
  // Type check: candidate->Is<NodeT>() ensures candidate node type matches
  //   Example: When searching for TestEqual, candidate must also be TestEqual
  // Input count check: Ensures operand count matches
  //   Example: Binary operations must have 2 inputs
  // Why needed: Hash collisions may cause different nodes to share same hash
  const bool sanity_check =
      candidate->Is<NodeT>() &&
      static_cast<size_t>(candidate->input_count()) == inputs.size();

  // 【Step 6: Side Effect Epoch Check - Core Correctness Guarantee】
  // Condition 1: !Node::needs_epoch_check(op)
  //   - If node is pure operation (no side effects), no epoch check needed
  //   - Examples: Int32Add, TestEqual don't depend on external state
  // Condition 2: effect_epoch_ <= it->second.effect_epoch
  //   - Check if current side effect epoch is later than cached node's epoch
  //   - If current epoch is greater, intermediate side effects occurred
  //
  // Epoch mechanism:
  //   - effect_epoch_: Global counter, starts at 0
  //   - Increments on each side effect operation (function calls, property writes)
  //   - Pure operations get epoch kEffectEpochForPureInstructions (UINT32_MAX)
  //
  // epoch_check failure means:
  //   - Cached expression is stale (intermediate side effects may affect result)
  //   - Must recompute, cannot use cache
  const bool epoch_check = !Node::needs_epoch_check(op) ||
                           effect_epoch_ <= it->second.effect_epoch;

  // 【Step 7: Deep Matching】
  // Only perform expensive comparisons if type, count, and epoch checks pass
  // Performance optimization: Avoid unnecessary input comparison (O(n) operation)
  if (sanity_check && epoch_check) {

    // 【Step 7.1: Node Options Comparison】
    // options() returns node's configuration parameter tuple
    // Example: TestEqual's options() might return std::tuple<Operation>
    // Purpose: Ensure node's semantic options are identical
    if (static_cast<NodeT*>(candidate)->options() ==
        std::forward_as_tuple(std::forward<Args>(args)...)) {

      // 【Step 7.2: Input Node Sequential Comparison】
      // Loop purpose: Check if all inputs exactly match
      // Pointer comparison: inp != candidate->input(i).node()
      //   - In SSA form, same value must be same ValueNode pointer
      //   - No need to compare values, just pointers
      int i = 0;
      for (const auto& inp : inputs) {
        if (inp != candidate->input(i).node()) break;  // Early exit on mismatch
        i++;
      }

      // Success condition: i == inputs.size() means all inputs matched
      if (static_cast<size_t>(i) == inputs.size()) {
        // Return cached node: CSE hit! Reuse previous computation
        return static_cast<NodeT*>(candidate);
      }
    }
  }

  // 【Step 8: Cleanup Stale Cache】
  // If epoch check failed, cache is stale
  // Remove from hash table to avoid future false matches
  // Lazy cleanup strategy: Only clean on lookup, not on every side effect
  if (!epoch_check) {
    available_expressions_.erase(it);
  }

  // 【CSE Miss】
  // Return nullptr to notify caller to create new node
  // Caller (AddNewNodeOrGetEquivalent) will:
  //   1. Create new NodeT instance
  //   2. Add it to cache via AddExpression(hash, node)
  //   3. Return new node
  return nullptr;
}
```

## Data Structure Deep Dive

### DeoptFrame Lifecycle

```
┌─────────────────────────────────────────────────────┐
│ IR Construction Phase                               │
│ ┌─────────────────────────────────────────────────┐ │
│ │ InterpreterFrameState current_interpreter_frame_│ │
│ │ (unique, mutable)                               │ │
│ │ ┌─────────────────────────────────────────────┐ │ │
│ │ │ RegisterFrameArray frame_                   │ │ │
│ │ │ [param0, param1, r0, r1, acc]               │ │ │
│ │ │ Updated per bytecode                        │ │ │
│ │ └─────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────┘ │
│                                                     │
│ When node needs deopt support:                     │
│ GetLatestCheckpointedFrame() called                │
│ ↓                                                   │
│ ┌─────────────────────────────────────────────────┐ │
│ │ DeoptFrame (snapshot, immutable)                │ │
│ │ ┌─────────────────────────────────────────────┐ │ │
│ │ │ CompactInterpreterFrameState                │ │ │
│ │ │ ValueNode*[] = [n1, n2, n3, ...]            │ │ │
│ │ │ ← Snapshot of live values only              │ │ │
│ │ └─────────────────────────────────────────────┘ │ │
│ │ bytecode_offset: int                            │ │
│ │ source_position: SourcePosition                 │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘

         ↓ Register Allocation

┌─────────────────────────────────────────────────────┐
│ Code Generation Phase                               │
│ ┌─────────────────────────────────────────────────┐ │
│ │ DeoptInfo                                       │ │
│ │ ┌─────────────────────────────────────────────┐ │ │
│ │ │ InputLocation[] = [                         │ │ │
│ │ │   Register(rax),      // n1 in rax          │ │ │
│ │ │   StackSlot(rbp+16),  // n2 on stack        │ │ │
│ │ │   Constant(100),      // n3 is constant     │ │ │
│ │ │   Register(rcx)       // n4 in rcx          │ │ │
│ │ │ ]                                           │ │ │
│ │ └─────────────────────────────────────────────┘ │ │
│ │ deopt_index: int (index in deopt table)         │ │
│ │ top_frame: DeoptFrame*                          │ │
│ └─────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────┘
```

## Optimization Tiers - Complete Examples

### BuildTaggedEqual Optimization Hierarchy

```cpp
ValueNode* MaglevGraphBuilder::BuildTaggedEqual(ValueNode* lhs, ValueNode* rhs) {
  ValueNode* tagged_lhs = GetTaggedValue(lhs);
  ValueNode* tagged_rhs = GetTaggedValue(rhs);

  // Tier 1: Node Identity (Strongest - Zero Runtime Cost)
  // Same SSA node pointer = same value
  // Example: x === x always true
  if (tagged_lhs == tagged_rhs) {
    return GetBooleanConstant(true);
  }

  // Tier 2: Disjoint Types (Strong - Compile-time Constant)
  // Type information proves inequality
  // Example: Smi vs HeapString can never be equal
  if (HaveDisjointTypes(tagged_lhs, tagged_rhs)) {
    return GetBooleanConstant(false);
  }

  // Tier 3: Constant Canonicalization (Mid-level - Constant Propagation)
  // Different constant nodes = different values
  // Example: SmiConstant(1) vs SmiConstant(2)
  if (IsConstantNode(tagged_lhs->opcode()) && !tagged_lhs->Is<Constant>() &&
      tagged_lhs->opcode() == tagged_rhs->opcode()) {
    return GetBooleanConstant(false);
  }

  // Tier 4: Runtime Check (Fallback - Generate Code)
  // Cannot statically determine, emit comparison instruction
  return AddNewNodeNoInputConversion<TaggedEqual>({tagged_lhs, tagged_rhs});
}
```

**Performance Impact:**
- Tier 1-3: No runtime cost (eliminated at compile time)
- Tier 4: 1-2 CPU cycles (pointer comparison)

## Complete Analysis Workflow Example

See `EXAMPLES.md` for full end-to-end analysis of FoldBranch optimization.

## Advanced Topics

### GC Safety During Deoptimization

Deoptimizer disables GC during entire deopt process:

```cpp
// src/deoptimizer/deoptimizer.cc:630-633
Deoptimizer::Deoptimizer(...) {
  DCHECK(AllowGarbageCollection::IsAllowed());  // GC allowed before deopt
  disallow_garbage_collection_ = new DisallowGarbageCollection();  // Disable GC
  // ... deopt processing (raw pointer operations) ...
}

// src/deoptimizer/deoptimizer.cc:287-294
size_t Deoptimizer::DeleteForWasm(Isolate* isolate) {
  DCHECK(!AllowGarbageCollection::IsAllowed());  // GC disabled
  // ... process deopt ...
  delete deoptimizer;
  DCHECK(AllowGarbageCollection::IsAllowed());  // GC re-enabled
}
```

**Why:** Raw pointer operations during frame reconstruction would become invalid if GC moved objects.

### Predecessor ID Selection

Why FoldBranch keeps smallest predecessor_id when multiple edges exist:

```cpp
// Iteration from back to front
for (int i = target->predecessor_count() - 1; i >= 0; i--) {
  if (target->predecessor_at(i) == current) {
    predecessor_id = i;  // Continuously update, keeps smallest
  }
}
```

**Rationale:**
1. Consistent with Phi node input ordering (index 0 = first edge, usually true branch)
2. Handles multiple edges from same predecessor (both branches → same target)
3. Backward iteration prevents index shifting issues when removing predecessors
